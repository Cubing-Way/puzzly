// Exact distance tables: every state of a goal's tracked pieces with its fewest-moves distance, so a goal that fits needs no search

use std::collections::HashSet;
use std::rc::Rc;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPuzzle};
use wasm_bindgen::prelude::*;

use crate::coords::{enumerate_turns, pattern_data, Coords, Units};
use crate::solvable::closed_targets;
use crate::split::{answer_list, deepen, move_pruning, read_options, GoalCheck, Slot, NO_SOLUTION};

// Version of a table's saved bytes: bump it whenever coords.rs numbers states differently (or the layout below changes), so tables saved by older code are rebuilt, never misread
pub const TABLE_FORMAT: u32 = 2;
// First bytes of a saved table, to recognise one
const MAGIC: &[u8; 4] = b"PZT\0";
// Saved table header: magic, format (u32), states (u64), depth (u8); the 4-bit distances follow
const HEADER: usize = 4 + 4 + 8 + 1;

// Version of saved table bytes (the worker keys stored tables with it, so a new version never meets old bytes)
#[wasm_bindgen(js_name = tableFormat)]
pub fn table_format() -> u32 {
    TABLE_FORMAT
}

// Table value for a state not reached (yet): distances 0..14 fit in the other 4-bit values
pub const UNSEEN: u8 = 15;
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
    // 4 bits per state, two states per byte (even index in the low half)
    nibbles: Vec<u8>,
    // Inner part after each turn: inner_next[turn * inner size + inner value]
    inner_next: Vec<u16>,
    // Deepest distance in the table
    depth: u8,
    // Each target's state, and the move pruning, for listing answers
    goals: HashSet<(Units, Units)>,
    follow: Vec<bool>,
    groups: usize,
}

// Distance stored for a state
#[inline]
fn get(nibbles: &[u8], index: u64) -> u8 {
    (nibbles[(index >> 1) as usize] >> ((index & 1) * 4)) & 15
}

