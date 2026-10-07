// State numbering for exact tables, read from masked target patterns: no goal roles needed, only which pieces share an id and which twists count

use cubing::alg::Move;
use cubing::kpuzzle::{KPattern, KPatternData, KPuzzle, KPuzzleOrbitName, KTransformationData};

// Most moving spots one orbit may have (spot sets are kept in a u64 bit mask)
const MAX_SPOTS: usize = 64;
// Most tracked pieces in one part of the state (fixed-size buffers keep the hot loops allocation-free)
pub const MAX_UNITS: usize = 64;
// Most orbits in one part
const MAX_ORBITS: usize = 16;
// Largest turn table an orbit may get (entries); bigger orbits are worked out piece by piece instead
const TABLE_LIMIT: u64 = 1 << 22;
// Largest digit-add table for twisted single pieces (entries)
const ADD_LIMIT: u64 = 1 << 20;
// Twists row of an orbit (or part) whose twists never count
static ZERO_ROW: [u32; 1] = [0];
// Orbits with at most this many position layouts number only the layouts the turns can reach from the targets
const REACH_LIMIT: u64 = 1 << 16;
// Dense number of a layout the turns can't reach
const UNREACHABLE: u32 = u32::MAX;
// Inner part size limit: its turn table (size × turns, u16 each) stays small
pub const INNER_LIMIT: u64 = 1 << 16;

// One allowed turn (R, R2 and R' are separate turns), with its name for the answer
pub struct Turn {
    pub name: String,
    data: KTransformationData,
}

// Every power of each allowed move until it comes back to the identity, named like twips does (R, R2, R')
pub fn enumerate_turns(kpuzzle: &KPuzzle, moves: &[Move]) -> Result<Vec<Turn>, String> {
    let identity = kpuzzle.identity_transformation().to_data();
    let mut turns = vec![];
    for base in moves {
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
            turns.push(Turn { name, data });
        }
    }
    Ok(turns)
}

// Read a pattern sent as JSON into plain per-orbit data
pub fn pattern_data(kpuzzle: &KPuzzle, json: &str) -> Result<KPatternData, String> {
    Ok(KPattern::try_from_json(kpuzzle, json.as_bytes()).map_err(|e| e.to_string())?.to_data())
}

