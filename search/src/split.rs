// Goals too big for one exact table: split into sub-tables that each fit (the goal with some pieces, or their twists, left out), then IDA* guided by the largest of their distances

use std::borrow::Cow;
use std::collections::HashSet;
use std::rc::Rc;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPatternOrbitData, KPuzzle, KPuzzleOrbitName, KTransformationData};
use wasm_bindgen::prelude::*;

use crate::coords::{enumerate_turns, estimate_size, pattern_data, Coords, Turn, Units};
use crate::solvable::{close, read_orbit_tables, read_targets, table_targets};
use crate::symmetry::{Shape, Symmetry};
use crate::table::{near_values, DistanceTable, TableCore, UNSEEN};

// Same error text as twips, so the engine treats every solver the same
pub(crate) const NO_SOLUTION: &str = "No solution found!";
// Error when a search used up its maxNodes (the caller may switch to bigger sub-tables)
const NODE_LIMIT: &str = "Node limit reached";
// Temporary id for the pieces a sub-table leaves out (they become one shared, twist-free class)
const REST: u8 = u8::MAX;
// Id for pieces the targets never have (a start holding one can't be read)
const UNKNOWN: u8 = u8::MAX - 1;
// Longest answer looked for when the request gives no maxDepth
const MAX_LENGTH: u8 = 40;
// No turn made yet (any turn may come first)
const NO_GROUP: usize = usize::MAX;

// One piece class of the goal that sub-tables may track: a single piece or a group sharing an id, with or without a twist that counts
struct Item {
    orbit: usize,
    id: u8,
    twisted: bool,
}

// How a pattern becomes one sub-table's, orbit by orbit
struct Relabel {
    orbits: Vec<OrbitRelabel>,
}

// One orbit's relabeling: the new id for each old id, and whether that piece's twist still counts
struct OrbitRelabel {
    name: KPuzzleOrbitName,
    ids: [u8; 256],
    twist: [bool; 256],
}

impl Relabel {
    // Kept items keep their ids (and twists when asked), every other piece on a moving spot joins one twist-free rest class;
    // ids are then renumbered by the first spot they fill in the first target, so the same sub-goal gives the same table whatever goal it came from
    fn new(kpuzzle: &KPuzzle, targets: &[KPatternData], full: &Coords, items: &[Item], kept: &[(usize, bool)]) -> Relabel {
        let mut orbits = vec![];
        for (o, info) in kpuzzle.orbit_info_iter().enumerate() {
            let first = &targets[0][&info.name];
            // Ids on spots some turn moves, in any of the orbit's sets (pieces on untouched spots are always checked, so they keep their ids)
            let mut on_moving = [false; 256];
            for orbit in full.orbits().filter(|orbit| orbit.name == info.name) {
                for &spot in &orbit.spots {
                    on_moving[first.pieces[spot as usize] as usize] = true;
                }
            }
            // Temporary ids: kept or untouched-only ids stay, other ids become REST
            let mut temporary = [UNKNOWN; 256];
            let mut twist = [false; 256];
            for id in 0..256 {
                match kept.iter().find(|&&(item, _)| items[item].orbit == o && items[item].id as usize == id) {
                    Some(&(_, with_twist)) => (temporary[id], twist[id]) = (id as u8, with_twist),
                    None if on_moving[id] => temporary[id] = REST,
                    None => (temporary[id], twist[id]) = (id as u8, true),
                }
            }
            // Canonical ids: the first spot each temporary id fills in the first target
            let mut canonical = [UNKNOWN; 256];
            for (spot, &piece) in first.pieces.iter().enumerate() {
                let id = temporary[piece as usize] as usize;
                if canonical[id] == UNKNOWN {
                    canonical[id] = spot as u8;
                }
            }
            // Old id → canonical id
            let mut ids = [UNKNOWN; 256];
            for id in 0..256 {
                ids[id] = canonical[temporary[id] as usize];
            }
            orbits.push(OrbitRelabel { name: info.name.clone(), ids, twist });
        }
        Relabel { orbits }
    }

    // The pattern as the sub-table sees it (left-out twists become 0, ignored)
    fn apply(&self, pattern: &KPatternData) -> KPatternData {
        let mut out = KPatternData::new();
        for orbit in &self.orbits {
            let data = &pattern[&orbit.name];
            let mods = data.orientation_mod.clone().unwrap_or_else(|| vec![0; data.pieces.len()]);
            let mut relabeled = KPatternOrbitData { pieces: vec![], orientation: vec![], orientation_mod: Some(vec![]) };
            for (spot, &piece) in data.pieces.iter().enumerate() {
                let keep_twist = orbit.twist[piece as usize];
                relabeled.pieces.push(orbit.ids[piece as usize]);
                relabeled.orientation.push(if keep_twist { data.orientation[spot] } else { 0 });
                relabeled.orientation_mod.as_mut().unwrap().push(if keep_twist { mods[spot] } else { 1 });
            }
            out.insert(orbit.name.clone(), relabeled);
        }
        out
    }
}

