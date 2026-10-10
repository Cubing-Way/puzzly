// Goals too big for one exact table: split into sub-tables that each fit (the goal with some pieces, or their twists, left out), then IDA* guided by the largest of their distances

use std::cmp::Reverse;
use std::collections::HashSet;
use std::rc::Rc;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPatternOrbitData, KPuzzle, KPuzzleOrbitName, KTransformationData};
use wasm_bindgen::prelude::*;

use crate::coords::{enumerate_turns, estimate_size, pattern_data, twist_factor, Coords, Turn, Units};
use crate::solvable::{close, read_orbit_tables, read_targets, table_targets};
use crate::symmetry::{Rotation, Rotations};
use crate::table::{near_values, DistanceTable, TableCore, UNSEEN};

// The parts of a split search: how a pattern becomes a sub-table's, which pieces each sub-table keeps, the IDA* driver, and one IDA* run
mod driver;
mod ida;
mod plan;
mod relabel;

pub(crate) use driver::*;
use ida::*;
use plan::*;
use relabel::*;

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
// Most targets a goal may have for its sub-goals to be compared in every rotation (each rotation relabels and prints them all)
const MAX_ROTATED_TARGETS: usize = 64;

// One piece class of the goal that sub-tables may track: a single piece or a group sharing an id, with or without a twist that counts,
// and the moves that turn its spots in the first target (bit = turn group, mod 64)
struct Item {
    orbit: usize,
    id: u8,
    twisted: bool,
    moves: u64,
}

// How a plan grows each sub-table from its seed: the seed's own orbit first (all corners together: PLL's corner cycles, DR's corner permutation),
// or the items the most moves turn together with the ones kept so far (a pair's corner and edge share two faces: F2L pairs whole)
#[derive(Clone, Copy)]
enum Order {
    Orbit,
    Related,
}

// One sub-table: its targets as JSON (the cache key), its estimated size, and the table once attached
struct Sub {
    targets: String,
    states: u64,
    table: Option<Rc<TableCore>>,
}

