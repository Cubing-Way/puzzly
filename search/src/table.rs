// Exact distance tables: every state of a goal's tracked pieces with its fewest-moves distance, so a goal that fits needs no search

use std::collections::HashSet;
use std::rc::Rc;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPuzzle};
use wasm_bindgen::prelude::*;

use crate::coords::{enumerate_turns, pattern_data, Coords, Units};
use crate::solvable::closed_targets;
use crate::split::{answer_list, deepen, move_pruning, read_options, GoalCheck, SearchOptions, Slot, NO_SOLUTION};

// Version of a table's saved bytes: bump it whenever coords.rs numbers states differently (or the layout below changes), so tables saved by older code are rebuilt, never misread
// Filling the table: its layout, and the breadth-first passes
mod fill;

pub const TABLE_FORMAT: u32 = 3;
// First bytes of a saved table, to recognise one
const MAGIC: &[u8; 4] = b"PZT\0";
// Saved table header: magic, format (u32), states (u64), depth (u8); the 2-bit values follow
const HEADER: usize = 4 + 4 + 8 + 1;

// Version of saved table bytes (the worker keys stored tables with it, so a new version never meets old bytes)
#[wasm_bindgen(js_name = tableFormat)]
pub fn table_format() -> u32 {
    TABLE_FORMAT
}

// Stored value of a state not reached (yet): the other 2-bit values hold distances mod 3
const EMPTY: u8 = 3;
// Distance of a state no allowed turns bring to a target
pub const UNSEEN: u8 = u8::MAX;
// Layers stay a list of states while smaller than 1/QUEUE_SHARE of the table; bigger ones are found by scanning
const QUEUE_SHARE: u64 = 256;
// Longest list a layer may stay
const QUEUE_LIMIT: u64 = 1 << 20;
// Twist values handled at once inside a block (keeps the per-block neighbour buffer small)
const CHUNK: u64 = 4096;

// Distance of every state to the nearest target, for one set of targets and allowed moves (shared, so split searches can use it too)
#[wasm_bindgen]
pub struct DistanceTable {
    core: Rc<TableCore>,
}

// A built table's numbering and distances
pub struct TableCore {
    kpuzzle: KPuzzle,
    coords: Coords,
    // Each state's distance mod 3 (or EMPTY) in 2 bits, four states per byte (lowest index in the low bits); a turn changes a distance by at most one,
    // so a neighbour's exact distance follows from the state's (see `near`), and a start's from walking down to a target (see `distance`)
    cells: Vec<u8>,
    // Inner part after each turn: inner_next[turn * inner size + inner value]
    inner_next: Vec<u16>,
    // Deepest distance in the table
    depth: u8,
    // Each target's state, and the move pruning, for listing answers
    goals: HashSet<(Units, Units)>,
    follow: Vec<bool>,
    groups: usize,
}

// Value stored for a state (distance mod 3, or EMPTY)
#[inline]
fn get(cells: &[u8], index: u64) -> u8 {
    (cells[(index >> 2) as usize] >> ((index & 3) * 2)) & 3
}

// Store a state's value
#[inline]
fn set(cells: &mut [u8], index: u64, value: u8) {
    let byte = &mut cells[(index >> 2) as usize];
    let shift = (index & 3) * 2;
    *byte = (*byte & !(3 << shift)) | (value << shift);
}

// Exact distance of a neighbour of a state at distance `parent`, from the neighbour's stored value: it is parent − 1, parent or parent + 1, the one with that value mod 3
#[inline]
pub(crate) fn near(parent: u8, value: u8) -> u8 {
    if value == EMPTY {
        return UNSEEN;
    }
    (parent + (value + 4 - parent % 3) % 3).wrapping_sub(1)
}

// Exact distances of a state's neighbours by stored value (index = value), for a state at distance `parent`
#[inline]
pub(crate) fn near_values(parent: u8) -> [u8; 4] {
    [near(parent, 0), near(parent, 1), near(parent, 2), UNSEEN]
}

// Puzzle, targets (a JSON list of patterns, or one with "solvable with" moves: closed under them) and allowed moves from the JSON the worker sends, with the state numbering they give
fn setup(kpuzzle_json: &str, targets_json: &str, moves_json: &str) -> Result<(KPuzzle, Vec<KPatternData>, Coords), String> {
    let kpuzzle = KPuzzle::try_from_json(kpuzzle_json.as_bytes()).map_err(|e| e.to_string())?;
    let moves: Vec<Move> = serde_json::from_str(moves_json).map_err(|e| e.to_string())?;
    let turns = enumerate_turns(&kpuzzle, &moves)?;
    let targets = closed_targets(&kpuzzle, targets_json, &turns)?;
    let coords = Coords::new(&kpuzzle, &targets, turns)?;
    Ok((kpuzzle, targets, coords))
}

