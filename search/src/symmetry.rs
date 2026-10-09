// Rotated lookups: a rotation that keeps the allowed moves turns any sub-goal into another sub-goal just as many moves away (R⁻¹ · state · R, each turn rotated the same way),
// so rotated copies of a sub-goal, from this goal or any other, are built as one table and each copy reads it on the rotated state

use cubing::alg::Move;
use cubing::kpuzzle::{KPuzzle, KPuzzleOrbitName, KTransformationData};

use crate::coords::Turn;

// Most rotations looked for (a cube has 24)
const MAX_ROTATIONS: usize = 48;

// One orbit of a whole-puzzle transformation: for each spot, the spot its piece comes from and the twist it gains
#[derive(Clone, PartialEq)]
struct OrbitMove {
    from: Vec<u8>,
    add: Vec<u8>,
}

// A rotation that keeps the allowed moves: per orbit (puzzle order) where each spot's piece comes from and the twist it gains (R's own move),
// and the turn each allowed turn becomes on a rotated state (R⁻¹ · turn · R)
pub(crate) struct Rotation {
    pub(crate) from: Vec<Vec<u8>>,
    pub(crate) add: Vec<Vec<u8>>,
    pub(crate) turns: Vec<u8>,
}

// The rotations that keep a move set (the identity first)
pub(crate) struct Rotations {
    pub(crate) list: Vec<Rotation>,
}

impl Rotations {
    // Every rotation the puzzle's x and y generate (24 on the cube) that turns each allowed turn into an allowed turn (just the identity on a puzzle without them)
    pub(crate) fn new(kpuzzle: &KPuzzle, turns: &[Turn]) -> Rotations {
        let names: Vec<KPuzzleOrbitName> = kpuzzle.orbit_info_iter().map(|info| info.name.clone()).collect();
        let orientations: Vec<u8> = kpuzzle.orbit_info_iter().map(|info| info.num_orientations).collect();
        // A transformation as one OrbitMove per orbit
        let split = |data: &KTransformationData| -> Vec<OrbitMove> {
            names
                .iter()
                .enumerate()
                .map(|(o, name)| OrbitMove { from: data[name].permutation.clone(), add: data[name].orientation_delta.iter().map(|&twist| twist % orientations[o]).collect() })
                .collect()
        };
        // a, then b (orbit by orbit)
        let compose = |a: &[OrbitMove], b: &[OrbitMove]| -> Vec<OrbitMove> {
            a.iter()
                .zip(b)
                .enumerate()
                .map(|(o, (x, y))| OrbitMove {
                    from: y.from.iter().map(|&source| x.from[source as usize]).collect(),
                    add: y.from.iter().zip(&y.add).map(|(&source, &gain)| (x.add[source as usize] + gain) % orientations[o]).collect(),
                })
                .collect()
        };
        // The transformation that undoes this one
        let invert = |a: &[OrbitMove]| -> Vec<OrbitMove> {
            a.iter()
                .enumerate()
                .map(|(o, x)| {
                    let mut out = OrbitMove { from: vec![0; x.from.len()], add: vec![0; x.from.len()] };
                    for (spot, &to) in x.from.iter().enumerate() {
                        out.from[to as usize] = spot as u8;
                        out.add[to as usize] = (orientations[o] - x.add[spot]) % orientations[o];
                    }
                    out
                })
                .collect()
        };
        // The group x and y generate, found breadth-first from the identity
        let identity = split(&kpuzzle.identity_transformation().to_data());
        let generators: Vec<Vec<OrbitMove>> = ["x", "y"]
            .iter()
            .filter_map(|name| name.parse::<Move>().ok())
            .filter_map(|rotation| kpuzzle.transformation_from_move(&rotation).ok())
            .map(|transformation| split(&transformation.to_data()))
            .collect();
        let mut group = vec![identity];
        let mut next = 0;
        while next < group.len() && group.len() < MAX_ROTATIONS {
            for generator in &generators {
                let product = compose(&group[next], generator);
                if !group.contains(&product) {
                    group.push(product);
                }
            }
            next += 1;
        }
        // Keep the rotations whose rotated turns are all allowed turns (compared exactly, every orbit), with that turn map
        let own_turns: Vec<Vec<OrbitMove>> = turns.iter().map(|turn| split(&turn.data)).collect();
        let mut list = vec![];
        for rotation in group {
            let inverse = invert(&rotation);
            let map: Vec<u8> = own_turns
                .iter()
                .map_while(|turn| {
                    let rotated = compose(&compose(&inverse, turn), &rotation);
                    own_turns.iter().position(|other| *other == rotated).map(|index| index as u8)
                })
                .collect();
            if map.len() == turns.len() {
                list.push(Rotation { from: rotation.iter().map(|orbit| orbit.from.clone()).collect(), add: rotation.iter().map(|orbit| orbit.add.clone()).collect(), turns: map });
            }
        }
        Rotations { list }
    }
}