// One lookup per node: the sub-table it reads, the rotation it reads it through (0 = as it is), and how a pattern becomes that table's
struct View {
    sub: usize,
    rotation: usize,
    relabel: Relabel,
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
    // Lookups per node: each planned sub-table, read through the rotation that turns it into its table's sub-goal
    views: Vec<View>,
    // The rotations that keep the moves (their turn maps, for rotated views)
    rotations: Rotations,
    // Move pruning: may a turn of group b follow one of group a ([a * groups + b])
    follow: Vec<bool>,
    groups: usize,
    // Search nodes visited by the last search (for benchmarks), and where it stopped when it ran out of nodes
    nodes: f64,
    stop: Option<Stop>,
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
        // The goal's items, orbit by orbit in the puzzle's order (an orbit's sets by first spot, classes in spot order; a class in several sets is one item),
        // each with the moves that turn a spot it holds in the first target
        let moves_of = |info: &cubing::kpuzzle::KPuzzleOrbitInfo, id: u8| {
            let spots: Vec<usize> = (0..info.num_pieces as usize).filter(|&spot| targets[0][&info.name].pieces[spot] == id).collect();
            full.turns.iter().filter(|turn| spots.iter().any(|&spot| turn.data[&info.name].permutation[spot] as usize != spot)).fold(0u64, |mask, turn| mask | 1 << (turn.group % 64))
        };
        let mut items: Vec<Item> = vec![];
        for (o, info) in kpuzzle.orbit_info_iter().enumerate() {
            let mut sets: Vec<_> = full.orbits().filter(|orbit| orbit.name == info.name).collect();
            sets.sort_by_key(|orbit| orbit.spots.first().copied());
            for class in sets.iter().flat_map(|orbit| orbit.classes.iter()) {
                match items.iter_mut().find(|item| item.orbit == o && item.id == class.id) {
                    Some(item) => item.twisted |= class.twisted,
                    None => items.push(Item { orbit: o, id: class.id, twisted: class.twisted, moves: moves_of(info, class.id) }),
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
        // Planned sub-tables (the items each one keeps): both plans together, since each sees what the other can't (their largest distance is the bound;
        // either alone left 2–13× more search nodes on PLL, XXXCross or F2L pairs)
        let mut plans = [plan(&items, Order::Orbit, &fits), plan(&items, Order::Related, &fits)].concat();
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
        // The rotations that keep the moves (24 for face turns, 8 for DR moves); sub-goals are compared in each of them unless the goal has "solvable with" moves
        // (its sub-goals carry those moves) or too many targets to print in every rotation
        let rotations = Rotations::new(&kpuzzle, &full.turns);
        let rotate = free.is_empty() && targets.len() <= MAX_ROTATED_TARGETS;
        let json = |target: &KPatternData| pattern_json(&kpuzzle, target);
        let mut subs: Vec<Sub> = vec![];
        let mut views: Vec<View> = vec![];
        let mut seen: Vec<String> = vec![];
        for kept in plans {
            // This sub-table's targets, its size, and its targets as JSON (with the goal's moves when they add targets to this sub-goal); one both plans found is read once
            let relabel = Relabel::new(&kpuzzle, &targets, &full, &items, &kept);
            let relaxed: Vec<KPatternData> = targets.iter().map(|target| relabel.apply(target)).collect();
            let states = estimate_size(&kpuzzle, &relaxed, &full.turns)?;
            let own = table_targets(&kpuzzle, &relaxed, &free, &full.turns, json)?;
            if seen.contains(&own) {
                continue;
            }
            seen.push(own.clone());
            // The table to read: of every rotated copy of this sub-goal, the one whose targets print first (the same table for every copy, from any goal:
            // "cross + DFR" and "cross + DBL" share one), read through the rotation that turns this sub-goal into it
            let mut best: (String, usize, Option<Relabel>) = (own, 0, None);
            if rotate {
                for (r, rotation) in rotations.list.iter().enumerate() {
                    let candidate = relabel.rotated(rotation, &targets[0]);
                    let turned: Vec<KPatternData> = targets.iter().map(|target| candidate.apply(target)).collect();
                    let text = table_targets(&kpuzzle, &turned, &free, &full.turns, json)?;
                    if best.2.is_none() || text < best.0 {
                        best = (text, r, Some(candidate));
                    }
                }
            }
            let (key, rotation, view) = (best.0, best.1, best.2.unwrap_or(relabel));
            // Its table: one already planned with the same targets, or a new one
            let sub = match subs.iter().position(|sub| sub.targets == key) {
                Some(sub) => sub,
                None => {
                    subs.push(Sub { targets: key, states, table: None });
                    subs.len() - 1
                }
            };
            views.push(View { sub, rotation, relabel: view });
        }
        if subs.is_empty() {
            return Err("No sub-table fits".to_owned());
        }
        // Move pruning: never two turns of one move in a row, and of two moves that commute only the lower-numbered one first
        let (follow, groups) = move_pruning(&kpuzzle, &full.turns);
        Ok(SplitSearch { kpuzzle, full, goals, subs, views, rotations, follow, groups, nodes: 0.0, stop: None })
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
        for view in &self.views {
            let table = self.subs[view.sub].table.as_ref().ok_or("A sub-table isn't attached")?;
            match table.read(&view.relabel.apply(&start)).map(|(outer, inner)| table.distance(&outer, inner)) {
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

    // Where the last search stopped when it ran out of nodes, as JSON {"bound", "path": the moves it was about to search (every path before them is done),
    // "cut": whether the bound cut a state so far}, or null when it didn't run out
    pub fn stopped(&self) -> String {
        self.stop.as_ref().map_or("null".to_owned(), |stop| serde_json::json!({ "bound": stop.bound, "path": path_text(&self.full, &stop.path), "cut": stop.cut }).to_string())
    }

    // Every path of `length` moves an iteration may start with (move pruning only), in the order it visits them, as a JSON list of move texts:
    // the tasks a long search is split into
    pub fn prefixes(&self, length: usize) -> String {
        let check = GoalCheck { full: &self.full, goals: &self.goals, follow: &self.follow, groups: self.groups };
        answer_list(&self.full, &prefixes(&check, length))
    }

    // One IDA* iteration of a search split over workers: answers of exactly `bound` moves (at least the start's measure) through these first moves
    // (a JSON list of move texts, tried in order; "" = every path), with a node budget; gives JSON {"found": index of the first prefix with an answer or -1,
    // "answer": its moves, "cut": whether a deeper bound could still find one, "nodes", "gaveUp": the budget ran out}
    pub fn iterate(&mut self, start_json: &str, bound: u8, prefixes_json: &str, max_nodes: f64) -> Result<String, String> {
        // The first moves as turn numbers, the sub-tables and the start's states
        let texts: Vec<String> = serde_json::from_str(prefixes_json).map_err(|e| e.to_string())?;
        let prefixes = texts.iter().map(|text| path_turns(&self.full, text).ok_or("A prefix move isn't allowed")).collect::<Result<Vec<_>, _>>()?;
        let (tables, whole, starts) = self.begin(start_json)?;
        // The iteration (a start that can't reach the goal has no answer at any bound)
        let check = GoalCheck { full: &self.full, goals: &self.goals, follow: &self.follow, groups: self.groups };
        let budget = if max_nodes >= u64::MAX as f64 { u64::MAX } else { max_nodes.max(0.0) as u64 };
        let result = iterate(&tables, &starts, whole, &check, bound, &prefixes, budget).ok_or(NO_SOLUTION)?;
        self.nodes = result.nodes as f64;
        let (found, answer) = result.found.map_or((-1, String::new()), |(index, path)| (index as i64, path_text(&self.full, &path)));
        Ok(serde_json::json!({ "found": found, "answer": answer, "cut": result.cut, "nodes": result.nodes, "gaveUp": result.gave_up }).to_string())
    }
}

// A search's lookups (each sub-table, through its view's rotation), the whole start, and each lookup's start state
type Begin = (Vec<Slot>, (Units, Units), Vec<(Units, u64)>);

// Rust-only part of SplitSearch (not exported to JS)
impl SplitSearch {
    // Read a start pattern for a search: the attached sub-tables as lookups, the whole start (an untouched spot that's wrong: NO_SOLUTION, no turn can fix it),
    // and each lookup's start state (rotated for rotated views)
    fn begin(&self, start_json: &str) -> Result<Begin, String> {
        let start = pattern_data(&self.kpuzzle, start_json)?;
        let tables: Vec<Slot> = self
            .views
            .iter()
            .map(|view| {
                let table = self.subs[view.sub].table.clone().ok_or("A sub-table isn't attached")?;
                let turns = (view.rotation > 0).then(|| self.rotations.list[view.rotation].turns.clone());
                Ok(Slot { table, turns })
            })
            .collect::<Result<_, String>>()?;
        let whole = self.full.read(&start).ok_or(NO_SOLUTION)?;
        let starts = self.views.iter().zip(&tables).map(|(view, slot)| slot.table.read(&view.relabel.apply(&start))).collect::<Option<Vec<_>>>().ok_or(NO_SOLUTION)?;
        Ok((tables, whole, starts))
    }

    // IDA* from a start pattern on the attached sub-tables: the first shortest answer, or with `list` every answer up to maxAnswers
    fn run(&mut self, start_json: &str, options_json: &str, list: bool) -> Result<Vec<Vec<usize>>, String> {
        // Start, depth limit (answers shorter than it), node budget, answers wanted, and the attached sub-tables
        self.nodes = 0.0;
        let options = read_options(options_json)?;
        let (tables, whole, starts) = self.begin(start_json)?;
        // Deepen, checking answers on the whole goal
        let check = GoalCheck { full: &self.full, goals: &self.goals, follow: &self.follow, groups: self.groups };
        let (answers, nodes, stop) = deepen(&tables, &starts, whole, &check, &options, list);
        self.nodes = nodes as f64;
        self.stop = stop;
        answers.map_err(|error| error.to_owned())
    }
}
