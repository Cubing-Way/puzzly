// Rotated lookups: when the goal is "every tracked piece home" (one target, each piece its own id), a state and its rotated copies (by rotations that keep
// the allowed moves) are the same number of moves away, so a sub-table read on a rotated copy stands in for the table of the rotated pieces (built once, read several ways)

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPuzzle, KPuzzleOrbitName, KTransformationData};

use crate::coords::{twist_factor, Turn};

// Most rotations looked for (a cube has 24)
const MAX_ROTATIONS: usize = 48;

// A whole-puzzle transformation, orbits one after another: for each spot, the spot its piece comes from and the twist it gains
#[derive(Clone, PartialEq)]
struct Flat {
    from: Vec<u8>,
    add: Vec<u8>,
}

// A rotation that keeps the allowed moves: it, its inverse, and the turn each allowed turn becomes on a rotated state (R⁻¹ · turn · R)
pub(crate) struct Rotation {
    flat: Flat,
    inverse: Flat,
    pub(crate) turns: Vec<u8>,
}

// Pieces a sub-table tracks: (orbit, home spot, twist counted), sorted
pub(crate) type Shape = Vec<(u8, u8, bool)>;

// An identity goal's layout (orbits flattened into one spot list), which orbits it tracks, and the rotations that keep its moves (the identity first)
pub(crate) struct Symmetry {
    names: Vec<KPuzzleOrbitName>,
    // First flat spot of each orbit, plus the total
    offsets: Vec<usize>,
    // Per flat spot: the orbit's twist count, and the twist count the goal judges (1 = twists ignored)
    orientations: Vec<u8>,
    modulus: Vec<u8>,
    // Per orbit: the goal tracks every piece (each its own id), or ignores the whole orbit (one shared id)
    tracked: Vec<bool>,
    // Per orbit: home spot of each id, and the id whose home each spot is
    homes: Vec<Vec<u8>>,
    labels: Vec<Vec<u8>>,
    pub(crate) rotations: Vec<Rotation>,
}

impl Symmetry {
    // Read an identity goal from its targets (None for any other goal), and find the rotations (from the puzzle's x and y) that turn every allowed turn into an allowed turn
    pub(crate) fn new(kpuzzle: &KPuzzle, targets: &[KPatternData], turns: &[Turn]) -> Option<Symmetry> {
        // One target only: several (offsets, "solvable with" moves, relative groups) are rarely mapped onto each other by a rotation
        if targets.len() != 1 {
            return None;
        }
        let target = &targets[0];
        let mut symmetry = Symmetry { names: vec![], offsets: vec![0], orientations: vec![], modulus: vec![], tracked: vec![], homes: vec![], labels: vec![], rotations: vec![] };
        for info in kpuzzle.orbit_info_iter() {
            let data = &target[&info.name];
            let count = info.num_pieces as usize;
            let mods = data.orientation_mod.clone().unwrap_or_else(|| vec![0; count]);
            let factors: Vec<u8> = mods.iter().map(|&value| twist_factor(value, info.num_orientations)).collect();
            let mut seen = [false; 256];
            let distinct = data.pieces.iter().all(|&id| !std::mem::replace(&mut seen[id as usize], true));
            // Tracked: every piece its own id, with every twist counted and home, or none counted; ignored: one shared id and no twist
            let modulus = factors.first().copied().unwrap_or(1);
            let same = factors.iter().all(|&factor| factor == modulus);
            let tracked = if distinct && same && (modulus == 1 || modulus == info.num_orientations) && data.orientation.iter().all(|&twist| twist % modulus == 0) {
                true
            } else if data.pieces.iter().all(|&id| id == data.pieces[0]) && factors.iter().all(|&factor| factor == 1) {
                false
            } else {
                return None;
            };
            // Home spot of each id (every piece is home in the target)
            let mut homes = vec![0u8; 256];
            for (spot, &id) in data.pieces.iter().enumerate() {
                homes[id as usize] = spot as u8;
            }
            symmetry.names.push(info.name.clone());
            symmetry.offsets.push(symmetry.offsets.last().unwrap() + count);
            symmetry.orientations.extend(std::iter::repeat_n(info.num_orientations, count));
            symmetry.modulus.extend(std::iter::repeat_n(if tracked { modulus } else { 1 }, count));
            symmetry.tracked.push(tracked);
            symmetry.homes.push(homes);
            symmetry.labels.push(data.pieces.clone());
        }
        let total = *symmetry.offsets.last().unwrap();
        if total > u8::MAX as usize {
            return None;
        }
        // Rotations: the group x and y generate (just the identity on a puzzle without them)
        let flat_turns: Vec<Flat> = turns.iter().map(|turn| symmetry.flatten(&turn.data)).collect();
        let identity = Flat { from: (0..total).map(|spot| spot as u8).collect(), add: vec![0; total] };
        let generators: Vec<Flat> = ["x", "y"]
            .iter()
            .filter_map(|name| name.parse::<Move>().ok())
            .filter_map(|rotation| kpuzzle.transformation_from_move(&rotation).ok())
            .map(|transformation| symmetry.flatten(&transformation.to_data()))
            .collect();
        let mut group = vec![identity];
        let mut next = 0;
        while next < group.len() && group.len() < MAX_ROTATIONS {
            for generator in &generators {
                let product = symmetry.compose(&group[next], generator);
                if !group.contains(&product) {
                    group.push(product);
                }
            }
            next += 1;
        }
        // Keep the rotations that turn every allowed turn into an allowed turn (as far as the goal can tell), with that turn map
        for flat in group {
            let inverse = symmetry.invert(&flat);
            let map: Vec<u8> = flat_turns
                .iter()
                .map_while(|turn| {
                    let rotated = symmetry.compose(&symmetry.compose(&inverse, turn), &flat);
                    flat_turns.iter().position(|other| symmetry.same(other, &rotated)).map(|index| index as u8)
                })
                .collect();
            if map.len() == turns.len() {
                symmetry.rotations.push(Rotation { flat, inverse, turns: map });
            }
        }
        Some(symmetry)
    }