// Store a state's distance
#[inline]
fn set(nibbles: &mut [u8], index: u64, value: u8) {
    let byte = &mut nibbles[(index >> 1) as usize];
    let shift = (index & 1) * 4;
    *byte = (*byte & !(15 << shift)) | (value << shift);
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
        let mut table = TableCore { kpuzzle, coords, nibbles: vec![0xFF; (size as usize).div_ceil(2)], inner_next, depth: 0, goals, follow, groups };
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
        // Header: same magic, same format, same state count, and exactly that many distances after it
        let size = coords.size();
        let fits = bytes.len() == HEADER + (size as usize).div_ceil(2)
            && &bytes[..4] == MAGIC
            && bytes[4..8] == TABLE_FORMAT.to_le_bytes()
            && bytes[8..16] == size.to_le_bytes();
        if !fits {
            return Err("Saved table doesn't match this goal or table format".to_owned());
        }
        let inner_next = inner_turns(&coords);
        let (goals, follow, groups) = listing_parts(&kpuzzle, &targets, &coords)?;
        Ok(DistanceTable { core: Rc::new(TableCore { kpuzzle, coords, nibbles: bytes[HEADER..].to_vec(), inner_next, depth: bytes[16], goals, follow, groups }) })
    }

    // The table as bytes (header + 4-bit distances), to save and load later with fromBytes
    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        let core = &self.core;
        let mut bytes = Vec::with_capacity(HEADER + core.nibbles.len());
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&TABLE_FORMAT.to_le_bytes());
        bytes.extend_from_slice(&core.coords.size().to_le_bytes());
        bytes.push(core.depth);
        bytes.extend_from_slice(&core.nibbles);
        bytes
    }

    // Shortest moves from a start pattern to a target; options_json is like twips's ({"maxDepth": 9} only finds answers shorter than 9, or {})
    pub fn search(&self, start_json: &str, options_json: &str) -> Result<String, String> {
        self.core.search(start_json, options_json)
    }

    // Every answer from a start pattern shorter than {"maxDepth": n}, shortest first, up to {"maxAnswers": k}, as a JSON list of move texts
    // (an answer never passes through a target on its way): IDA* with this table as its exact guide
    pub fn list(&self, start_json: &str, options_json: &str) -> Result<String, String> {
        let core = &self.core;
        // Start, depth limit (answers shorter than it) and answers wanted (an exact table needs no node budget)
        let start = pattern_data(&core.kpuzzle, start_json)?;
        let (limit, _, max_answers) = read_options(options_json)?;
        // The start's tracked pieces (none when an untouched spot is wrong: no turn can fix it), also as this table's state
        let whole = core.coords.read(&start).ok_or(NO_SOLUTION)?;
        let inner = core.coords.inner.rank(&whole.1, &core.coords.binomials);
        // Deepen with this one table, checking answers on its own numbering
        let check = GoalCheck { full: &core.coords, goals: &core.goals, follow: &core.follow, groups: core.groups };
        let (answers, _) = deepen(&[Slot::plain(core)], &[(whole.0, inner)], whole, &check, limit, u64::MAX, Some(max_answers));
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
        (self.core.nibbles.len() + self.core.inner_next.len() * 2 + self.core.coords.outer.table_bytes()) as f64
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
        let (mut outer, inner) = self.coords.read(&start).ok_or(NO_SOLUTION)?;
        let mut inner = self.coords.inner.rank(&inner, &self.coords.binomials);
        let mut distance = get(&self.nibbles, self.index(&outer, inner));
        // Unreachable, or longer than allowed
        if distance == UNSEEN || options["maxDepth"].as_u64().is_some_and(|max| distance as u64 >= max) {
            return Err(NO_SOLUTION.to_owned());
        }
        // Descend: any turn that lowers the distance by one is the start of a shortest answer
        let mut answer = vec![];
        let mut moved = Units::new();
        while distance > 0 {
            let step = (0..self.coords.turns.len()).find_map(|turn| {
                self.coords.outer.apply(&outer, turn, &mut moved);
                let next_inner = self.inner_next[turn * self.coords.inner.size as usize + inner as usize] as u64;
                (get(&self.nibbles, self.index(&moved, next_inner)) == distance - 1).then_some((turn, moved, next_inner))
            });
            let (turn, next_outer, next_inner) = step.ok_or("Distance table is inconsistent")?;
            answer.push(self.coords.turns[turn].name.clone());
            outer = next_outer;
            inner = next_inner;
            distance -= 1;
        }
        Ok(answer.join(" "))
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

    // A state's distance (UNSEEN when no allowed turns reach a target from it)
    #[inline]
    pub fn distance(&self, outer: &Units, inner: u64) -> u8 {
        get(&self.nibbles, self.index(outer, inner))
    }
}

// Where the table's states are and how to reach their neighbours: index = outer positions × block + outer twists × inner size + inner value
struct Layout {
    turn_count: usize,
    inner_size: u64,
    twist_space: u64,
    block: u64,
    blocks: u64,
}

impl TableCore {
    // Table index from outer pieces and an inner value
    #[inline]
    fn index(&self, outer: &Units, inner: u64) -> u64 {
        self.coords.outer.rank(outer, &self.coords.binomials) * self.coords.inner.size + inner
    }

    // Table index of a state's child after one turn (ranked straight from the parent when the outer part allows it, else via `scratch`)
    #[inline]
    pub(crate) fn child_index(&self, outer: &Units, inner: u64, turn: usize, scratch: &mut Units) -> u64 {
        let inner = self.inner_next[turn * self.coords.inner.size as usize + inner as usize] as u64;
        let outer = if self.coords.outer.singles {
            self.coords.outer.rank_after(outer, turn)
        } else {
            self.coords.outer.apply(outer, turn, scratch);
            self.coords.outer.rank(scratch, &self.coords.binomials)
        };
        outer * self.coords.inner.size + inner
    }

    // Distance stored at a table index
    #[inline]
    pub(crate) fn distance_at(&self, index: u64) -> u8 {
        get(&self.nibbles, index)
    }

