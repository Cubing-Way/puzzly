// State numbering for exact tables, read from masked target patterns: no goal roles needed, only which pieces share an id and which twists count

use cubing::alg::Move;
use cubing::kpuzzle::{KPattern, KPatternData, KPuzzle, KPuzzleOrbitName, KTransformationData};

// The parts of the numbering: reading an orbit from the targets, ranking its states, its turn tables, and orbits numbered together
mod orbit;
mod part;
mod rank;
mod tables;

use orbit::orbit_coords;

// Most moving spots one orbit may have (spot sets are kept in a u64 bit mask)
const MAX_SPOTS: usize = 64;
// Most tracked pieces in one part of the state (fixed-size buffers keep the hot loops allocation-free)
pub const MAX_UNITS: usize = 64;
// Most orbits in one part
const MAX_ORBITS: usize = 16;
// Largest turn table an orbit may get (entries, kept only while a table fills: 6 edges × 18 turns = 12M fits, ~96 MB with their twist rows);
// bigger orbits are worked out piece by piece instead (a 21M-state 6-edge table filled in ~165 s that way, 2–7 s with its turn table)
const TABLE_LIMIT: u64 = 1 << 24;
// Largest twist-row table for orbits with twists per piece (entries)
const ROW_LIMIT: usize = 1 << 20;
// Twists row of an orbit (or part) whose twists never count
static ZERO_ROW: [u32; 1] = [0];
// Orbits with at most this many position layouts number only the layouts the turns can reach from the targets
const REACH_LIMIT: u64 = 1 << 16;
// Dense number of a layout the turns can't reach
const UNREACHABLE: u32 = u32::MAX;
// Inner part size limit: its turn table (size × turns, u16 each) stays small
pub const INNER_LIMIT: u64 = 1 << 16;

// One allowed turn (R, R2 and R' are separate turns), with its name for the answer and its group (the powers of one move share it)
pub struct Turn {
    pub name: String,
    pub group: usize,
    pub(crate) data: KTransformationData,
}

// Every power of each allowed move until it comes back to the identity, named like twips does (R, R2, R')
pub fn enumerate_turns(kpuzzle: &KPuzzle, moves: &[Move]) -> Result<Vec<Turn>, String> {
    let identity = kpuzzle.identity_transformation().to_data();
    let mut turns = vec![];
    for base in moves {
        // Group = first allowed move with the same quantum (R and R2 listed apart still count as one move)
        let group = moves.iter().position(|other| other.quantum == base.quantum).unwrap_or(0);
        // Effect of each power, stopping when the move is back to doing nothing
        let mut powers = vec![];
        for amount in 1..=360 {
            let power = Move { quantum: base.quantum.clone(), amount: base.amount * amount };
            let data = kpuzzle.transformation_from_move(&power).map_err(|e| e.to_string())?.to_data();
            if data == identity {
                break;
            }
            powers.push(data);
        }
        // Name each power with its shortest amount (the last power of a quarter turn is R', not R3)
        let order = powers.len() as i32 + 1;
        for (index, data) in powers.into_iter().enumerate() {
            let amount = index as i32 + 1;
            let shortest = if amount * 2 <= order { amount } else { amount - order };
            let name = Move { quantum: base.quantum.clone(), amount: base.amount * shortest }.to_string();
            turns.push(Turn { name, group, data });
        }
    }
    Ok(turns)
}

// Read a pattern sent as JSON into plain per-orbit data
pub fn pattern_data(kpuzzle: &KPuzzle, json: &str) -> Result<KPatternData, String> {
    Ok(KPattern::try_from_json(kpuzzle, json.as_bytes()).map_err(|e| e.to_string())?.to_data())
}

// Twist values that count for a piece: its orientation mod (0 = all of the orbit's orientations)
pub(crate) fn twist_factor(mod_value: u8, num_orientations: u8) -> u8 {
    if mod_value == 0 { num_orientations } else { mod_value }
}

// Row length of the binomial table
const ROW: usize = MAX_SPOTS + 1;