// A pattern as JSON with orbits in the puzzle's order, so equal patterns give equal text (the sub-table cache key)
fn pattern_json(kpuzzle: &KPuzzle, pattern: &KPatternData) -> String {
    let orbits: Vec<String> = kpuzzle
        .orbit_info_iter()
        .map(|info| {
            let data = &pattern[&info.name];
            format!(
                "\"{}\":{{\"pieces\":{:?},\"orientation\":{:?},\"orientationMod\":{:?}}}",
                info.name,
                data.pieces,
                data.orientation,
                data.orientation_mod.clone().unwrap_or_default()
            )
        })
        .collect();
    format!("{{{}}}", orbits.join(","))
}

// Items a sub-table keeps: (item index, whether its twist counts)
type Kept = Vec<(usize, bool)>;

// Sub-tables for a goal: each starts from an item no earlier sub-table covers, then adds the goal's items in order (edges first on the 3x3)
// while the table still fits, with their twists if possible, else their positions only
fn plan(items: &[Item], fits: impl Fn(&[(usize, bool)]) -> bool) -> Vec<Kept> {
    let mut tables = vec![];
    let mut placed = vec![false; items.len()];
    let mut twisted = vec![false; items.len()];
    // Add an item if the table still fits: with its twist when it has one, else its positions only
    let add = |kept: &mut Kept, item: usize| {
        for with_twist in [items[item].twisted, false] {
            kept.push((item, with_twist));
            if fits(kept) {
                return;
            }
            kept.pop();
            if !items[item].twisted {
                return;
            }
        }
    };
    while let Some(seed) = (0..items.len()).find(|&i| !placed[i] || (items[i].twisted && !twisted[i])) {
        let mut kept = vec![];
        add(&mut kept, seed);
        // An item too big even alone (or whose twist doesn't fit) is left to the final goal check
        if kept.first().is_none_or(|&(_, with_twist)| with_twist != items[seed].twisted) {
            twisted[seed] = true;
        }
        if kept.is_empty() {
            placed[seed] = true;
            continue;
        }
        // Then every other item, in order
        for item in 0..items.len() {
            if item != seed {
                add(&mut kept, item);
            }
        }
        for &(item, with_twist) in &kept {
            placed[item] = true;
            twisted[item] |= with_twist;
        }
        tables.push(kept);
    }
    tables
}

// True when the two turns give the same result in either order (then only one order is searched)
fn commute(kpuzzle: &KPuzzle, a: &KTransformationData, b: &KTransformationData) -> bool {
    kpuzzle.orbit_info_iter().all(|info| {
        let (x, y) = (&a[&info.name], &b[&info.name]);
        let n = info.num_orientations;
        (0..info.num_pieces as usize).all(|spot| {
            // Piece each order brings to this spot, and the twist it gains on the way
            let (xy, yx) = (y.permutation[spot] as usize, x.permutation[spot] as usize);
            x.permutation[xy] == y.permutation[yx]
                && (x.orientation_delta[xy] + y.orientation_delta[spot]) % n == (y.orientation_delta[yx] + x.orientation_delta[spot]) % n
        })
    })
}

// Move pruning for a set of turns: may a turn of group b follow one of group a ([a * groups + b]); never two turns of one move in a row,
// and of two moves that commute only the lower-numbered one first; also returns the number of groups
pub(crate) fn move_pruning(kpuzzle: &KPuzzle, turns: &[Turn]) -> (Vec<bool>, usize) {
    let groups = turns.iter().map(|turn| turn.group + 1).max().unwrap_or(0);
    let mut follow = vec![true; groups * groups];
    // Rule out each pair of turns that repeats a move, or puts two commuting moves in the higher-numbered order
    for a in turns {
        for b in turns {
            if a.group == b.group || (b.group < a.group && commute(kpuzzle, &a.data, &b.data)) {
                follow[a.group * groups + b.group] = false;
            }
        }
    }
    (follow, groups)
}

// What an IDA* run checks answers with: the whole goal's numbering, each target's state in it, and the move pruning
pub(crate) struct GoalCheck<'a> {
    pub full: &'a Coords,
    pub goals: &'a HashSet<(Units, Units)>,
    pub follow: &'a [bool],
    pub groups: usize,
}

// Options of a search or list request: answers shorter than maxDepth (twips style), a node budget, how many answers a list may give,
// and for listing page by page: answers no shorter than minDepth, coming after the answer `after` (its move text) in the list's order
pub(crate) struct SearchOptions {
    pub limit: u64,
    pub max_nodes: u64,
    pub max_answers: usize,
    pub min_depth: u64,
    pub after: Option<String>,
}