// What listing answers needs besides the distances: each target's state in the numbering (a set: closed targets may be many), and the move pruning
fn listing_parts(kpuzzle: &KPuzzle, targets: &[KPatternData], coords: &Coords) -> Result<(HashSet<(Units, Units)>, Vec<bool>, usize), String> {
    let goals = targets.iter().map(|target| coords.read(target).ok_or("A target doesn't fit its own numbering")).collect::<Result<HashSet<_>, _>>()?;
    let (follow, groups) = move_pruning(kpuzzle, &coords.turns);
    Ok((goals, follow, groups))
}

// Inner turn table: every inner value through every turn
fn inner_turns(coords: &Coords) -> Vec<u16> {
    let turn_count = coords.turns.len();
    let inner_size = coords.inner.size;
    let mut inner_next = vec![0u16; turn_count * inner_size as usize];
    let (mut units, mut moved) = (Units::new(), Units::new());
    for inner in 0..inner_size {
        coords.inner.unrank(inner, &coords.binomials, &mut units);
        for turn in 0..turn_count {
            coords.inner.apply(&units, turn, &mut moved);
            inner_next[turn * inner_size as usize + inner as usize] = coords.inner.rank(&moved, &coords.binomials) as u16;
        }
    }
    inner_next
}

#[wasm_bindgen]
impl DistanceTable {
    // Build the table by breadth-first search from every target at once; fails (so the caller can use twips) when it has more than max_states states
    #[wasm_bindgen(constructor)]
    pub fn new(kpuzzle_json: &str, targets_json: &str, moves_json: &str, max_states: f64) -> Result<DistanceTable, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        // Puzzle, targets, moves and state numbering, with the size check before anything big is allocated
        let (kpuzzle, targets, mut coords) = setup(kpuzzle_json, targets_json, moves_json)?;
        let size = coords.size();
        if size as f64 > max_states || size >= u32::MAX as u64 {
            return Err(format!("Too big for one table ({} states)", size));
        }
        // Turn tables for the outer part, so each block's neighbours are lookups
        coords.build_tables();
        let inner_next = inner_turns(&coords);
        let (goals, follow, groups) = listing_parts(&kpuzzle, &targets, &coords)?;
        let mut table = TableCore { kpuzzle, coords, cells: vec![0xFF; (size as usize).div_ceil(4)], inner_next, depth: 0, goals, follow, groups };
        table.fill(&targets)?;
        // The outer turn tables only speed up the fill; answers unpack pieces instead
        table.coords.outer.drop_tables();
        Ok(DistanceTable { core: Rc::new(table) })
    }

    // A table saved earlier with toBytes, for the same targets and moves: the numbering is rebuilt (cheap) and must match the saved header, else it fails (rebuild it instead)
    #[wasm_bindgen(js_name = fromBytes)]
    pub fn from_bytes(kpuzzle_json: &str, targets_json: &str, moves_json: &str, bytes: &[u8]) -> Result<DistanceTable, String> {
        // Show Rust panics in the browser console instead of a bare "unreachable"
        console_error_panic_hook::set_once();
        let (kpuzzle, targets, coords) = setup(kpuzzle_json, targets_json, moves_json)?;
        // Header: same magic, same format, same state count, and exactly that many values after it
        let size = coords.size();
        let fits = bytes.len() == HEADER + (size as usize).div_ceil(4)
            && &bytes[..4] == MAGIC
            && bytes[4..8] == TABLE_FORMAT.to_le_bytes()
            && bytes[8..16] == size.to_le_bytes();
        if !fits {
            return Err("Saved table doesn't match this goal or table format".to_owned());
        }
        let inner_next = inner_turns(&coords);
        let (goals, follow, groups) = listing_parts(&kpuzzle, &targets, &coords)?;
        Ok(DistanceTable { core: Rc::new(TableCore { kpuzzle, coords, cells: bytes[HEADER..].to_vec(), inner_next, depth: bytes[16], goals, follow, groups }) })
    }

    // The table as bytes (header + 2-bit values), to save and load later with fromBytes
    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        let core = &self.core;
        let mut bytes = Vec::with_capacity(HEADER + core.cells.len());
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&TABLE_FORMAT.to_le_bytes());
        bytes.extend_from_slice(&core.coords.size().to_le_bytes());
        bytes.push(core.depth);
        bytes.extend_from_slice(&core.cells);
        bytes
    }

    // Shortest moves from a start pattern to a target; options_json is like twips's ({"maxDepth": 9} only finds answers shorter than 9, or {})
    pub fn search(&self, start_json: &str, options_json: &str) -> Result<String, String> {
        self.core.search(start_json, options_json)
    }

    // Every answer from a start pattern shorter than {"maxDepth": n}, shortest first, up to {"maxAnswers": k}, as a JSON list of move texts
    // (an answer never passes through a target on its way): IDA* with this table as its exact guide; {"minDepth": d, "after": "R U"} lists one page, as SplitSearch.list
    pub fn list(&self, start_json: &str, options_json: &str) -> Result<String, String> {
        let core = &self.core;
        // Start, depth limit (answers shorter than it), answers wanted and the page (an exact table needs no node budget)
        let start = pattern_data(&core.kpuzzle, start_json)?;
        let options = SearchOptions { max_nodes: u64::MAX, ..read_options(options_json)? };
        // The start's tracked pieces (none when an untouched spot is wrong: no turn can fix it), also as this table's state
        let whole = core.coords.read(&start).ok_or(NO_SOLUTION)?;
        let inner = core.coords.inner.rank(&whole.1, &core.coords.binomials);
        // Deepen with this one table, checking answers on its own numbering
        let check = GoalCheck { full: &core.coords, goals: &core.goals, follow: &core.follow, groups: core.groups };
        let (answers, _, _) = deepen(&[Slot::plain(core)], &[(whole.0, inner)], whole, &check, &options, true);
        Ok(answer_list(&core.coords, &answers?))
    }

    // Fewest moves from a start pattern to a target, without listing them (Infinity when the allowed moves can't get there)
    pub fn measure(&self, start_json: &str) -> Result<f64, String> {
        let start = pattern_data(&self.core.kpuzzle, start_json)?;
        Ok(match self.core.read(&start).map(|(outer, inner)| self.core.distance(&outer, inner)) {
            Some(distance) if distance != UNSEEN => distance as f64,
            _ => f64::INFINITY,
        })
    }

    // Number of states in the table
    pub fn states(&self) -> f64 {
        self.core.coords.size() as f64
    }

    // Memory the table holds, in bytes (distances plus the inner turn table)
    pub fn bytes(&self) -> f64 {
        (self.core.cells.len() + self.core.inner_next.len() * 2 + self.core.coords.outer.table_bytes()) as f64
    }

    // Deepest distance in the table (the hardest state's fewest moves)
    pub fn depth(&self) -> u8 {
        self.core.depth
    }
}