// Binomial coefficients up to MAX_SPOTS, one flat array (C(n, k) at n * ROW + k)
pub struct Binomials(Vec<u64>);

impl Binomials {
    // Pascal's triangle, big enough for any orbit
    pub fn new() -> Self {
        let mut table = vec![0u64; ROW * ROW];
        for n in 0..ROW {
            table[n * ROW] = 1;
            for k in 1..=n {
                table[n * ROW + k] = table[(n - 1) * ROW + k - 1] + table[(n - 1) * ROW + k];
            }
        }
        Binomials(table)
    }

    // C(n, k), 0 when k > n
    #[inline]
    fn get(&self, n: usize, k: usize) -> u64 {
        if k > n { 0 } else { self.0[n * ROW + k] }
    }

    // One table for code that has none at hand
    fn shared() -> &'static Binomials {
        static SHARED: std::sync::OnceLock<Binomials> = std::sync::OnceLock::new();
        SHARED.get_or_init(Binomials::new)
    }
}

// Pieces sharing one id inside an orbit's moving spots (a single tracked piece is a class of one)
pub(crate) struct Class {
    pub(crate) id: u8,
    pub(crate) count: usize,
    pub(crate) twisted: bool,
    // Spots still free when this class is placed (earlier classes took the rest)
    free: usize,
}

// An untouched spot: the id and twist (mod its twist count) the targets have there
struct Fixed {
    spot: usize,
    id: u8,
    factor: u8,
    twist: u8,
}

// Turn tables of one orbit, so a state's neighbours are lookups instead of unpacking and renumbering pieces
struct OrbitTables {
    // Positions after each turn: [turn * positions + position]
    position_next: Vec<u32>,
    // Twists per piece: which twist row each turn uses from each position ([turn * positions + position]) ...
    row: Vec<u32>,
    // ... and the rows: twists after the turn for every twists before ([row * twist_space + twists]); a row moves digits
    // (pieces of a group re-sort by spot) and adds each piece's gained twist, so equal rows are shared
    rows: Vec<u32>,
    // Every spot twisted: twist digits (one per spot) after each turn: [turn * twist_space + twists]
    twist_next: Vec<u32>,
}

// One set of an orbit's moving spots (all of them, or the ones the turns connect) as a share of the state: value = positions (which class sits on each spot) × twists (the twist digits that count)
pub struct OrbitCoord {
    pub(crate) name: KPuzzleOrbitName,
    // Orbit spot number of each spot of the set (they are numbered 0..m in this order)
    pub(crate) spots: Vec<u8>,
    // Spots no allowed turn touches, with what every target has there (kept by the orbit's first set only)
    fixed: Vec<Fixed>,
    // Classes written into the index, in index order (the biggest twist-free class is left out: it fills the free spots)
    pub(crate) classes: Vec<Class>,
    // Id of the class left out, if any (with the tracked ids, the only ids the set's spots may hold)
    pub(crate) implicit: Option<u8>,
    // Twist values a tracked twist can take (the same for every twisted class of the set)
    twists: u8,
    // Twist digits are per spot (every spot holds a twisted piece) instead of per tracked piece
    per_spot: bool,
    // Per-spot twists whose sum no turn changes (face turns): the last spot's digit is left out, it follows from the others and twist_sum
    parity: bool,
    twist_sum: u8,
    // Every class is one piece and twists are per piece, so a turn never re-sorts pieces (a child's value can be ranked straight from its parent)
    singles: bool,
    // Value counts: positions, twist digits, and their product
    positions: u64,
    twist_space: u64,
    size: u64,
    // Per turn, per moving spot: the moving spot the piece lands on and the twist it gains
    dest: Vec<u8>,
    add: Vec<u8>,
    // Turn tables (outer orbits small enough to have them)
    tables: Option<OrbitTables>,
    // Reachable layouts only: full layout number → dense number (UNREACHABLE if none), and back
    to_dense: Vec<u32>,
    to_full: Vec<u32>,
    // Twists no allowed turn changes: (id, twist every piece with that id must have), and the twist count they are judged by
    frozen: Vec<(u8, u8)>,
    frozen_factor: u8,
}