// Read a request's options (missing ones: no limit, no budget, every answer, from the shortest, from the first)
pub(crate) fn read_options(options_json: &str) -> Result<SearchOptions, String> {
    let options: serde_json::Value = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
    Ok(SearchOptions {
        limit: options["maxDepth"].as_u64().unwrap_or(u64::MAX),
        max_nodes: options["maxNodes"].as_u64().unwrap_or(u64::MAX),
        max_answers: options["maxAnswers"].as_u64().unwrap_or(u64::MAX).clamp(1, usize::MAX as u64) as usize,
        min_depth: options["minDepth"].as_u64().unwrap_or(0),
        after: options["after"].as_str().map(str::to_owned),
    })
}

// An answer's move text as turn numbers (None when a move isn't one of the allowed turns)
fn path_turns(full: &Coords, text: &str) -> Option<Vec<usize>> {
    text.split_whitespace().map(|name| full.turns.iter().position(|turn| turn.name == name)).collect()
}

// Turn lists as a JSON list of move texts, e.g. ["R U R'", "F R"]
pub(crate) fn answer_list(full: &Coords, answers: &[Vec<usize>]) -> String {
    let texts: Vec<String> = answers.iter().map(|path| path_text(full, path)).collect();
    serde_json::to_string(&texts).unwrap_or_default()
}

// One answer's moves as text
fn path_text(full: &Coords, path: &[usize]) -> String {
    path.iter().map(|&turn| full.turns[turn].name.clone()).collect::<Vec<_>>().join(" ")
}

// One table lookup of the IDA*: a table, and for a table that reads a rotated state, the table's turn for each allowed turn (its rotated copy)
pub(crate) struct Slot {
    pub table: Rc<TableCore>,
    pub turns: Option<Vec<u8>>,
}

impl Slot {
    // A table read as it is (each turn is itself)
    pub(crate) fn plain(table: &Rc<TableCore>) -> Slot {
        Slot { table: Rc::clone(table), turns: None }
    }
}

// IDA* over these tables from their start states (`whole` = the start in the whole goal's numbering), for answers shorter than the options' limit:
// the first shortest answer, or with `list` every answer, shortest first, up to maxAnswers (an answer never passes through the goal on its way),
// from minDepth moves on and after the answer `after` (one page of a long list: answers come in turn order, so the next page starts where this one ended);
// gives the answers as turn lists (or NO_SOLUTION / NODE_LIMIT) and the nodes visited
pub(crate) fn deepen(tables: &[Slot], starts: &[(Units, u64)], whole: (Units, Units), check: &GoalCheck, options: &SearchOptions, list: bool) -> (Result<Vec<Vec<usize>>, &'static str>, u64) {
    // Never deeper than MAX_LENGTH (the search state has room for that many moves)
    let limit = options.limit.min(MAX_LENGTH as u64 + 1);
    // A list page: its first depth, and the answer it comes after (none; or one the allowed turns can't spell, which gives nothing)
    let (min_depth, resume) = if list { (options.min_depth, options.after.as_deref().map(|text| path_turns(check.full, text))) } else { (0, None) };
    let resume = match resume {
        Some(None) => return (Err(NO_SOLUTION), 0),
        Some(Some(turns)) => turns,
        None => vec![],
    };
    // Search state: room for every depth up to MAX_LENGTH
    let count = tables.len();
    let turn_count = check.full.turns.len();
    let depths = MAX_LENGTH as usize + 1;
    let mut ida = Ida {
        tables,
        full: check.full,
        goals: check.goals,
        whole,
        follow: check.follow,
        groups: check.groups,
        outer: vec![Units::new(); depths * count],
        inner: vec![0; depths * count],
        bounds: vec![0; depths * count],
        exact: vec![false; depths * count],
        current: vec![false; depths * count],
        moved: Units::new(),
        children: vec![0; depths * turn_count],
        looked_up: vec![0; depths * count * turn_count],
        rotated: vec![0; turn_count],
        indices: vec![0; turn_count],
        distances: vec![0; turn_count],
        order: (0..count).collect(),
        ruled: vec![false; count],
        scratch: Vec::with_capacity(count),
        path: vec![],
        cut: false,
        nodes: 0,
        max_nodes: options.max_nodes,
        gave_up: false,
        listing: list,
        max_answers: if list { options.max_answers } else { 1 },
        answers: vec![],
        resume,
        resuming: false,
    };
    // Each table's start state and its exact distance; the largest distance is the first bound
    let mut bound = 0;
    for (t, &(outer, inner)) in starts.iter().enumerate() {
        let distance = tables[t].table.distance(&outer, inner);
        if distance == UNSEEN {
            return (Err(NO_SOLUTION), 0);
        }
        bound = bound.max(distance);
        (ida.outer[t], ida.inner[t], ida.bounds[t], ida.exact[t], ida.current[t]) = (outer, inner, distance, true, true);
    }
    // A list page starts at its first depth (shorter answers were on earlier pages)
    bound = bound.max(min_depth.min(MAX_LENGTH as u64) as u8);
    // Deepen one move at a time until the first answer (or enough answers) turns up, the limit is reached, or no state was cut by the bound (nothing deeper exists)
    while (bound as u64) < limit {
        ida.cut = false;
        // At the depth of the answer a page comes after, every path up to it is skipped (they were on earlier pages)
        ida.resuming = !ida.resume.is_empty() && ida.resume.len() == bound as usize;
        if ida.dfs(0, bound, NO_GROUP) {
            break;
        }
        if ida.gave_up || !ida.cut {
            break;
        }
        bound += 1;
    }
    // Out of nodes, nothing within the limit, or the answers
    let result = if ida.gave_up {
        Err(NODE_LIMIT)
    } else if ida.answers.is_empty() {
        Err(NO_SOLUTION)
    } else {
        Ok(std::mem::take(&mut ida.answers))
    };
    (result, ida.nodes)
}