    // A transformation in flat form
    fn flatten(&self, data: &KTransformationData) -> Flat {
        let total = *self.offsets.last().unwrap();
        let mut flat = Flat { from: vec![0; total], add: vec![0; total] };
        for (o, name) in self.names.iter().enumerate() {
            let offset = self.offsets[o];
            let orbit = &data[name];
            for spot in 0..orbit.permutation.len() {
                flat.from[offset + spot] = (offset + orbit.permutation[spot] as usize) as u8;
                flat.add[offset + spot] = orbit.orientation_delta[spot] % self.orientations[offset + spot];
            }
        }
        flat
    }

    // a, then b
    fn compose(&self, a: &Flat, b: &Flat) -> Flat {
        let total = a.from.len();
        let mut out = Flat { from: vec![0; total], add: vec![0; total] };
        for spot in 0..total {
            let source = b.from[spot] as usize;
            out.from[spot] = a.from[source];
            out.add[spot] = (a.add[source] + b.add[spot]) % self.orientations[spot];
        }
        out
    }

    // The transformation that undoes this one
    fn invert(&self, a: &Flat) -> Flat {
        let total = a.from.len();
        let mut out = Flat { from: vec![0; total], add: vec![0; total] };
        for spot in 0..total {
            let to = a.from[spot] as usize;
            out.from[to] = spot as u8;
            out.add[to] = (self.orientations[spot] - a.add[spot]) % self.orientations[spot];
        }
        out
    }

    // Two transformations do the same to every tracked orbit (twists compared as far as the goal counts them)
    fn same(&self, a: &Flat, b: &Flat) -> bool {
        (0..self.names.len()).filter(|&o| self.tracked[o]).all(|o| {
            (self.offsets[o]..self.offsets[o + 1]).all(|spot| a.from[spot] == b.from[spot] && a.add[spot] % self.modulus[spot] == b.add[spot] % self.modulus[spot])
        })
    }

    // Home spot of a piece id in an orbit (puzzle order)
    pub(crate) fn home(&self, orbit: usize, id: u8) -> u8 {
        self.homes[orbit][id as usize]
    }

    // The pieces a sub-table reads on a state rotated by rotation r, named as pieces of the state itself (piece h of the rotated state is piece R(h) of the state)
    pub(crate) fn turned(&self, shape: &Shape, r: usize) -> Shape {
        let from = &self.rotations[r].flat.from;
        let mut out: Shape = shape
            .iter()
            .map(|&(o, home, twist)| {
                let offset = self.offsets[o as usize];
                (o, (from[offset + home as usize] as usize - offset) as u8, twist)
            })
            .collect();
        out.sort_unstable();
        out
    }

    // A pattern rotated by rotation r (R⁻¹ · state · R): as far from the goal as the pattern, when each turn is rotated as in Rotation.turns
    pub(crate) fn rotate(&self, pattern: &KPatternData, r: usize) -> KPatternData {
        let rotation = &self.rotations[r];
        let rotated = self.compose(&self.compose(&rotation.inverse, &self.state(pattern)), &rotation.flat);
        let mut out = pattern.clone();
        for (o, name) in self.names.iter().enumerate() {
            if !self.tracked[o] {
                continue;
            }
            let offset = self.offsets[o];
            let orbit = out.get_mut(name).unwrap();
            for spot in 0..orbit.pieces.len() {
                orbit.pieces[spot] = self.labels[o][rotated.from[offset + spot] as usize - offset];
                orbit.orientation[spot] = rotated.add[offset + spot];
            }
        }
        out
    }

    // A pattern as a transformation from the goal: each spot's piece as its home spot, with its twist (ignored orbits: every piece home)
    fn state(&self, pattern: &KPatternData) -> Flat {
        let total = *self.offsets.last().unwrap();
        let mut flat = Flat { from: (0..total).map(|spot| spot as u8).collect(), add: vec![0; total] };
        for (o, name) in self.names.iter().enumerate() {
            if !self.tracked[o] {
                continue;
            }
            let offset = self.offsets[o];
            let orbit = &pattern[name];
            for spot in 0..orbit.pieces.len() {
                flat.from[offset + spot] = (offset + self.home(o, orbit.pieces[spot]) as usize) as u8;
                flat.add[offset + spot] = orbit.orientation[spot] % self.orientations[offset + spot];
            }
        }
        flat
    }
}
