// Goals that also count when some moves alone could finish them ("solvable with", e.g. R U for corners a 2-gen finish can solve): their targets are closed under those moves

use std::collections::HashSet;

use cubing::alg::Move;
use cubing::kpuzzle::{KPatternData, KPatternOrbitData, KPuzzle, KTransformationData};

use crate::coords::{pattern_data, Turn};

// Most targets a goal may have once closed under its moves (each one is a table seed and a goal-check entry)
pub const MAX_TARGETS: usize = 100_000;

// A goal's targets as sent: a JSON list of patterns, or {"targets": [...], "solvableWith": ["R", "U"]} when those moves may finish it later;
// gives the patterns as sent and those moves (none for a plain list)
pub fn read_targets(kpuzzle: &KPuzzle, targets_json: &str) -> Result<(Vec<KPatternData>, Vec<Move>), String> {
    let value: serde_json::Value = serde_json::from_str(targets_json).map_err(|e| e.to_string())?;
    // A plain list, or the list and the moves from an object
    let (list, free) = match &value {
        serde_json::Value::Array(list) => (list.clone(), vec![]),
        _ => {
            let list = value["targets"].as_array().ok_or("Targets must be a list of patterns")?.clone();
            let free: Vec<Move> = serde_json::from_value(value["solvableWith"].clone()).map_err(|e| e.to_string())?;
            (list, free)
        }
    };
    let targets = list.iter().map(|target| pattern_data(kpuzzle, &target.to_string())).collect::<Result<Vec<_>, _>>()?;
    if targets.is_empty() {
        return Err("No target".to_owned());
    }
    Ok((targets, free))
}

// The targets as sent, closed under their "solvable with" moves and checked against the allowed turns
pub fn closed_targets(kpuzzle: &KPuzzle, targets_json: &str, turns: &[Turn]) -> Result<Vec<KPatternData>, String> {
    let (targets, free) = read_targets(kpuzzle, targets_json)?;
    close(kpuzzle, &targets, &free, turns)
}