// One sub-table: how a pattern is relabeled for it, its targets as JSON (the cache key), its estimated size, and the table once attached
struct Sub {
    relabel: Relabel,
    targets: String,
    states: u64,
    table: Option<Rc<TableCore>>,
}

// A goal searched with IDA*, bounded by the largest of its sub-tables' distances (each sub-table is a lower bound)
#[wasm_bindgen]
pub struct SplitSearch {
    kpuzzle: KPuzzle,
    // Every tracked piece of the goal, to check an answer really reaches it
    full: Coords,
    // Each target's tracked pieces (outer, inner)
    goals: HashSet<(Units, Units)>,
    subs: Vec<Sub>,
    // Lookups per node: (sub-table, rotation), a sub-table read on the state as it is (rotation 0) or on a rotated copy (a planned table that is a rotated copy of another)
    slots: Vec<(usize, usize)>,
    // Identity goals (one target, each piece its own id): the rotations that keep the moves
    symmetry: Option<Symmetry>,
    // Move pruning: may a turn of group b follow one of group a ([a * groups + b])
    follow: Vec<bool>,
    groups: usize,
    // Search nodes visited by the last search (for benchmarks)
    nodes: f64,
}

#[wasm_bindgen]
impl SplitSearch {
    // Plan the sub-tables for these targets (a JSON list of patterns) and moves, each at most max_states; fails when the goal can't be split
    #[wasm_bindgen(constructor)]
    pub fn new(kpuzzle_json: &str, targets_json: &str, moves_json: &str, max_states: f64) -> Result<SplitSearch, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        // Puzzle, allowed turns and targets as sent (with their "solvable with" moves), read like DistanceTable does, and the targets closed under those moves
        let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
        let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
        let turns = enumerate_turns(&kpuzzle, &moves)?;
        let (sent, free) = read_targets(&kpuzzle, targets_json)?;
        let closed = close(&kpuzzle, &sent, &free, &turns)?;
        // Numbering of the whole goal (too big for a table, but it tracks every piece for the goal check)
        let full = Coords::new(&kpuzzle, &closed, turns)?;
        // Each closed target's pieces in that numbering, to compare answers with
        let goals = closed.iter().map(|target| full.read(target).ok_or("A target doesn't fit its own numbering")).collect::<Result<HashSet<_>, _>>()?;
        // Sub-tables relabel the targets as sent (a sub-goal closed under the moves is the closed goal relabeled, so each table closes its own)
        let targets = sent;
        // The goal's items, orbit by orbit in the puzzle's order (an orbit's sets by first spot, classes in spot order; a class in several sets is one item)
        let mut items: Vec<Item> = vec![];
        for (o, info) in kpuzzle.orbit_info_iter().enumerate() {
            let mut sets: Vec<_> = full.orbits().filter(|orbit| orbit.name == info.name).collect();
            sets.sort_by_key(|orbit| orbit.spots.first().copied());
            for class in sets.iter().flat_map(|orbit| orbit.classes.iter()) {
                match items.iter_mut().find(|item| item.orbit == o && item.id == class.id) {
                    Some(item) => item.twisted |= class.twisted,
                    None => items.push(Item { orbit: o, id: class.id, twisted: class.twisted }),
                }
            }
        }
        if items.is_empty() {
            return Err("Nothing to split".to_owned());
        }
        // Sub-tables that fit a budget, each a relabeling of the targets (repeats dropped)
        let fits_in = |kept: &[(usize, bool)], budget: f64| {
            let relabel = Relabel::new(&kpuzzle, &targets, &full, &items, kept);
            let relaxed: Vec<KPatternData> = targets.iter().map(|target| relabel.apply(target)).collect();
            estimate_size(&kpuzzle, &relaxed, &full.turns).is_ok_and(|size| size as f64 <= budget)
        };
        // Sub-tables that fit this split's budget
        let fits = |kept: &[(usize, bool)]| fits_in(kept, max_states);
        // Planned sub-tables (the items each one keeps)
        let mut plans = plan(&items, &fits);
        // With "solvable with" moves, also one table per orbit holding every item's position (no twists) when it fits: the moves usually allow
        // only some layouts of those pieces as a whole (a 2-gen corner permutation), which tables of a few pieces can't see
        if !free.is_empty() {
            for o in 0..kpuzzle.orbit_info_iter().count() {
                let kept: Kept = (0..items.len()).filter(|&item| items[item].orbit == o).map(|item| (item, false)).collect();
                if kept.len() > 1 && fits(&kept) {
                    plans.push(kept);
                }
            }
        }
        // A goal asking for whole-orbit tables (a BLD step: the whole cube, a few pieces cycled) also gets one table per orbit holding all its items, the last
        // twisted one placed only (the other twists fix its twist), when it fits that bigger budget: all 8 corners = 88M states, which sees a corner swap or twist
        // (parity, twisted corners) far better than tables of one corner each (12 edges don't fit; 6-edge tables were tried and barely helped edge flips)
        let orbit_states = read_orbit_tables(targets_json)?;
        if orbit_states > 0.0 {
            for o in 0..kpuzzle.orbit_info_iter().count() {
                let mut kept: Kept = (0..items.len()).filter(|&item| items[item].orbit == o).map(|item| (item, items[item].twisted)).collect();
                // The last twisted item without its twist
                if let Some(last) = kept.iter_mut().rev().find(|(_, twisted)| *twisted) {
                    last.1 = false;
                }
                if kept.len() > 1 && fits_in(&kept, orbit_states) {
                    plans.push(kept);
                }
            }
        }
        // Identity goals (one target, each piece its own id): the rotations that keep the moves, and each table's pieces as (orbit, home spot, twist counted);
        // a table holding every item of a spot set also knows where the set's left-out piece is, so that piece counts as held too (DR finish: all 12 edges)
        let symmetry = Symmetry::new(&kpuzzle, &closed, &full.turns);
        let orbit_index = |name: &KPuzzleOrbitName| kpuzzle.orbit_info_iter().position(|info| info.name == *name).unwrap_or(0);
        let shape_of = |kept: &Kept, symmetry: &Symmetry| -> Shape {
            let mut shape: Shape = kept.iter().map(|&(item, twist)| (items[item].orbit as u8, symmetry.home(items[item].orbit, items[item].id), twist)).collect();
            for set in full.orbits() {
                let o = orbit_index(&set.name);
                let holds = |id: u8| shape.iter().any(|&(orbit, home, _)| orbit as usize == o && home == symmetry.home(o, id));
                if let Some(left_out) = set.implicit.filter(|_| set.classes.iter().all(|class| holds(class.id))) {
                    shape.push((o as u8, symmetry.home(o, left_out), false));
                }
            }
            shape.sort_unstable();
            shape
        };
        let mut subs: Vec<Sub> = vec![];
        let mut shapes: Vec<Shape> = vec![];
        let mut slots: Vec<(usize, usize)> = vec![];
        for kept in plans {
            // A rotated copy of a table already planned (whole cube: "4 U edges + UFR" and "+ UBR") reads that table on the rotated state instead of being built
            if let Some(symmetry) = &symmetry {
                let shape = shape_of(&kept, symmetry);
                if let Some(found) = (0..subs.len()).find_map(|s| (1..symmetry.rotations.len()).find(|&r| symmetry.turned(&shapes[s], r) == shape).map(|r| (s, r))) {
                    slots.push(found);
                    continue;
                }
            }
            // This sub-table's targets, its size, and its cache key (with the goal's moves when they add targets to this sub-goal)
            let relabel = Relabel::new(&kpuzzle, &targets, &full, &items, &kept);
            let relaxed: Vec<KPatternData> = targets.iter().map(|target| relabel.apply(target)).collect();
            let states = estimate_size(&kpuzzle, &relaxed, &full.turns)?;
            let targets = table_targets(&kpuzzle, &relaxed, &free, &full.turns, |target| pattern_json(&kpuzzle, target))?;
            if !subs.iter().any(|sub| sub.targets == targets) {
                shapes.push(symmetry.as_ref().map_or(vec![], |symmetry| shape_of(&kept, symmetry)));
                slots.push((subs.len(), 0));
                subs.push(Sub { relabel, targets, states, table: None });
            }
        }
        if subs.is_empty() {
            return Err("No sub-table fits".to_owned());
        }
        // Move pruning: never two turns of one move in a row, and of two moves that commute only the lower-numbered one first
        let (follow, groups) = move_pruning(&kpuzzle, &full.turns);
        Ok(SplitSearch { kpuzzle, full, goals, subs, slots, symmetry, follow, groups, nodes: 0.0 })
    }

    // Number of sub-tables
    pub fn tables(&self) -> usize {
        self.subs.len()
    }

    // Targets of one sub-table, as the JSON list DistanceTable takes (equal text = same table, whatever goal it came from)
    pub fn targets(&self, index: usize) -> String {
        self.subs[index].targets.clone()
    }

    // Estimated states of one sub-table (an upper bound), to weigh building it
    pub fn states(&self, index: usize) -> f64 {
        self.subs[index].states as f64
    }

    // Use this built table as sub-table `index` (shared, not copied)
    pub fn attach(&mut self, index: usize, table: &DistanceTable) {
        self.subs[index].table = Some(table.core());
    }

    // Search nodes the last search visited
    pub fn nodes(&self) -> f64 {
        self.nodes
    }

    // Largest lookup distance from a start pattern: a sure lower bound on its answer, found without searching (Infinity when some sub-table can't reach a target)
    pub fn measure(&self, start_json: &str) -> Result<f64, String> {
        let start = pattern_data(&self.kpuzzle, start_json)?;
        // An untouched spot that's wrong can't be fixed by any turn
        if self.full.read(&start).is_none() {
            return Ok(f64::INFINITY);
        }
        let mut bound = 0;
        for &(s, r) in &self.slots {
            let sub = &self.subs[s];
            let table = sub.table.as_ref().ok_or("A sub-table isn't attached")?;
            match table.read(&sub.relabel.apply(&self.rotated(&start, r))).map(|(outer, inner)| table.distance(&outer, inner)) {
                Some(distance) if distance != UNSEEN => bound = bound.max(distance),
                _ => return Ok(f64::INFINITY),
            }
        }
        Ok(bound as f64)
    }

    // Shortest answer from a start pattern, with twips's contract ({"maxDepth": 9} only finds answers shorter than 9, or {} for no limit);
    // {"maxNodes": n} gives up with NODE_LIMIT after n search nodes
    pub fn search(&mut self, start_json: &str, options_json: &str) -> Result<String, String> {
        let answers = self.run(start_json, options_json, false)?;
        Ok(path_text(&self.full, &answers[0]))
    }

    // Every answer from a start pattern shorter than {"maxDepth": n}, shortest first, up to {"maxAnswers": k}, as a JSON list of move texts
    // (an answer never passes through the goal on its way); {"maxNodes": n} as in search; {"minDepth": d, "after": "R U"} lists one page:
    // answers of d moves and more that come after that answer (same length) in turn order
    pub fn list(&mut self, start_json: &str, options_json: &str) -> Result<String, String> {
        let answers = self.run(start_json, options_json, true)?;
        Ok(answer_list(&self.full, &answers))
    }
}

