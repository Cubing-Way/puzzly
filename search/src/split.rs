// Goals too big for one exact table: split into sub-tables that each fit (the goal with some pieces, or their twists, left out), then IDA* guided by the largest of their distances

use std::rc::Rc;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPatternOrbitData, KPuzzle, KPuzzleOrbitName, KTransformationData};
use wasm_bindgen::prelude::*;

use crate::coords::{enumerate_turns, estimate_size, pattern_data, Coords, Units};
use crate::table::{DistanceTable, TableCore, UNSEEN};

// Same error text as twips, so the engine treats every solver the same
const NO_SOLUTION: &str = "No solution found!";
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
            // Ids on spots some turn moves (pieces on untouched spots are always checked, so they keep their ids)
            let moving = full.orbits().find(|orbit| orbit.name == info.name).map_or(&[][..], |orbit| &orbit.spots[..]);
            let mut on_moving = [false; 256];
            for &spot in moving {
                on_moving[first.pieces[spot as usize] as usize] = true;
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
    goals: Vec<(Units, Units)>,
    subs: Vec<Sub>,
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
        // Puzzle, targets and allowed turns, read like DistanceTable does
        let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
        let targets = serde_json::from_str::<Vec<serde_json::Value>>(targets_json)
            .map_err(|e| e.to_string())?
            .iter()
            .map(|target| pattern_data(&kpuzzle, &target.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        if targets.is_empty() {
            return Err("No target".to_owned());
        }
        let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
        let turns = enumerate_turns(&kpuzzle, &moves)?;
        // Numbering of the whole goal (too big for a table, but it tracks every piece for the goal check)
        let full = Coords::new(&kpuzzle, &targets, turns)?;
        // Each target's pieces in that numbering, to compare answers with
        let goals = targets.iter().map(|target| full.read(target).ok_or("A target doesn't fit its own numbering")).collect::<Result<Vec<_>, _>>()?;
        // The goal's items, orbit by orbit in the puzzle's order (classes in spot order)
        let mut items = vec![];
        for (o, info) in kpuzzle.orbit_info_iter().enumerate() {
            if let Some(orbit) = full.orbits().find(|orbit| orbit.name == info.name) {
                items.extend(orbit.classes.iter().map(|class| Item { orbit: o, id: class.id, twisted: class.twisted }));
            }
        }
        if items.is_empty() {
            return Err("Nothing to split".to_owned());
        }
        // Sub-tables that fit the budget, each a relabeling of the targets (repeats dropped)
        let fits = |kept: &[(usize, bool)]| {
            let relabel = Relabel::new(&kpuzzle, &targets, &full, &items, kept);
            let relaxed: Vec<KPatternData> = targets.iter().map(|target| relabel.apply(target)).collect();
            estimate_size(&kpuzzle, &relaxed, &full.turns).is_ok_and(|size| size as f64 <= max_states)
        };
        let mut subs: Vec<Sub> = vec![];
        for kept in plan(&items, fits) {
            // This sub-table's targets, its size, and its cache key
            let relabel = Relabel::new(&kpuzzle, &targets, &full, &items, &kept);
            let relaxed: Vec<KPatternData> = targets.iter().map(|target| relabel.apply(target)).collect();
            let states = estimate_size(&kpuzzle, &relaxed, &full.turns)?;
            let targets = format!("[{}]", relaxed.iter().map(|target| pattern_json(&kpuzzle, target)).collect::<Vec<_>>().join(","));
            if !subs.iter().any(|sub| sub.targets == targets) {
                subs.push(Sub { relabel, targets, states, table: None });
            }
        }
        if subs.is_empty() {
            return Err("No sub-table fits".to_owned());
        }
        // Move pruning: never two turns of one move in a row, and of two moves that commute only the lower-numbered one first
        let groups = moves.len();
        let mut follow = vec![true; groups * groups];
        for a in &full.turns {
            for b in &full.turns {
                if a.group == b.group || (b.group < a.group && commute(&kpuzzle, &a.data, &b.data)) {
                    follow[a.group * groups + b.group] = false;
                }
            }
        }
        Ok(SplitSearch { kpuzzle, full, goals, subs, follow, groups, nodes: 0.0 })
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

    // Largest sub-table distance from a start pattern: a sure lower bound on its answer, found without searching (Infinity when some sub-table can't reach a target)
    pub fn measure(&self, start_json: &str) -> Result<f64, String> {
        let start = pattern_data(&self.kpuzzle, start_json)?;
        // An untouched spot that's wrong can't be fixed by any turn
        if self.full.read(&start).is_none() {
            return Ok(f64::INFINITY);
        }
        let mut bound = 0;
        for sub in &self.subs {
            let table = sub.table.as_ref().ok_or("A sub-table isn't attached")?;
            match table.read(&sub.relabel.apply(&start)).map(|(outer, inner)| table.distance(&outer, inner)) {
                Some(distance) if distance != UNSEEN => bound = bound.max(distance),
                _ => return Ok(f64::INFINITY),
            }
        }
        Ok(bound as f64)
    }

    // Shortest answer from a start pattern, with twips's contract ({"maxDepth": 9} only finds answers shorter than 9, or {} for no limit);
    // {"maxNodes": n} gives up with NODE_LIMIT after n search nodes
    pub fn search(&mut self, start_json: &str, options_json: &str) -> Result<String, String> {
        // Start, depth limit (answers shorter than it), node budget, and the attached sub-tables
        self.nodes = 0.0;
        let start = pattern_data(&self.kpuzzle, start_json)?;
        let options: serde_json::Value = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
        let limit = options["maxDepth"].as_u64().unwrap_or(u64::MAX).min(MAX_LENGTH as u64 + 1);
        let max_nodes = options["maxNodes"].as_u64().unwrap_or(u64::MAX);
        let tables: Vec<Rc<TableCore>> = self.subs.iter().map(|sub| sub.table.clone().ok_or("A sub-table isn't attached")).collect::<Result<_, _>>()?;
        // The whole start (None: an untouched spot is wrong, no turn can fix it)
        let whole = self.full.read(&start).ok_or(NO_SOLUTION)?;
        // Search state: room for every depth up to MAX_LENGTH
        let count = tables.len();
        let mut ida = Ida {
            tables: &tables,
            full: &self.full,
            goals: &self.goals,
            whole,
            follow: &self.follow,
            groups: self.groups,
            outer: vec![Units::new(); (MAX_LENGTH as usize + 1) * count],
            inner: vec![0; (MAX_LENGTH as usize + 1) * count],
            bounds: vec![0; (MAX_LENGTH as usize + 1) * count],
            order: (0..count).collect(),
            path: vec![],
            cut: false,
            nodes: 0,
            max_nodes,
            gave_up: false,
        };
        // Each sub-table's start state; the largest distance is the first bound
        let mut bound = 0;
        for (t, sub) in self.subs.iter().enumerate() {
            let (outer, inner) = tables[t].read(&sub.relabel.apply(&start)).ok_or(NO_SOLUTION)?;
            let distance = tables[t].distance(&outer, inner);
            if distance == UNSEEN {
                return Err(NO_SOLUTION.to_owned());
            }
            bound = bound.max(distance);
            (ida.outer[t], ida.inner[t], ida.bounds[t]) = (outer, inner, distance);
        }
        // Deepen one move at a time until an answer turns up, the limit is reached, or no state was cut by the bound (nothing deeper exists)
        let mut found = false;
        while (bound as u64) < limit {
            ida.cut = false;
            if ida.dfs(0, bound, NO_GROUP) {
                found = true;
                break;
            }
            if ida.gave_up || !ida.cut {
                break;
            }
            bound += 1;
        }
        // Out of nodes, nothing within the limit, or the moves of the answer
        self.nodes = ida.nodes as f64;
        if ida.gave_up {
            return Err(NODE_LIMIT.to_owned());
        }
        if !found {
            return Err(NO_SOLUTION.to_owned());
        }
        Ok(ida.path.iter().map(|&turn| self.full.turns[turn].name.clone()).collect::<Vec<_>>().join(" "))
    }
}

// One IDA* run: sub-table states per depth (depth * tables + table) with their distance (or a bound above it), the moves so far, and whether the bound cut anything
struct Ida<'a> {
    tables: &'a [Rc<TableCore>],
    full: &'a Coords,
    goals: &'a [(Units, Units)],
    whole: (Units, Units),
    follow: &'a [bool],
    groups: usize,
    outer: Vec<Units>,
    inner: Vec<u64>,
    bounds: Vec<u8>,
    // Sub-tables in the order they are checked (the last one to rule a state out goes first)
    order: Vec<usize>,
    path: Vec<usize>,
    cut: bool,
    nodes: u64,
    // Node budget, and whether it ran out
    max_nodes: u64,
    gave_up: bool,
}

impl Ida<'_> {
    // Depth-first search below the state at `depth`, with `remaining` moves left in this bound; true once an answer is in `path`
    fn dfs(&mut self, depth: usize, remaining: u8, last: usize) -> bool {
        // Out of nodes: stop the whole search
        if self.nodes >= self.max_nodes {
            self.gave_up = true;
            return false;
        }
        self.nodes += 1;
        // Out of moves: every sub-table is at 0 here, so check the whole goal (sub-tables alone may miss pieces or mix targets)
        if remaining == 0 {
            if self.is_goal() {
                return true;
            }
            self.cut = true;
            return false;
        }
        let count = self.tables.len();
        let (here, next) = (depth * count, (depth + 1) * count);
        for turn in 0..self.full.turns.len() {
            // Skip a turn of the same move as the last one, or of a commuting move that should have come first
            let group = self.full.turns[turn].group;
            if last != NO_GROUP && !self.follow[last * self.groups + group] {
                continue;
            }
            // Sub-tables that could rule the child out (one move changes a distance by at most one), stopping at the first that needs more moves than are left
            let mut ruled_out = false;
            for position in 0..count {
                let t = self.order[position];
                if self.bounds[here + t] + 1 < remaining {
                    continue;
                }
                let (before, after) = self.outer.split_at_mut(next + t);
                let inner = self.tables[t].step(&before[here + t], self.inner[here + t], turn, &mut after[0]);
                let distance = self.tables[t].distance(&after[0], inner);
                if distance >= remaining {
                    // A deeper bound may get past it (unreachable states never will); this sub-table is checked first from now on
                    if distance != UNSEEN {
                        self.cut = true;
                    }
                    self.order[..=position].rotate_right(1);
                    ruled_out = true;
                    break;
                }
                (self.inner[next + t], self.bounds[next + t]) = (inner, distance);
            }
            if ruled_out {
                continue;
            }
            // The others only follow the turn: their distance stays below what is left, so it isn't looked up
            for t in 0..count {
                if self.bounds[here + t] + 1 < remaining {
                    let (before, after) = self.outer.split_at_mut(next + t);
                    self.inner[next + t] = self.tables[t].step(&before[here + t], self.inner[here + t], turn, &mut after[0]);
                    self.bounds[next + t] = self.bounds[here + t] + 1;
                }
            }
            self.path.push(turn);
            if self.dfs(depth + 1, remaining - 1, group) {
                return true;
            }
            self.path.pop();
            if self.gave_up {
                return false;
            }
        }
        false
    }

    // Replay the moves so far on the whole start and compare with every target
    fn is_goal(&self) -> bool {
        let (mut outer, mut inner) = self.whole;
        for &turn in &self.path {
            // Fresh copies, so entries a part doesn't write stay as they were
            let (mut next_outer, mut next_inner) = (outer, inner);
            self.full.outer.apply(&outer, turn, &mut next_outer);
            self.full.inner.apply(&inner, turn, &mut next_inner);
            (outer, inner) = (next_outer, next_inner);
        }
        self.goals.iter().any(|goal| goal.0 == outer && goal.1 == inner)
    }
}