    // Breadth-first fill from the targets, one layer at a time: a list while layers are small, then block scans (backward once few states are left)
    fn fill(&mut self, targets: &[KPatternData]) -> Result<(), String> {
        let outer = &self.coords.outer;
        let layout = Layout {
            turn_count: self.coords.turns.len(),
            inner_size: self.coords.inner.size,
            twist_space: outer.twist_space,
            block: outer.twist_space * self.coords.inner.size,
            blocks: outer.positions,
        };
        let size = self.coords.size();
        let mut nibbles = std::mem::take(&mut self.nibbles);
        let inner_next = std::mem::take(&mut self.inner_next);
        // Targets start at distance 0
        let mut queue: Option<Vec<u32>> = Some(vec![]);
        for target in targets {
            let (outer, inner) = self.coords.read(target).ok_or("A target doesn't fit its own numbering")?;
            let index = self.coords.index(&outer, &inner);
            if get(&nibbles, index) == UNSEEN {
                set(&mut nibbles, index, 0);
                queue.as_mut().unwrap().push(index as u32);
            }
        }
        let mut seen = queue.as_ref().unwrap().len() as u64;
        let mut frontier = seen;
        let mut depth: u8 = 0;
        while frontier > 0 {
            // A 15th layer can't be stored: fail if any state at 14 still has an unseen neighbour
            let too_deep = depth == UNSEEN - 1;
            let found = if let Some(list) = &queue {
                // Small layer: expand each listed state, listing the next layer while it stays small
                let (found, next_list) = self.expand_list(&layout, list, &mut nibbles, &inner_next, depth, too_deep)?;
                queue = next_list;
                found
            } else if size - seen < frontier * 2 && !too_deep {
                self.scan(&layout, &mut nibbles, &inner_next, depth, true, false)?
            } else {
                self.scan(&layout, &mut nibbles, &inner_next, depth, false, too_deep)?
            };
            // Next layer
            if found > 0 {
                self.depth = depth + 1;
            }
            seen += found;
            frontier = found;
            depth += 1;
        }
        self.nibbles = nibbles;
        self.inner_next = inner_next;
        Ok(())
    }

    // Expand a listed layer: returns how many states joined the next layer, and their list (None once it grows too big)
    fn expand_list(&self, layout: &Layout, list: &[u32], nibbles: &mut [u8], inner_next: &[u16], depth: u8, too_deep: bool) -> Result<(u64, Option<Vec<u32>>), String> {
        let limit = (self.coords.size() / QUEUE_SHARE).clamp(1024, QUEUE_LIMIT) as usize;
        let direct = self.coords.outer.direct();
        let mut next_list = Some(vec![]);
        let mut found: u64 = 0;
        let mut next_positions = vec![0u64; layout.turn_count];
        let mut next_twists = vec![0u32; layout.turn_count];
        let (mut units, mut moved) = (Units::new(), Units::new());
        for &index in list {
            // Split the index into outer positions, outer twists and inner value
            let index = index as u64;
            let (position, rest) = (index / layout.block, index % layout.block);
            let (twists, inner) = (rest / layout.inner_size, (rest % layout.inner_size) as usize);
            // Neighbours of this state's outer part: from the tables, or worked out
            let own = self.coords.outer.split_positions(position);
            if direct {
                for turn in 0..layout.turn_count {
                    next_positions[turn] = self.coords.outer.next_position(&own, turn);
                    let row = self.coords.outer.twist_row(&own, turn);
                    next_twists[turn] = row[(twists as usize).min(row.len() - 1)];
                }
            } else {
                self.coords.outer.block_next(position, twists, 1, &mut next_positions, &mut next_twists, &self.coords.binomials, &mut units, &mut moved);
            }
            for turn in 0..layout.turn_count {
                let child = next_positions[turn] * layout.block + next_twists[turn] as u64 * layout.inner_size + inner_next[turn * layout.inner_size as usize + inner] as u64;
                if get(nibbles, child) != UNSEEN {
                    continue;
                }
                if too_deep {
                    return Err("Too deep for an exact table".to_owned());
                }
                set(nibbles, child, depth + 1);
                found += 1;
                // Keep listing while the next layer stays small
                if next_list.as_ref().is_some_and(|l: &Vec<u32>| l.len() >= limit) {
                    next_list = None;
                }
                if let Some(l) = &mut next_list {
                    l.push(child as u32);
                }
            }
        }
        Ok((found, next_list))
    }