impl DistanceTable {
    // The table data, for a split search that keeps using it
    pub(crate) fn core(&self) -> Rc<TableCore> {
        Rc::clone(&self.core)
    }
}

impl TableCore {
    // Shortest moves from a start pattern to a target, by descent
    fn search(&self, start_json: &str, options_json: &str) -> Result<String, String> {
        let start = pattern_data(&self.kpuzzle, start_json)?;
        let options: serde_json::Value = serde_json::from_str(options_json).map_err(|e| e.to_string())?;
        // Tracked pieces of the start (none when an untouched spot is wrong: no turn can fix it)
        let (outer, inner) = self.coords.read(&start).ok_or(NO_SOLUTION)?;
        let inner = self.coords.inner.rank(&inner, &self.coords.binomials);
        // The walk down to a target is a shortest answer; none when unreachable, or longer than allowed
        let answer = self.descend(&outer, inner).ok_or(NO_SOLUTION)?;
        if options["maxDepth"].as_u64().is_some_and(|max| answer.len() as u64 >= max) {
            return Err(NO_SOLUTION.to_owned());
        }
        Ok(answer.iter().map(|&turn| self.coords.turns[turn].name.clone()).collect::<Vec<_>>().join(" "))
    }

    // Walk down from a state to a target, each time by the first turn (in turn order) to a neighbour one move closer: a shortest answer as turns (None when unreachable);
    // a neighbour stored as the state's distance − 1 mod 3 is one closer (neighbours are within one), and a state with none is a target
    fn descend(&self, outer: &Units, inner: u64) -> Option<Vec<usize>> {
        let mut value = self.value(outer, inner);
        if value == EMPTY {
            return None;
        }
        let (mut outer, mut inner) = (*outer, inner);
        let (mut scratch, mut moved) = (Units::new(), Units::new());
        let mut path = vec![];
        loop {
            let closer = (value + 2) % 3;
            let Some(turn) = (0..self.coords.turns.len()).find(|&turn| get(&self.cells, self.child_index(&outer, inner, turn, &mut scratch)) == closer) else {
                return Some(path);
            };
            inner = self.step(&outer, inner, turn, &mut moved);
            outer = moved;
            value = closer;
            path.push(turn);
        }
    }

    // A pattern's state in this table: outer pieces and inner value (None when an untouched spot can't match)
    pub fn read(&self, pattern: &KPatternData) -> Option<(Units, u64)> {
        let (outer, inner) = self.coords.read(pattern)?;
        Some((outer, self.coords.inner.rank(&inner, &self.coords.binomials)))
    }

    // A state after one turn: outer pieces into `out`, inner value returned
    #[inline]
    pub fn step(&self, outer: &Units, inner: u64, turn: usize, out: &mut Units) -> u64 {
        self.coords.outer.apply(outer, turn, out);
        self.inner_next[turn * self.coords.inner.size as usize + inner as usize] as u64
    }

    // A state's exact distance (UNSEEN when no allowed turns reach a target from it), by walking down to a target
    pub fn distance(&self, outer: &Units, inner: u64) -> u8 {
        self.descend(outer, inner).map_or(UNSEEN, |path| path.len() as u8)
    }

    // A state's stored value (distance mod 3, or EMPTY): with the exact distance of a neighbour, `near` gives its exact distance
    #[inline]
    pub(crate) fn value(&self, outer: &Units, inner: u64) -> u8 {
        get(&self.cells, self.index(outer, inner))
    }
}