// Rust-only part of SplitSearch (not exported to JS)
impl SplitSearch {
    // IDA* from a start pattern on the attached sub-tables: the first shortest answer, or with `list` every answer up to maxAnswers
    fn run(&mut self, start_json: &str, options_json: &str, list: bool) -> Result<Vec<Vec<usize>>, String> {
        // Start, depth limit (answers shorter than it), node budget, answers wanted, and the attached sub-tables
        self.nodes = 0.0;
        let start = pattern_data(&self.kpuzzle, start_json)?;
        let options = read_options(options_json)?;
        let tables: Vec<Slot> = self
            .slots
            .iter()
            .map(|&(s, r)| {
                let table = self.subs[s].table.clone().ok_or("A sub-table isn't attached")?;
                let turns = self.symmetry.as_ref().filter(|_| r > 0).map(|symmetry| symmetry.rotations[r].turns.clone());
                Ok(Slot { table, turns })
            })
            .collect::<Result<_, String>>()?;
        // The whole start (None: an untouched spot is wrong, no turn can fix it), and each lookup's start state (rotated for rotated lookups)
        let whole = self.full.read(&start).ok_or(NO_SOLUTION)?;
        let starts = self.slots.iter().zip(&tables).map(|(&(s, r), slot)| slot.table.read(&self.subs[s].relabel.apply(&self.rotated(&start, r)))).collect::<Option<Vec<_>>>().ok_or(NO_SOLUTION)?;
        // Deepen, checking answers on the whole goal
        let check = GoalCheck { full: &self.full, goals: &self.goals, follow: &self.follow, groups: self.groups };
        let (answers, nodes) = deepen(&tables, &starts, whole, &check, &options, list);
        self.nodes = nodes as f64;
        answers.map_err(|error| error.to_owned())
    }