    // One layer by block scan: forward expands this layer, backward lets unseen states find a neighbour in it (turns come with their inverses)
    fn scan(&self, layout: &Layout, nibbles: &mut [u8], inner_next: &[u16], depth: u8, backward: bool, too_deep: bool) -> Result<u64, String> {
        let wanted = if backward { UNSEEN } else { depth };
        // Which halves of a byte hold the wanted value (bit 0 = even state, bit 1 = odd state)
        let matches: [u8; 256] = std::array::from_fn(|byte| ((byte & 15) as u8 == wanted) as u8 | ((((byte >> 4) as u8 == wanted) as u8) << 1));
        // Twist rows straight from the outer tables when they allow it (no per-block work)
        let direct = self.coords.outer.direct();
        let width = layout.twist_space.min(CHUNK);
        let mut next_positions = vec![0u64; layout.turn_count];
        let mut next_twists = vec![0u32; layout.turn_count * width as usize];
        let (mut units, mut moved) = (Units::new(), Units::new());
        let inner_size = layout.inner_size as usize;
        // States of the chunk to work on: (twist offset in the chunk, inner value)
        let mut active: Vec<(u32, u32)> = vec![];
        let mut found: u64 = 0;
        for position in 0..layout.blocks {
            for first in (0..layout.twist_space).step_by(width as usize) {
                let count = width.min(layout.twist_space - first) as usize;
                let start = position * layout.block + first * layout.inner_size;
                // List the chunk's states with the wanted value (a byte at a time), skipping chunks with none (the common case in early and late layers)
                active.clear();
                let end = start + (count * inner_size) as u64;
                let mut index = start;
                while index < end {
                    let offset = (index - start) as usize;
                    if index & 1 == 1 || index + 1 == end {
                        // A lone half byte at either end
                        if get(nibbles, index) == wanted {
                            active.push(((offset / inner_size) as u32, (offset % inner_size) as u32));
                        }
                        index += 1;
                        continue;
                    }
                    let found_here = matches[nibbles[(index >> 1) as usize] as usize];
                    if found_here & 1 != 0 {
                        active.push(((offset / inner_size) as u32, (offset % inner_size) as u32));
                    }
                    if found_here & 2 != 0 {
                        active.push((((offset + 1) / inner_size) as u32, ((offset + 1) % inner_size) as u32));
                    }
                    index += 2;
                }
                if active.is_empty() {
                    continue;
                }
                // The block's neighbours: positions after each turn, and twist rows (from the tables, or worked out for this chunk)
                let own = self.coords.outer.split_positions(position);
                if direct {
                    for (turn, next) in next_positions.iter_mut().enumerate() {
                        *next = self.coords.outer.next_position(&own, turn);
                    }
                } else {
                    self.coords.outer.block_next(position, first, count, &mut next_positions, &mut next_twists, &self.coords.binomials, &mut units, &mut moved);
                }
                for turn in 0..layout.turn_count {
                    // This turn's destination block, twist row and inner row (turn by turn, so the destination block stays in cache)
                    let base = next_positions[turn] * layout.block;
                    let twists = if direct {
                        let row = self.coords.outer.twist_row(&own, turn);
                        &row[(first as usize).min(row.len() - 1)..]
                    } else {
                        &next_twists[turn * count..(turn + 1) * count]
                    };
                    let inners = &inner_next[turn * inner_size..(turn + 1) * inner_size];
                    if backward {
                        // Unseen states with a neighbour in this layer join the next one and leave the list
                        let mut i = 0;
                        while i < active.len() {
                            let (k, inner) = active[i];
                            let neighbour = base + twists[k as usize] as u64 * layout.inner_size + inners[inner as usize] as u64;
                            if get(nibbles, neighbour) == depth {
                                set(nibbles, start + k as u64 * layout.inner_size + inner as u64, depth + 1);
                                found += 1;
                                active.swap_remove(i);
                            } else {
                                i += 1;
                            }
                        }
                        continue;
                    }
                    // Forward: unseen children of this layer's states join the next layer
                    for &(k, inner) in &active {
                        let child = base + twists[k as usize] as u64 * layout.inner_size + inners[inner as usize] as u64;
                        if get(nibbles, child) != UNSEEN {
                            continue;
                        }
                        if too_deep {
                            return Err("Too deep for an exact table".to_owned());
                        }
                        set(nibbles, child, depth + 1);
                        found += 1;
                    }
                }
            }
        }
        Ok(found)
    }
}