// Twist values that count for a piece: its orientation mod (0 = all of the orbit's orientations)
fn twist_factor(mod_value: u8, num_orientations: u8) -> u8 {
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
struct Class {
    id: u8,
    count: usize,
    twisted: bool,
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
    // Twisted single pieces: the twist each piece gains, as digits in piece order ([turn * positions + position]) ...
    delta: Vec<u16>,
    // ... added digit by digit, one row per delta: [delta * twist_space + twists]
    add: Vec<u32>,
    // Every spot twisted: twist digits (one per spot) after each turn: [turn * twist_space + twists]
    twist_next: Vec<u32>,
}

// One orbit's share of the state: value = positions (which class sits on each moving spot) × twists (the twist digits that count)
pub struct OrbitCoord {
    name: KPuzzleOrbitName,
    // Orbit spot number of each moving spot (moving spots are numbered 0..m in this order)
    spots: Vec<u8>,
    // Spots no allowed turn touches, with what every target has there
    fixed: Vec<Fixed>,
    // Classes written into the index, in index order (the biggest twist-free class is left out: it fills the free spots)
    classes: Vec<Class>,
    // Twist values a tracked twist can take (the same for every twisted class of the orbit)
    twists: u8,
    // Twist digits are per spot (every moving spot holds a twisted piece) instead of per tracked piece
    per_spot: bool,
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

impl OrbitCoord {
    // Read one orbit's numbering from the targets (all of them must agree on ids, twists that count, and untouched spots)
    fn new(kpuzzle: &KPuzzle, name: &KPuzzleOrbitName, targets: &[KPatternData], turns: &[Turn], binomials: &Binomials) -> Result<Self, String> {
        let info = kpuzzle.lookup_orbit(name).ok_or("Unknown orbit")?;
        let num_pieces = info.num_pieces as usize;
        let num_orientations = info.num_orientations;
        // A spot moves when some turn brings another piece there or twists it in a way that counts (center twists don't, so face turns leave centers fixed)
        let first = &targets[0][name];
        let first_mods = first.orientation_mod.clone().unwrap_or_else(|| vec![0; num_pieces]);
        let moving: Vec<bool> = (0..num_pieces)
            .map(|spot| {
                let factor = twist_factor(first_mods[spot], num_orientations);
                turns.iter().any(|turn| {
                    let orbit = &turn.data[name];
                    orbit.permutation[spot] as usize != spot || orbit.orientation_delta[spot] % factor != 0
                })
            })
            .collect();
        let spots: Vec<u8> = (0..num_pieces).filter(|&spot| moving[spot]).map(|spot| spot as u8).collect();
        if spots.len() > MAX_SPOTS {
            return Err(format!("Orbit {} has too many pieces for an exact table", name));
        }
        // Untouched spots: what the first target has there, and every other target must have the same (no turn can change it)
        let fixed: Vec<Fixed> = (0..num_pieces)
            .filter(|&spot| !moving[spot])
            .map(|spot| {
                let factor = twist_factor(first_mods[spot], num_orientations);
                Fixed { spot, id: first.pieces[spot], factor, twist: first.orientation[spot] % factor }
            })
            .collect();
        // Classes from the first target's moving spots: count per id, and whether its twist counts
        let mut classes: Vec<Class> = vec![];
        let mut twists = 1u8;
        for &spot in &spots {
            let spot = spot as usize;
            let factor = twist_factor(first_mods[spot], num_orientations);
            let id = first.pieces[spot];
            match classes.iter_mut().find(|class| class.id == id) {
                Some(class) => {
                    if class.twisted != (factor > 1) {
                        return Err("Pieces sharing an id differ in whether their twist counts".to_owned());
                    }
                    class.count += 1;
                }
                None => classes.push(Class { id, count: 1, twisted: factor > 1, free: 0 }),
            }
            // Every twisted piece of the orbit must use the same twist count
            if factor > 1 {
                if twists > 1 && twists != factor {
                    return Err("Mixed twist counts in one orbit".to_owned());
                }
                twists = factor;
            }
        }
        // Every target must match the first one on untouched spots and on the class counts (offsets only move pieces around)
        for target in &targets[1..] {
            let orbit = &target[name];
            let mods = orbit.orientation_mod.clone().unwrap_or_else(|| vec![0; num_pieces]);
            if fixed.iter().any(|f| orbit.pieces[f.spot] != f.id || orbit.orientation[f.spot] % f.factor != f.twist) {
                return Err("Targets differ on spots the moves never touch".to_owned());
            }
            for class in &classes {
                let count = spots.iter().filter(|&&spot| orbit.pieces[spot as usize] == class.id).count();
                let twisted = spots.iter().any(|&spot| orbit.pieces[spot as usize] == class.id && twist_factor(mods[spot as usize], num_orientations) > 1);
                if count != class.count || twisted != class.twisted {
                    return Err("Targets don't share one piece layout".to_owned());
                }
            }
        }
        // Twists no allowed turn can change (edge orientation under U, R, L) leave the state; reading a start checks them instead
        let mut frozen: Vec<(u8, u8)> = vec![];
        let frozen_factor = twists;
        if twists > 1 && turns.iter().all(|turn| spots.iter().all(|&spot| turn.data[name].orientation_delta[spot as usize] % twists == 0)) {
            for class in classes.iter_mut().filter(|class| class.twisted) {
                let mut required = None;
                for target in targets {
                    let orbit = &target[name];
                    for &spot in &spots {
                        if orbit.pieces[spot as usize] != class.id {
                            continue;
                        }
                        let twist = orbit.orientation[spot as usize] % twists;
                        if required.is_some_and(|value| value != twist) {
                            return Err("Pieces sharing an id need different twists no move can change".to_owned());
                        }
                        required = Some(twist);
                    }
                }
                frozen.push((class.id, required.unwrap_or(0)));
                class.twisted = false;
            }
            twists = 1;
        }
        // Leave out the biggest class whose twist doesn't count: its spots are whatever the others leave free
        let implicit = (0..classes.len()).filter(|&i| !classes[i].twisted).max_by_key(|&i| classes[i].count);
        if let Some(biggest) = implicit {
            classes.remove(biggest);
        }
        // With no class left out every spot holds a tracked piece, so twists can be kept per spot when all of them count
        let per_spot = implicit.is_none() && classes.iter().all(|class| class.twisted);
        // Value counts: one combination per class among the spots still free, and one twist digit per tracked twist
        let mut positions: u64 = 1;
        let mut twist_space: u64 = 1;
        let mut free = spots.len();
        for class in &mut classes {
            class.free = free;
            positions = positions.checked_mul(binomials.get(free, class.count)).ok_or("Too many states")?;
            free -= class.count;
            if class.twisted {
                for _ in 0..class.count {
                    twist_space = twist_space.checked_mul(twists as u64).ok_or("Too many states")?;
                }
            }
        }
        let size = positions.checked_mul(twist_space).ok_or("Too many states")?;
        // Where each turn sends the piece on each moving spot (turn data: new[i] = old[permutation[i]], twisted by orientation_delta[i])
        let mut compact = vec![u8::MAX; num_pieces];
        for (index, &spot) in spots.iter().enumerate() {
            compact[spot as usize] = index as u8;
        }
        let mut dest = vec![0u8; turns.len() * spots.len()];
        let mut add = vec![0u8; turns.len() * spots.len()];
        for (t, turn) in turns.iter().enumerate() {
            let orbit = &turn.data[name];
            for to in 0..num_pieces {
                if !moving[to] {
                    continue;
                }
                let from = compact[orbit.permutation[to] as usize] as usize;
                dest[t * spots.len() + from] = compact[to];
                add[t * spots.len() + from] = orbit.orientation_delta[to] % twists;
            }
        }
        let mut orbit = OrbitCoord { name: name.clone(), spots, fixed, classes, twists, per_spot, positions, twist_space, size, dest, add, tables: None, to_dense: vec![], to_full: vec![], frozen, frozen_factor };
        orbit.keep_reachable(targets, turns.len(), binomials);
        Ok(orbit)
    }

    // Small orbits: number only the layouts the turns reach from the targets (six centers under M, E, S: 24 of 720)
    fn keep_reachable(&mut self, targets: &[KPatternData], turn_count: usize, binomials: &Binomials) {
        if self.positions > REACH_LIMIT || self.positions == 1 {
            return;
        }
        let units = self.unit_count();
        let mut seen = vec![false; self.positions as usize];
        let mut queue: Vec<u32> = vec![];
        // Start from every target's layout
        let mut spots = [0u8; MAX_UNITS];
        for target in targets {
            let data = &target[&self.name];
            let mut u = 0;
            for class in &self.classes {
                for (index, &spot) in self.spots.iter().enumerate() {
                    if data.pieces[spot as usize] == class.id && u < units {
                        spots[u] = index as u8;
                        u += 1;
                    }
                }
            }
            let full = self.rank_full(&spots[..units], binomials) as usize;
            if !seen[full] {
                seen[full] = true;
                queue.push(full as u32);
            }
        }
        // Every layout one turn away from a reached one, until nothing new turns up
        let (mut moved, zeros, mut scratch) = ([0u8; MAX_UNITS], [0u8; MAX_UNITS], [0u8; MAX_UNITS]);
        let mut next = 0;
        while next < queue.len() {
            self.unrank_full(queue[next] as u64, binomials, &mut spots[..units]);
            next += 1;
            for turn in 0..turn_count {
                self.apply(&spots[..units], &zeros[..units], turn, &mut moved[..units], &mut scratch[..units]);
                let full = self.rank_full(&moved[..units], binomials) as usize;
                if !seen[full] {
                    seen[full] = true;
                    queue.push(full as u32);
                }
            }
        }
        // Renumber only when it saves something
        if (queue.len() as u64) < self.positions {
            queue.sort_unstable();
            self.to_dense = vec![UNREACHABLE; self.positions as usize];
            for (dense, &full) in queue.iter().enumerate() {
                self.to_dense[full as usize] = dense as u32;
            }
            self.to_full = queue;
            self.positions = self.to_full.len() as u64;
            self.size = self.positions * self.twist_space;
        }
    }

    // Positions value of these spots, or None when the turns can't reach that layout
    fn reachable_position(&self, spots: &[u8], binomials: &Binomials) -> Option<u64> {
        let full = self.rank_full(spots, binomials);
        if self.to_dense.is_empty() {
            return Some(full);
        }
        let dense = self.to_dense[full as usize];
        if dense == UNREACHABLE { None } else { Some(dense as u64) }
    }

    // Positions value (dense when only reachable layouts are numbered)
    #[inline]
    fn rank_positions(&self, spots: &[u8], binomials: &Binomials) -> u64 {
        let full = self.rank_full(spots, binomials);
        if self.to_dense.is_empty() { full } else { self.to_dense[full as usize] as u64 }
    }

    // Spots for a positions value (the inverse of rank_positions)
    #[inline]
    fn unrank_positions(&self, index: u64, binomials: &Binomials, spots: &mut [u8]) {
        let full = if self.to_full.is_empty() { index } else { self.to_full[index as usize] as u64 };
        self.unrank_full(full, binomials, spots);
    }

    // Tracked pieces this orbit puts in a part's unit buffers
    fn unit_count(&self) -> usize {
        self.classes.iter().map(|class| class.count).sum()
    }

    // Layout number: each class's combination among the spots earlier classes left free (colex rank of the renumbered spots)
    fn rank_full(&self, spots: &[u8], binomials: &Binomials) -> u64 {
        let mut index: u64 = 0;
        let mut used: u64 = 0;
        let mut u = 0;
        for class in &self.classes {
            // One piece: just its spot renumbered among the free ones
            if class.count == 1 {
                let spot = spots[u] as u32;
                index = index * class.free as u64 + (spot - (used & ((1u64 << spot) - 1)).count_ones()) as u64;
                used |= 1u64 << spot;
                u += 1;
                continue;
            }
            // Several pieces: colex rank of their renumbered spots
            let mut combination: u64 = 0;
            for j in 0..class.count {
                let spot = spots[u + j] as u32;
                let reduced = spot - (used & ((1u64 << spot) - 1)).count_ones();
                combination += binomials.get(reduced as usize, j + 1);
            }
            index = index * binomials.get(class.free, class.count) + combination;
            for j in 0..class.count {
                used |= 1u64 << spots[u + j];
            }
            u += class.count;
        }
        index
    }

    // Spots for a layout number (the inverse of rank_full)
    fn unrank_full(&self, mut index: u64, binomials: &Binomials, spots: &mut [u8]) {
        // Each class's combination rank, last class first (the free count before each class is known up front)
        let mut combinations = [0u64; MAX_SPOTS];
        for (c, class) in self.classes.iter().enumerate().rev() {
            let count = binomials.get(class.free, class.count);
            combinations[c] = index % count;
            index /= count;
        }
        // Place each class: colex unrank among the free spots, then map back to real moving spots
        let all: u64 = if self.spots.len() == 64 { u64::MAX } else { (1u64 << self.spots.len()) - 1 };
        let mut used: u64 = 0;
        let mut u = 0;
        for (c, class) in self.classes.iter().enumerate() {
            // One piece: the free spot with that rank (drop the lowest free spots, take the next)
            if class.count == 1 {
                let mut free = all & !used;
                for _ in 0..combinations[c] {
                    free &= free - 1;
                }
                spots[u] = free.trailing_zeros() as u8;
                used |= free.isolate_lowest_one();
                u += 1;
                continue;
            }
            // Several pieces: colex positions, largest first
            let mut rest = combinations[c];
            let mut reduced = [0usize; MAX_SPOTS];
            for j in (0..class.count).rev() {
                // Largest position whose binomial still fits
                let mut position = j;
                while binomials.get(position + 1, j + 1) <= rest {
                    position += 1;
                }
                rest -= binomials.get(position, j + 1);
                reduced[j] = position;
            }
            // The k-th free spot, for each renumbered position (positions rise, so one pass)
            let mut j = 0;
            let mut seen = 0;
            for spot in 0..self.spots.len() {
                if j == class.count {
                    break;
                }
                if used & (1u64 << spot) != 0 {
                    continue;
                }
                if seen == reduced[j] {
                    spots[u + j] = spot as u8;
                    j += 1;
                }
                seen += 1;
            }
            for j in 0..class.count {
                used |= 1u64 << spots[u + j];
            }
            u += class.count;
        }
    }

    // Twists value: one digit per spot (per_spot) or per twisted piece in piece order
    fn rank_twists(&self, spots: &[u8], twists: &[u8]) -> u64 {
        let base = self.twists as u64;
        let mut index: u64 = 0;
        if self.per_spot {
            // Twist of the piece on each spot, spot by spot
            let mut at = [0u8; MAX_SPOTS];
            for u in 0..self.unit_count() {
                at[spots[u] as usize] = twists[u];
            }
            for &twist in &at[..self.spots.len()] {
                index = index * base + twist as u64;
            }
        } else {
            // Twisted pieces in piece order
            let mut u = 0;
            for class in &self.classes {
                for _ in 0..class.count {
                    if class.twisted {
                        index = index * base + twists[u] as u64;
                    }
                    u += 1;
                }
            }
        }
        index
    }

    // Twists for a twists value, given the pieces' spots (the inverse of rank_twists)
    fn unrank_twists(&self, mut index: u64, spots: &[u8], twists: &mut [u8]) {
        let base = self.twists as u64;
        if self.per_spot {
            // Digits per spot, last spot first, then handed to the piece on each spot
            let mut at = [0u8; MAX_SPOTS];
            for spot in (0..self.spots.len()).rev() {
                at[spot] = (index % base) as u8;
                index /= base;
            }
            for u in 0..self.unit_count() {
                twists[u] = at[spots[u] as usize];
            }
        } else {
            // Digits per twisted piece, last piece first (untracked twists are 0)
            let mut u = self.unit_count();
            for class in self.classes.iter().rev() {
                for _ in 0..class.count {
                    u -= 1;
                    twists[u] = if class.twisted {
                        let digit = (index % base) as u8;
                        index /= base;
                        digit
                    } else {
                        0
                    };
                }
            }
        }
    }

    // Tracked pieces after one turn (each group's pieces sorted by spot again, so the numbering stays unique)
    fn apply(&self, spots: &[u8], twists: &[u8], turn: usize, out_spots: &mut [u8], out_twists: &mut [u8]) {
        let m = self.spots.len();
        let dest = &self.dest[turn * m..(turn + 1) * m];
        let add = &self.add[turn * m..(turn + 1) * m];
        let mut u = 0;
        for class in &self.classes {
            // Move each piece and add the twist its new spot gives (both below the twist count, so one subtraction wraps it)
            for j in u..u + class.count {
                let spot = spots[j] as usize;
                out_spots[j] = dest[spot];
                out_twists[j] = if class.twisted {
                    let twist = twists[j] + add[spot];
                    if twist >= self.twists { twist - self.twists } else { twist }
                } else {
                    0
                };
            }
            // Insertion sort of a group by spot (groups are small)
            for j in u + 1..u + class.count {
                let (spot, twist) = (out_spots[j], out_twists[j]);
                let mut k = j;
                while k > u && out_spots[k - 1] > spot {
                    out_spots[k] = out_spots[k - 1];
                    out_twists[k] = out_twists[k - 1];
                    k -= 1;
                }
                out_spots[k] = spot;
                out_twists[k] = twist;
            }
            u += class.count;
        }
    }

    // Build turn tables when they stay small and the twists allow it (per spot, or only single pieces twisted)
    fn build_tables(&mut self, turn_count: usize, binomials: &Binomials) {
        let turns = turn_count as u64;
        let singles_twisted = self.classes.iter().all(|class| !class.twisted || class.count == 1);
        let twists_fit = self.twist_space == 1
            || (self.per_spot && self.twist_space * turns <= TABLE_LIMIT)
            || (!self.per_spot && singles_twisted && self.twist_space * self.twist_space <= ADD_LIMIT);
        if self.positions * turns > TABLE_LIMIT || !twists_fit {
            return;
        }
        let positions = self.positions as usize;
        let space = self.twist_space as usize;
        let units = self.unit_count();
        let per_unit = space > 1 && !self.per_spot;
        let mut tables = OrbitTables {
            position_next: vec![0; turn_count * positions],
            delta: if per_unit { vec![0; turn_count * positions] } else { vec![] },
            add: vec![],
            twist_next: vec![],
        };
        // Positions after each turn, and (twisted single pieces) the twist each piece gains on the way, as digits in piece order
        let (mut spots, mut moved, mut gained) = ([0u8; MAX_UNITS], [0u8; MAX_UNITS], [0u8; MAX_UNITS]);
        let zeros = [0u8; MAX_UNITS];
        for position in 0..positions {
            self.unrank_positions(position as u64, binomials, &mut spots[..units]);
            for turn in 0..turn_count {
                self.apply(&spots[..units], &zeros[..units], turn, &mut moved[..units], &mut gained[..units]);
                tables.position_next[turn * positions + position] = self.rank_positions(&moved[..units], binomials) as u32;
                if per_unit {
                    tables.delta[turn * positions + position] = self.rank_twists(&moved[..units], &gained[..units]) as u16;
                }
            }
        }
        // Base-t digits of a twist value, lowest first
        let base = self.twists as usize;
        let digits = |mut value: usize| {
            let mut out = [0usize; MAX_SPOTS];
            for digit in out.iter_mut() {
                *digit = value % base;
                value /= base;
            }
            out
        };
        // Twisted single pieces: digit-by-digit addition of twist values (piece order never changes, so twists and gains line up)
        if per_unit {
            tables.add = vec![0; space * space];
            for twists in 0..space {
                let a = digits(twists);
                for delta in 0..space {
                    let b = digits(delta);
                    let (mut sum, mut weight, mut k) = (0usize, 1usize, 0usize);
                    while weight < space {
                        sum += ((a[k] + b[k]) % base) * weight;
                        weight *= base;
                        k += 1;
                    }
                    tables.add[delta * space + twists] = sum as u32;
                }
            }
        }
        // Per-spot twists: each turn moves the digits to their new spots and adds each spot's twist
        if self.per_spot && space > 1 {
            tables.twist_next = vec![0; turn_count * space];
            let m = self.spots.len();
            for twists in 0..space {
                let mut at = [0usize; MAX_SPOTS];
                let mut rest = twists;
                for spot in (0..m).rev() {
                    at[spot] = rest % base;
                    rest /= base;
                }
                for turn in 0..turn_count {
                    let mut after = [0usize; MAX_SPOTS];
                    for spot in 0..m {
                        after[self.dest[turn * m + spot] as usize] = (at[spot] + self.add[turn * m + spot] as usize) % base;
                    }
                    tables.twist_next[turn * space + twists] = after[..m].iter().fold(0usize, |value, &digit| value * base + digit) as u32;
                }
            }
        }
        self.tables = Some(tables);
    }

    // Positions value after one turn, from the turn tables
    #[inline]
    fn next_position(&self, position: usize, turn: usize) -> u64 {
        let tables = self.tables.as_ref().unwrap();
        tables.position_next[turn * self.positions as usize + position] as u64
    }

    // Twists value after one turn, from the turn tables (twisted single pieces gain twists that depend on where they are)
    #[inline]
    fn next_twists(&self, position: usize, twists: usize, turn: usize) -> u64 {
        self.twist_row(position, turn)[twists] as u64
    }

    // Every twists value after one turn, as a row of the turn tables (indexed by the twists value before)
    #[inline]
    fn twist_row(&self, position: usize, turn: usize) -> &[u32] {
        let tables = self.tables.as_ref().unwrap();
        let space = self.twist_space as usize;
        if space == 1 {
            &ZERO_ROW
        } else if self.per_spot {
            &tables.twist_next[turn * space..(turn + 1) * space]
        } else {
            let delta = tables.delta[turn * self.positions as usize + position] as usize;
            &tables.add[delta * space..(delta + 1) * space]
        }
    }

    // Memory held by the turn tables, in bytes
    fn table_bytes(&self) -> usize {
        self.tables.as_ref().map_or(0, |t| t.position_next.len() * 4 + t.delta.len() * 2 + t.add.len() * 4 + t.twist_next.len() * 4)
    }
}

// Tracked pieces of some orbits, one entry per piece: its moving spot and twist (orbit by orbit, classes in order, each class's pieces by spot)
#[derive(Clone, Copy)]
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
    orbits: Vec<OrbitCoord>,
    // First unit of each orbit, plus the end
    offsets: Vec<usize>,
    // Value counts: positions, twists, and their product
    pub positions: u64,
    pub twist_space: u64,
    pub size: u64,
    // Every orbit has turn tables (neighbours are pure lookups)
    tabled: bool,
}

impl Part {
    // Number these orbits together (product of their sizes)
    fn new(orbits: Vec<OrbitCoord>) -> Result<Self, String> {
        let positions = orbits.iter().try_fold(1u64, |size, orbit| size.checked_mul(orbit.positions)).ok_or("Too many states")?;
        let twist_space = orbits.iter().try_fold(1u64, |size, orbit| size.checked_mul(orbit.twist_space)).ok_or("Too many states")?;
        let size = positions.checked_mul(twist_space).ok_or("Too many states")?;
        let mut offsets = vec![0];
        for orbit in &orbits {
            offsets.push(offsets.last().unwrap() + orbit.unit_count());
        }
        if *offsets.last().unwrap() > MAX_UNITS || orbits.len() > MAX_ORBITS {
            return Err("Too many tracked pieces for an exact table".to_owned());
        }
        Ok(Part { orbits, offsets, positions, twist_space, size, tabled: false })
    }

    // Give every orbit turn tables if they all fit (used for the outer part, whose neighbours are needed per block)
    fn build_tables(&mut self, turn_count: usize, binomials: &Binomials) {
        for orbit in &mut self.orbits {
            orbit.build_tables(turn_count, binomials);
        }
        self.tabled = self.orbits.iter().all(|orbit| orbit.tables.is_some());
    }

    // Free the turn tables (the fill is done; answers unpack pieces instead)
    pub fn drop_tables(&mut self) {
        for orbit in &mut self.orbits {
            orbit.tables = None;
        }
        self.tabled = false;
    }

    // Memory held by turn tables, in bytes
    pub fn table_bytes(&self) -> usize {
        self.orbits.iter().map(|orbit| orbit.table_bytes()).sum()
    }

    // Every orbit has tables and at most one has twists that count, so a turn's twists row can be read straight from that orbit's tables
    pub fn direct(&self) -> bool {
        self.tabled && self.orbits.iter().filter(|orbit| orbit.twist_space > 1).count() <= 1
    }

    // Each orbit's positions value, split out of the part's
    pub fn split_positions(&self, position: u64) -> [usize; MAX_ORBITS] {
        let mut own = [0usize; MAX_ORBITS];
        let mut rest = position;
        for (o, orbit) in self.orbits.iter().enumerate().rev() {
            own[o] = (rest % orbit.positions) as usize;
            rest /= orbit.positions;
        }
        own
    }

    // Positions value after one turn (direct parts), from each orbit's positions
    #[inline]
    pub fn next_position(&self, own: &[usize; MAX_ORBITS], turn: usize) -> u64 {
        let mut value: u64 = 0;
        for (o, orbit) in self.orbits.iter().enumerate() {
            value = value * orbit.positions + orbit.next_position(own[o], turn);
        }
        value
    }

    // Every twists value after one turn (direct parts): the twisted orbit's row, which is the whole part's twists
    #[inline]
    pub fn twist_row(&self, own: &[usize; MAX_ORBITS], turn: usize) -> &[u32] {
        match self.orbits.iter().position(|orbit| orbit.twist_space > 1) {
            Some(o) => self.orbits[o].twist_row(own[o], turn),
            None => &ZERO_ROW,
        }
    }

    // Tracked pieces of a pattern; None when an untouched spot doesn't hold what the targets have there (no turn can fix it)
    fn read(&self, pattern: &KPatternData) -> Option<Units> {
        let mut units = Units::new();
        for (o, orbit) in self.orbits.iter().enumerate() {
            let data = &pattern[&orbit.name];
            // Untouched spots must already be right
            if orbit.fixed.iter().any(|f| data.pieces[f.spot] != f.id || data.orientation[f.spot] % f.factor != f.twist) {
                return None;
            }
            // Twists no turn changes must already be right too
            for &spot in &orbit.spots {
                let at = spot as usize;
                if orbit.frozen.iter().any(|&(id, twist)| id == data.pieces[at] && data.orientation[at] % orbit.frozen_factor != twist) {
                    return None;
                }
            }
            // Each class's pieces in spot order, with their twists
            let mut u = self.offsets[o];
            for class in &orbit.classes {
                for (index, &spot) in orbit.spots.iter().enumerate() {
                    if data.pieces[spot as usize] == class.id {
                        if u == self.offsets[o + 1] {
                            return None;
                        }
                        units.spot[u] = index as u8;
                        units.twist[u] = if class.twisted { data.orientation[spot as usize] % orbit.twists } else { 0 };
                        u += 1;
                    }
                }
            }
            if u != self.offsets[o + 1] {
                return None;
            }
            // A layout the turns can't reach (e.g. centers no allowed move brings home)
            orbit.reachable_position(&units.spot[self.offsets[o]..u], Binomials::shared())?;
        }
        Some(units)
    }

    // Positions and twists values of these tracked pieces
    #[inline]
    fn rank_split(&self, units: &Units, binomials: &Binomials) -> (u64, u64) {
        let (mut positions, mut twists) = (0u64, 0u64);
        for (o, orbit) in self.orbits.iter().enumerate() {
            let range = self.offsets[o]..self.offsets[o + 1];
            positions = positions * orbit.positions + orbit.rank_positions(&units.spot[range.clone()], binomials);
            twists = twists * orbit.twist_space + orbit.rank_twists(&units.spot[range.clone()], &units.twist[range]);
        }
        (positions, twists)
    }

    // Value of these tracked pieces
    #[inline]
    pub fn rank(&self, units: &Units, binomials: &Binomials) -> u64 {
        let (positions, twists) = self.rank_split(units, binomials);
        positions * self.twist_space + twists
    }

    // Tracked pieces for a value (the inverse of rank)
    pub fn unrank(&self, value: u64, binomials: &Binomials, units: &mut Units) {
        let (mut positions, mut twists) = (value / self.twist_space, value % self.twist_space);
        for (o, orbit) in self.orbits.iter().enumerate().rev() {
            let range = self.offsets[o]..self.offsets[o + 1];
            orbit.unrank_positions(positions % orbit.positions, binomials, &mut units.spot[range.clone()]);
            orbit.unrank_twists(twists % orbit.twist_space, &units.spot[range.clone()], &mut units.twist[range]);
            positions /= orbit.positions;
            twists /= orbit.twist_space;
        }
    }

    // Tracked pieces after one turn
    #[inline]
    pub fn apply(&self, units: &Units, turn: usize, out: &mut Units) {
        for (o, orbit) in self.orbits.iter().enumerate() {
            let range = self.offsets[o]..self.offsets[o + 1];
            orbit.apply(&units.spot[range.clone()], &units.twist[range.clone()], turn, &mut out.spot[range.clone()], &mut out.twist[range]);
        }
    }

    // Positions after each turn (next_positions[turn]) and twists after each turn for twists first..first + width (next_twists[turn * width + k])
    #[allow(clippy::too_many_arguments)]
    pub fn block_next(&self, position: u64, first: u64, width: usize, next_positions: &mut [u64], next_twists: &mut [u32], binomials: &Binomials, units: &mut Units, moved: &mut Units) {
        let turn_count = next_positions.len();
        if self.tabled {
            // Each orbit's positions, split out once
            let mut own = [0usize; MAX_ORBITS];
            let mut rest = position;
            for (o, orbit) in self.orbits.iter().enumerate().rev() {
                own[o] = (rest % orbit.positions) as usize;
                rest /= orbit.positions;
            }
            // Positions after each turn, orbit by orbit from the tables
            for (turn, next) in next_positions.iter_mut().enumerate() {
                let mut value: u64 = 0;
                for (o, orbit) in self.orbits.iter().enumerate() {
                    value = value * orbit.positions + orbit.next_position(own[o], turn);
                }
                *next = value;
            }
            // Twists after each turn: each orbit's digits from its tables (they may depend on that orbit's positions)
            for k in 0..width {
                let mut digits = [0usize; MAX_ORBITS];
                let mut rest = first + k as u64;
                for (o, orbit) in self.orbits.iter().enumerate().rev() {
                    digits[o] = (rest % orbit.twist_space) as usize;
                    rest /= orbit.twist_space;
                }
                for turn in 0..turn_count {
                    let mut value: u64 = 0;
                    for (o, orbit) in self.orbits.iter().enumerate() {
                        value = value * orbit.twist_space + orbit.next_twists(own[o], digits[o], turn);
                    }
                    next_twists[turn * width + k] = value as u32;
                }
            }
        } else {
            // No tables: unpack each state of the range, turn it and renumber it
            for k in 0..width {
                self.unrank(position * self.twist_space + first + k as u64, binomials, units);
                for turn in 0..turn_count {
                    self.apply(units, turn, moved);
                    let (positions, twists) = self.rank_split(moved, binomials);
                    next_positions[turn] = positions;
                    next_twists[turn * width + k] = twists as u32;
                }
            }
        }
    }
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
            orbits.push(OrbitCoord::new(kpuzzle, &info.name, targets, &turns, &binomials)?);
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