    // A pattern as a lookup with this rotation reads it (rotation 0: as it is)
    fn rotated<'p>(&self, pattern: &'p KPatternData, r: usize) -> Cow<'p, KPatternData> {
        match &self.symmetry {
            Some(symmetry) if r > 0 => Cow::Owned(symmetry.rotate(pattern, r)),
            _ => Cow::Borrowed(pattern),
        }
    }
}

// One IDA* run: sub-table states per depth (depth * tables + table) with their distance (or a bound above it), the moves so far, and whether the bound cut anything
struct Ida<'a> {
    tables: &'a [Slot],
    full: &'a Coords,
    goals: &'a HashSet<(Units, Units)>,
    whole: (Units, Units),
    follow: &'a [bool],
    groups: usize,
    outer: Vec<Units>,
    inner: Vec<u64>,
    bounds: Vec<u8>,
    // Whether each (depth, table) bound is the exact distance (tables store distances mod 3, so a child's distance is only known from an exact parent's)
    exact: Vec<bool>,
    // Whether each (depth, table) state is up to date: a sub-table's pieces are only moved along the path when a lookup needs them (an up-to-date state's distance is exact too)
    current: Vec<bool>,
    // Room for a child's pieces when a sub-table can't rank a child straight from its parent
    moved: Units,
    // Children still in at each depth (their turns, in turn order: depth * turns + k), and each looked-up child distance (depth, table, turn)
    children: Vec<u8>,
    looked_up: Vec<u8>,
    // One node's child turns as a rotated lookup makes them, child table indices and their distances (filled and read before going deeper)
    rotated: Vec<u8>,
    indices: Vec<u64>,
    distances: Vec<u8>,
    // Sub-tables in the order they are checked (the ones that ruled children out at the last node go first), which ones did, and room to reorder them
    order: Vec<usize>,
    ruled: Vec<bool>,
    scratch: Vec<usize>,
    path: Vec<usize>,
    cut: bool,
    nodes: u64,
    // Node budget, and whether it ran out
    max_nodes: u64,
    gave_up: bool,
    // Listing every answer (else the first one ends the search), how many answers end it, and the answers so far
    listing: bool,
    max_answers: usize,
    answers: Vec<Vec<usize>>,
    // A list page's answer to come after (empty = from the first), and whether the path so far is still on the way to it (paths before it are skipped)
    resume: Vec<usize>,
    resuming: bool,
}