// Tracked pieces of some orbits, one entry per piece: its moving spot and twist (orbit by orbit, classes in order, each class's pieces by spot)
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Units {
    pub spot: [u8; MAX_UNITS],
    pub twist: [u8; MAX_UNITS],
}

impl Units {
    // Empty buffers
    pub fn new() -> Self {
        Units { spot: [0; MAX_UNITS], twist: [0; MAX_UNITS] }
    }
}

// Orbits numbered together: value = positions × twists (orbit by orbit), so states sharing the outer positions form one contiguous table block
pub struct Part {
    pub(crate) orbits: Vec<OrbitCoord>,
    // First unit of each orbit, plus the end
    offsets: Vec<usize>,
    // Value counts: positions, twists, and their product
    pub positions: u64,
    pub twist_space: u64,
    pub size: u64,
    // Every orbit has turn tables (neighbours are pure lookups)
    tabled: bool,
    // Every orbit is singles, so a child's value can be ranked straight from its parent (rank_after)
    pub singles: bool,
}

// The whole numbering: outer part (turn tables per orbit) × inner part (one turn table for the whole part), plus untouched-spot checks
pub struct Coords {
    pub turns: Vec<Turn>,
    pub outer: Part,
    pub inner: Part,
    pub binomials: Binomials,
}

impl Coords {
    // Read the numbering from the targets and allowed turns (orbits that add nothing have one value and only keep their untouched-spot checks)
    pub fn new(kpuzzle: &KPuzzle, targets: &[KPatternData], turns: Vec<Turn>) -> Result<Self, String> {
        let binomials = Binomials::new();
        let mut orbits = vec![];
        for info in kpuzzle.orbit_info_iter() {
            orbits.extend(orbit_coords(kpuzzle, &info.name, targets, &turns, &binomials, true)?);
        }
        // Smallest orbits go in the inner part while it stays under the limit, the rest make the outer part
        orbits.sort_by_key(|orbit| orbit.size);
        let mut inner = vec![];
        let mut outer = vec![];
        let mut inner_size: u64 = 1;
        for orbit in orbits {
            if outer.is_empty() && inner_size.saturating_mul(orbit.size) <= INNER_LIMIT {
                inner_size *= orbit.size;
                inner.push(orbit);
            } else {
                outer.push(orbit);
            }
        }
        Ok(Coords { turns, outer: Part::new(outer)?, inner: Part::new(inner)?, binomials })
    }

    // Every orbit (outer part first), for code that looks at the numbering orbit by orbit
    pub fn orbits(&self) -> impl Iterator<Item = &OrbitCoord> {
        self.outer.orbits.iter().chain(self.inner.orbits.iter())
    }

    // Turn tables for the outer orbits (only worth it once the table is known to be built)
    pub fn build_tables(&mut self) {
        self.outer.build_tables(self.turns.len(), &self.binomials);
    }

    // Number of table entries
    pub fn size(&self) -> u64 {
        self.outer.size.saturating_mul(self.inner.size)
    }

    // A pattern's tracked pieces (outer, inner); None when an untouched spot can't match
    pub fn read(&self, pattern: &KPatternData) -> Option<(Units, Units)> {
        Some((self.outer.read(pattern)?, self.inner.read(pattern)?))
    }

    // Table index of tracked pieces
    pub fn index(&self, outer: &Units, inner: &Units) -> u64 {
        self.outer.rank(outer, &self.binomials) * self.inner.size + self.inner.rank(inner, &self.binomials)
    }
}

// Table size these targets would need (exact per set of spots, except that layouts the turns can't reach still count), without building anything
pub fn estimate_size(kpuzzle: &KPuzzle, targets: &[KPatternData], turns: &[Turn]) -> Result<u64, String> {
    let binomials = Binomials::shared();
    let mut size: u64 = 1;
    for info in kpuzzle.orbit_info_iter() {
        for orbit in orbit_coords(kpuzzle, &info.name, targets, turns, binomials, false)? {
            size = size.saturating_mul(orbit.size);
        }
    }
    Ok(size)
}