// Every pattern those moves reach from the targets (the targets first, in their order, so the first target stays first);
// fails when there are too many, or when the moves change a spot the allowed turns never touch (no allowed turn could reach those targets)
pub fn close(kpuzzle: &KPuzzle, targets: &[KPatternData], free: &[Move], turns: &[Turn]) -> Result<Vec<KPatternData>, String> {
    if free.is_empty() {
        return Ok(targets.to_vec());
    }
    // Each move's effect (its powers come from applying it again)
    let generators = free
        .iter()
        .map(|step| kpuzzle.transformation_from_move(step).map(|transformation| transformation.to_data()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    // Breadth-first from every target at once, keeping each pattern once
    let mut seen: HashSet<Vec<u8>> = HashSet::new();
    let mut list: Vec<Vec<u8>> = vec![];
    for target in targets {
        let bytes = flat(kpuzzle, target);
        if seen.insert(bytes.clone()) {
            list.push(bytes);
        }
    }
    let mut moved = vec![];
    let mut next = 0;
    while next < list.len() {
        for generator in &generators {
            apply(kpuzzle, &list[next], generator, &mut moved);
            if seen.contains(&moved) {
                continue;
            }
            if list.len() >= MAX_TARGETS {
                return Err(format!(
                    "Solvable with: more than {} cube states would count as the goal; mark pieces those moves twist anyway with :p, or check fewer pieces",
                    MAX_TARGETS
                ));
            }
            seen.insert(moved.clone());
            list.push(moved.clone());
        }
        next += 1;
    }
    let closed: Vec<KPatternData> = list.iter().map(|bytes| unflat(kpuzzle, bytes)).collect();
    check_untouched(kpuzzle, &closed, turns)?;
    Ok(closed)
}

// The targets as the JSON a table takes: a plain list when the moves add no pattern (so the table is shared with goals without them), else the object with the moves
pub fn table_targets(kpuzzle: &KPuzzle, targets: &[KPatternData], free: &[Move], turns: &[Turn], json: impl Fn(&KPatternData) -> String) -> Result<String, String> {
    let list = format!("[{}]", targets.iter().map(&json).collect::<Vec<_>>().join(","));
    // Patterns the targets hold, each once, against the closed set
    let distinct: HashSet<Vec<u8>> = targets.iter().map(|target| flat(kpuzzle, target)).collect();
    if free.is_empty() || close(kpuzzle, targets, free, turns)?.len() == distinct.len() {
        return Ok(list);
    }
    let moves = serde_json::to_string(&free.iter().map(|step| step.to_string()).collect::<Vec<_>>()).map_err(|e| e.to_string())?;
    Ok(format!("{{\"targets\":{},\"solvableWith\":{}}}", list, moves))
}

// Twist values that count for a piece: its orientation mod (0 = all of the orbit's orientations)
fn factor(mod_value: u8, num_orientations: u8) -> u8 {
    if mod_value == 0 { num_orientations } else { mod_value }
}

// A pattern as bytes, orbit by orbit in the puzzle's order: pieces, twists (reduced by what counts) and orientation mods
fn flat(kpuzzle: &KPuzzle, pattern: &KPatternData) -> Vec<u8> {
    let mut bytes = vec![];
    for info in kpuzzle.orbit_info_iter() {
        let data = &pattern[&info.name];
        let count = info.num_pieces as usize;
        let mods = data.orientation_mod.clone().unwrap_or_else(|| vec![0; count]);
        bytes.extend_from_slice(&data.pieces);
        bytes.extend((0..count).map(|spot| data.orientation[spot] % factor(mods[spot], info.num_orientations)));
        bytes.extend_from_slice(&mods);
    }
    bytes
}

// Bytes back into a pattern (the inverse of flat)
fn unflat(kpuzzle: &KPuzzle, bytes: &[u8]) -> KPatternData {
    let mut pattern = KPatternData::new();
    let mut at = 0;
    for info in kpuzzle.orbit_info_iter() {
        let count = info.num_pieces as usize;
        let pieces = bytes[at..at + count].to_vec();
        let orientation = bytes[at + count..at + 2 * count].to_vec();
        let mods = bytes[at + 2 * count..at + 3 * count].to_vec();
        pattern.insert(info.name.clone(), KPatternOrbitData { pieces, orientation, orientation_mod: Some(mods) });
        at += 3 * count;
    }
    pattern
}

// A flat pattern after one move: each spot takes the piece (and its orientation mod) the move brings there, twisted by the spot's change (new[i] = old[permutation[i]])
fn apply(kpuzzle: &KPuzzle, bytes: &[u8], transformation: &KTransformationData, out: &mut Vec<u8>) {
    out.clear();
    out.resize(bytes.len(), 0);
    let mut at = 0;
    for info in kpuzzle.orbit_info_iter() {
        let count = info.num_pieces as usize;
        let orbit = &transformation[&info.name];
        for to in 0..count {
            let from = orbit.permutation[to] as usize;
            let mod_value = bytes[at + 2 * count + from];
            out[at + to] = bytes[at + from];
            out[at + count + to] = (bytes[at + count + from] + orbit.orientation_delta[to]) % factor(mod_value, info.num_orientations);
            out[at + 2 * count + to] = mod_value;
        }
        at += 3 * count;
    }
}

// Closed targets must agree on every spot no allowed turn moves (else the "solvable with" moves reach targets the allowed moves never can)
fn check_untouched(kpuzzle: &KPuzzle, targets: &[KPatternData], turns: &[Turn]) -> Result<(), String> {
    let first = &targets[0];
    for info in kpuzzle.orbit_info_iter() {
        let count = info.num_pieces as usize;
        let mods = first[&info.name].orientation_mod.clone().unwrap_or_else(|| vec![0; count]);
        for spot in 0..count {
            // A spot moves when some allowed turn brings another piece there or twists it in a way that counts (as coords.rs decides)
            let twists = factor(mods[spot], info.num_orientations);
            let moving = turns.iter().any(|turn| {
                let orbit = &turn.data[&info.name];
                orbit.permutation[spot] as usize != spot || orbit.orientation_delta[spot] % twists != 0
            });
            if moving {
                continue;
            }
            let (piece, twist) = (first[&info.name].pieces[spot], first[&info.name].orientation[spot] % twists);
            if targets.iter().any(|target| target[&info.name].pieces[spot] != piece || target[&info.name].orientation[spot] % twists != twist) {
                return Err("Solvable with: those moves change pieces the allowed moves never turn; allow them too, or leave those pieces (or centers) out of the goal".to_owned());
            }
        }
    }
    Ok(())
}
