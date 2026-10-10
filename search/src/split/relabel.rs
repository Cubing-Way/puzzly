// How a pattern becomes one sub-table's: the pieces it leaves out share one id, orbit by orbit (also for rotated copies of a sub-goal)

use super::*;

// How a pattern becomes one sub-table's, orbit by orbit
pub(super) struct Relabel {
    pub(super) orbits: Vec<OrbitRelabel>,
}

// One orbit's relabeling: the new id for each old id, whether that piece's twist still counts, and where each spot's piece comes from
// (a rotated view: spot s takes the piece on spot from[s], twisted by add[s] plus its id's amount in per_id; a plain view takes each spot's own piece as it is)
pub(super) struct OrbitRelabel {
    pub(super) name: KPuzzleOrbitName,
    pub(super) orientations: u8,
    pub(super) ids: [u8; 256],
    pub(super) twist: [bool; 256],
    pub(super) from: Vec<u8>,
    pub(super) add: Vec<u8>,
    pub(super) per_id: [u8; 256],
}

impl Relabel {
    // Kept items keep their ids (and twists when asked), every other piece on a moving spot joins one twist-free rest class;
    // ids are then renumbered by the first spot they fill in the first target, so the same sub-goal gives the same table whatever goal it came from
    pub(super) fn new(kpuzzle: &KPuzzle, targets: &[KPatternData], full: &Coords, items: &[Item], kept: &[(usize, bool)]) -> Relabel {
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
            // A set whose only rest piece is a piece of its own keeps that piece's id (twist-free): the table knows where it is either way, and the sub-goal then
            // reads the same whichever piece of the set was left out (a DR finish's "all edges" tables are rotated copies of each other)
            for orbit in full.orbits().filter(|orbit| orbit.name == info.name) {
                let rest: Vec<u8> = orbit.spots.iter().map(|&spot| first.pieces[spot as usize]).filter(|&id| temporary[id as usize] == REST).collect();
                if let [id] = rest[..] {
                    if first.pieces.iter().filter(|&&piece| piece == id).count() == 1 {
                        temporary[id as usize] = id;
                    }
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
            let count = info.num_pieces as usize;
            orbits.push(OrbitRelabel { name: info.name.clone(), orientations: info.num_orientations, ids, twist, from: (0..count as u8).collect(), add: vec![0; count], per_id: [0; 256] });
        }
        Relabel { orbits }
    }

    // This sub-goal read through a rotation (a plain relabeling's rotated view, given the goal's first target): each spot takes the piece the rotation brings there,
    // each twisted id gains the amount that leaves the first target untwisted, and ids are renumbered by the first spot they fill in the rotated first target,
    // so rotated copies of one sub-goal give equal targets (any per-id twist amount keeps distances; this choice only makes copies match)
    pub(super) fn rotated(&self, rotation: &Rotation, first: &KPatternData) -> Relabel {
        let mut orbits = vec![];
        for (o, orbit) in self.orbits.iter().enumerate() {
            let data = &first[&orbit.name];
            let count = data.pieces.len();
            let mods = data.orientation_mod.clone().unwrap_or_else(|| vec![0; count]);
            let (from, add) = (&rotation.from[o], &rotation.add[o]);
            let mut per_id = [0u8; 256];
            let mut set = [false; 256];
            let mut canonical = [UNKNOWN; 256];
            for spot in 0..count {
                let source = from[spot] as usize;
                let piece = data.pieces[source] as usize;
                // The first spot an id lands on decides its new id, and (twist counted) the amount that brings that piece back to twist 0
                if orbit.ids[piece] != UNKNOWN && canonical[orbit.ids[piece] as usize] == UNKNOWN {
                    canonical[orbit.ids[piece] as usize] = spot as u8;
                }
                if orbit.twist[piece] && !set[piece] {
                    let factor = twist_factor(mods[source], orbit.orientations);
                    per_id[piece] = (factor - (data.orientation[source] + add[spot]) % factor) % factor;
                    set[piece] = true;
                }
            }
            // Old id → new id (ids no target holds stay unknown)
            let mut ids = [UNKNOWN; 256];
            for id in 0..256 {
                if orbit.ids[id] != UNKNOWN {
                    ids[id] = canonical[orbit.ids[id] as usize];
                }
            }
            orbits.push(OrbitRelabel { name: orbit.name.clone(), orientations: orbit.orientations, ids, twist: orbit.twist, from: from.clone(), add: add.clone(), per_id });
        }
        Relabel { orbits }
    }

    // The pattern as the sub-table sees it (left-out twists become 0, ignored), through the view's rotation if any
    pub(super) fn apply(&self, pattern: &KPatternData) -> KPatternData {
        let mut out = KPatternData::new();
        for orbit in &self.orbits {
            let data = &pattern[&orbit.name];
            let mods = data.orientation_mod.clone().unwrap_or_else(|| vec![0; data.pieces.len()]);
            let mut relabeled = KPatternOrbitData { pieces: vec![], orientation: vec![], orientation_mod: Some(vec![]) };
            for spot in 0..data.pieces.len() {
                let source = orbit.from[spot] as usize;
                let piece = data.pieces[source] as usize;
                let keep_twist = orbit.twist[piece];
                relabeled.pieces.push(orbit.ids[piece]);
                let factor = twist_factor(mods[source], orbit.orientations);
                relabeled.orientation.push(if keep_twist { (data.orientation[source] + orbit.add[spot] + orbit.per_id[piece]) % factor } else { 0 });
                relabeled.orientation_mod.as_mut().unwrap().push(if keep_twist { mods[source] } else { 1 });
            }
            out.insert(orbit.name.clone(), relabeled);
        }
        out
    }
}

// A pattern as JSON with orbits in the puzzle's order, so equal patterns give equal text (the sub-table cache key)
pub(super) fn pattern_json(kpuzzle: &KPuzzle, pattern: &KPatternData) -> String {
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