impl Ida<'_> {
    // Depth-first search below the state at `depth`, with `remaining` moves left in this bound; true once the search is over (first answer, or enough answers)
    fn dfs(&mut self, depth: usize, remaining: u8, last: usize) -> bool {
        // Out of nodes: stop the whole search
        if self.nodes >= self.max_nodes {
            self.gave_up = true;
            return false;
        }
        self.nodes += 1;
        // Out of moves: every sub-table is at 0 here, so check the whole goal (sub-tables alone may miss pieces or mix targets)
        if remaining == 0 {
            // The answer this page comes after: it was on the last page
            if self.resuming {
                return false;
            }
            if self.is_goal() {
                // At the goal: note the answer; a search ends here, a list once it has enough
                self.answers.push(self.path.clone());
                return self.answers.len() >= self.max_answers;
            }
            self.cut = true;
            return false;
        }
        // Listing: a path already at the goal goes no further (a shorter answer plus moves that keep the goal, which later steps can always make themselves)
        if self.listing && self.at_goal(depth) {
            return false;
        }
        let count = self.tables.len();
        let turns = self.full.turns.len();
        let (here, next) = (depth * count, (depth + 1) * count);
        // Children the move pruning allows, in turn order: never the same move as the last one, nor a commuting move that should have come first
        let first = depth * turns;
        let mut alive = 0;
        for turn in 0..turns {
            if last == NO_GROUP || self.follow[last * self.groups + self.full.turns[turn].group] {
                self.children[first + alive] = turn as u8;
                alive += 1;
            }
        }
        // Sub-tables that could rule children out (one move changes a distance by at most one), one at a time over every child still in
        for position in 0..count {
            let t = self.order[position];
            self.ruled[t] = false;
            if alive == 0 || self.bounds[here + t] + 1 < remaining {
                continue;
            }
            // The state and its exact distance (a bound carried down may be above it: then no child can be ruled out after all)
            self.ensure(depth, t);
            if self.bounds[here + t] + 1 < remaining {
                continue;
            }
            let decode = near_values(self.bounds[here + t]);
            let tables = self.tables;
            let table = &*tables[t].table;
            // The children's turns as this table makes them (a rotated lookup turns them first)
            let own = match &tables[t].turns {
                None => &self.children[first..first + alive],
                Some(map) => {
                    for k in 0..alive {
                        self.rotated[k] = map[self.children[first + k] as usize];
                    }
                    &self.rotated[..alive]
                }
            };
            // Each child's table index (ranked from this state, the child's pieces aren't kept), then all their distances (independent memory reads, so they overlap),
            // each the parent's distance − 1, + 0 or + 1 as its stored value mod 3 says
            for k in 0..alive {
                self.indices[k] = table.child_index(&self.outer[here + t], self.inner[here + t], own[k] as usize, &mut self.moved);
            }
            for k in 0..alive {
                self.distances[k] = decode[table.value_at(self.indices[k]) as usize];
            }
            // Children needing more moves than are left drop out (a deeper bound may get past them, unreachable states never will)
            let mut kept = 0;
            for k in 0..alive {
                let (turn, distance) = (self.children[first + k], self.distances[k]);
                if distance >= remaining {
                    self.cut |= distance != UNSEEN;
                    self.ruled[t] = true;
                    continue;
                }
                self.looked_up[(here + t) * turns + turn as usize] = distance;
                self.children[first + kept] = turn;
                kept += 1;
            }
            alive = kept;
        }
        // Sub-tables that ruled a child out are checked first from now on (keeping their order)
        self.scratch.clear();
        self.scratch.extend(self.order.iter().filter(|&&t| self.ruled[t]));
        self.scratch.extend(self.order.iter().filter(|&&t| !self.ruled[t]));
        std::mem::swap(&mut self.order, &mut self.scratch);
        // Go into each child left, in turn order: each sub-table's bound is its looked-up distance (exact) or (not looked up) one more than before; its state is moved later, when needed
        let resuming = self.resuming;
        for k in 0..alive {
            let turn = self.children[first + k] as usize;
            // On the way to the answer a page comes after: children before its turn were listed already, the one on its path stays on the way
            if resuming {
                if turn < self.resume[depth] {
                    continue;
                }
                self.resuming = turn == self.resume[depth];
            }
            for t in 0..count {
                let skipped = self.bounds[here + t] + 1 < remaining;
                self.bounds[next + t] = if skipped { self.bounds[here + t] + 1 } else { self.looked_up[(here + t) * turns + turn] };
                self.exact[next + t] = !skipped;
                self.current[next + t] = false;
            }
            self.path.push(turn);
            if self.dfs(depth + 1, remaining - 1, self.full.turns[turn].group) {
                return true;
            }
            self.path.pop();
            if self.gave_up {
                return false;
            }
        }
        false
    }

    // True when the state at `depth` is already at the goal: every table at 0 (a bound of 0 is exact, others are made exact), then the whole goal checked
    fn at_goal(&mut self, depth: usize) -> bool {
        let here = depth * self.tables.len();
        for t in 0..self.tables.len() {
            if self.bounds[here + t] == 0 {
                continue;
            }
            self.ensure(depth, t);
            if self.bounds[here + t] != 0 {
                return false;
            }
        }
        self.is_goal()
    }

    // Bring sub-table t's state at `depth` up to date: replay the path's turns from the deepest depth where it is current (the start always is),
    // and give each replayed state whose distance isn't exact yet its exact distance, from its stored value and the state before it (always exact by then)
    fn ensure(&mut self, depth: usize, t: usize) {
        let count = self.tables.len();
        let mut from = depth;
        while !self.current[from * count + t] {
            from -= 1;
        }
        for d in from..depth {
            let (here, next) = (d * count + t, (d + 1) * count + t);
            let (before, after) = self.outer.split_at_mut(next);
            let slot = &self.tables[t];
            let turn = slot.turns.as_ref().map_or(self.path[d], |map| map[self.path[d]] as usize);
            // Exact distance first, its index ranked straight from the parent (cheaper than ranking the moved pieces)
            if !self.exact[next] {
                let index = slot.table.child_index(&before[here], self.inner[here], turn, &mut self.moved);
                self.bounds[next] = near_values(self.bounds[here])[slot.table.value_at(index) as usize];
                self.exact[next] = true;
            }
            self.inner[next] = slot.table.step(&before[here], self.inner[here], turn, &mut after[0]);
            self.current[next] = true;
        }
    }

    // Replay the moves so far on the whole start and look it up among the targets
    fn is_goal(&self) -> bool {
        let (mut outer, mut inner) = self.whole;
        for &turn in &self.path {
            // Fresh copies, so entries a part doesn't write stay as they were
            let (mut next_outer, mut next_inner) = (outer, inner);
            self.full.outer.apply(&outer, turn, &mut next_outer);
            self.full.inner.apply(&inner, turn, &mut next_inner);
            (outer, inner) = (next_outer, next_inner);
        }
        self.goals.contains(&(outer, inner))
    }
}
