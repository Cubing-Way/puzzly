// The speed bound a list prunes with (a step ranked by speed, see step/bound.ts): the least any way the hands could make an answer can cost, worked out
// turn by turn as the IDA* goes deeper, so a path no answer can come in under the step's bar from isn't followed. Each turn counts at its floor less
// what keeping the rhythm could save it (as the writing search's own bound counts it), in each frame the cube may be held in: as the grip and its twins
// hold it, or brought round by wide turns, slice turns and rotations, as the step's axes allow. Turns that may cancel into the moves before the step
// count nothing, and what that could save comes off. A path that could still give a grip the first clean answer (none of the faces to avoid) is
// followed anyway: the ranking puts an answer on those faces after any clean one held the same way, whatever it costs

use std::collections::HashMap;

use crate::speed::writings::{times, Frame, SUFFIXES, WRITTEN};

use super::*;

// Ways to hold the cube
pub(super) const FRAMES: usize = 24;
// No way to get there
const NEVER: f64 = f64::INFINITY;

// Where the joining of a path's first turns into the moves before the step stands (see SpeedBound::child): the run of turns about one axis they'd meet
// next (counted from the end), whether one of them met that run already, whether they may still be joining, the most of those moves that may stay,
// and whether the turn that led here may have joined them (then it counts nothing)
#[derive(Clone, Copy, Default)]
pub(crate) struct Join {
    run: usize,
    met: bool,
    joining: bool,
    kept: usize,
    pub(super) free: bool,
}

// A step's bar and what the search needs to bound its answers' speed, read from the list request ("speed", see step/bound.ts) for its turns
pub(crate) struct SpeedBound {
    bar: f64,
    // The least a turn left can cost in any writing
    least: f64,
    turns: usize,
    // Each (frame, turn): the turn itself and the wide turns that make it, as (cost, frame after), and how many there are
    ways: Vec<[(f64, u8); 3]>,
    counts: Vec<u8>,
    // Each (frame, turn, next turn): the slice turn that makes both (cost, frame after; NEVER when none), and each (frame, turn): half the cheapest
    // slice turn it may start (the turn after it pays the other half)
    pairs: Vec<(f64, u8)>,
    halves: Vec<f64>,
    // Rotations between turns (the cheapest from each frame to each other one), when the step may make them
    closure: Option<Vec<f64>>,
    // What holding the cube each way costs before the first turn (NEVER: no answer starts so)
    starts: [f64; FRAMES],
    // Each turn's axis; the moves before the step as runs of turns about one axis from the end (axis, where the run starts), how many of them stay
    // when no turn joins them, and the most joining them could save from each place on
    axes: Vec<u8>,
    runs: Vec<(u8, usize)>,
    kept: usize,
    credit: Vec<f64>,
    // Grips no clean answer was given in yet (one bit each), and for each turn, the grips it may be made clean in
    holds: u64,
    clean: Vec<u64>,
}

// A face's axis: 0 = x (R, L), 1 = y (U, D), 2 = z (F, B)
fn axis_of(face: u8) -> u8 {
    match face {
        b'R' | b'L' => 0,
        b'U' | b'D' => 1,
        _ => 2,
    }
}

// A turn's name read as its face and quarter turns clockwise (None: not a plain face turn)
fn face_turn(name: &str) -> Option<(u8, usize)> {
    match name.as_bytes() {
        [face] if b"URFDLB".contains(face) => Some((*face, 1)),
        [face, b'\''] if b"URFDLB".contains(face) => Some((*face, 3)),
        [face, b'2'] if b"URFDLB".contains(face) => Some((*face, 2)),
        _ => None,
    }
}

impl SpeedBound {
    // The bound for these turns (None: no bound asked for, or a turn that isn't a plain face turn, which the step never sends one for)
    pub(crate) fn read(value: &serde_json::Value, turns: &[Turn]) -> Option<SpeedBound> {
        let bar = value["bar"].as_f64()?;
        let steps: Vec<(u8, usize)> = turns.iter().map(|turn| face_turn(&turn.name)).collect::<Option<_>>()?;
        let floors: HashMap<&str, f64> = value["floors"].as_object()?.iter().filter_map(|(token, cost)| Some((token.as_str(), cost.as_f64()?))).collect();
        // A token's floor (nothing when the step didn't send it: the bound only gets lower)
        let floor = |token: &str| floors.get(token).copied().unwrap_or(0.0);
        let text = |key: &str| value[key].as_str().unwrap_or("").to_owned();
        let (wide, slice, rotation) = (text("wide"), text("slice"), text("rotation"));
        let allowed = |axes: &str, axis: usize| axes.contains(['x', 'y', 'z'][axis]);
        // Every way to hold the cube, numbered
        let mut frames = vec![Frame::HOME];
        let mut index = HashMap::from([(Frame::HOME, 0u8)]);
        let mut at = 0;
        while at < frames.len() {
            for axis in 0..3 {
                let next = frames[at].rotate(axis, 1);
                if let std::collections::hash_map::Entry::Vacant(entry) = index.entry(next) {
                    entry.insert(frames.len() as u8);
                    frames.push(next);
                }
            }
            at += 1;
        }
        let count = turns.len();
        let mut ways = vec![[(NEVER, 0u8); 3]; FRAMES * count];
        let mut counts = vec![0u8; FRAMES * count];
        let mut pairs = vec![(NEVER, 0u8); FRAMES * count * count];
        let mut halves = vec![NEVER; FRAMES * count];
        for (f, frame) in frames.iter().enumerate() {
            for (t, &(face, quarters)) in steps.iter().enumerate() {
                // The turn itself, on the side its face is on as the cube is held, then the wide turn of the opposite side that makes it
                let side = frame.side_of(face);
                let cell = f * count + t;
                ways[cell][0] = (floor(&format!("{}{}", side as char, SUFFIXES[quarters])), f as u8);
                counts[cell] = 1;
                for form in WRITTEN.iter().filter(|form| form.faces.len() == 1 && allowed(&wide, form.axis) && form.faces[0].as_bytes()[0] == side) {
                    let (token, _) = times(form.token, quarters);
                    let (_, turned) = times(form.rotation, quarters);
                    ways[cell][counts[cell] as usize] = (floor(&token), index[&frame.rotate(form.axis, turned)]);
                    counts[cell] += 1;
                }
                // Slice turns it starts: half the cheapest, and with each next turn the one that makes both
                for form in WRITTEN.iter().filter(|form| form.faces.len() == 2 && allowed(&slice, form.axis)) {
                    let Some(first) = form.faces.iter().position(|each| each.as_bytes()[0] == side) else { continue };
                    let made = if form.faces[first].ends_with('\'') { 4 - quarters } else { quarters };
                    let (token, _) = times(form.token, made);
                    let (_, turned) = times(form.rotation, made);
                    let cost = floor(&token);
                    halves[cell] = halves[cell].min(cost / 2.0);
                    let other = form.faces[1 - first];
                    let needs = if other.ends_with('\'') { 4 - made } else { made };
                    for (n, &(next_face, next_quarters)) in steps.iter().enumerate() {
                        let pair = &mut pairs[cell * count + n];
                        if frame.side_of(next_face) == other.as_bytes()[0] && next_quarters == needs && cost < pair.0 {
                            *pair = (cost, index[&frame.rotate(form.axis, turned)]);
                        }
                    }
                }
            }
        }
        // Rotations the step may make between turns: the cheapest way from each frame to each other one
        let closure = (!rotation.is_empty()).then(|| {
            let mut cost = vec![NEVER; FRAMES * FRAMES];
            for f in 0..FRAMES {
                cost[f * FRAMES + f] = 0.0;
                for axis in (0..3).filter(|&axis| allowed(&rotation, axis)) {
                    for quarters in 1..4 {
                        let g = index[&frames[f].rotate(axis, quarters)] as usize;
                        let token = format!("{}{}", ['x', 'y', 'z'][axis], SUFFIXES[quarters]);
                        cost[f * FRAMES + g] = cost[f * FRAMES + g].min(floor(&token));
                    }
                }
            }
            for k in 0..FRAMES {
                for f in 0..FRAMES {
                    for g in 0..FRAMES {
                        let through = cost[f * FRAMES + k] + cost[k * FRAMES + g];
                        if through < cost[f * FRAMES + g] {
                            cost[f * FRAMES + g] = through;
                        }
                    }
                }
            }
            cost
        });
        // Ways to hold the cube at the start, each with its cost ([frame, cost] pairs; frames as six letters, see Frame::from_text)
        let mut starts = [NEVER; FRAMES];
        for start in value["starts"].as_array()? {
            let frame = Frame::from_text(start[0].as_str()?)?;
            let f = index[&frame] as usize;
            starts[f] = starts[f].min(start[1].as_f64()?);
        }
        // The moves before the step: runs of turns about one axis (from the end), how many stay when nothing joins, and what joining could save
        let runs = value["runs"].as_array()?.iter().map(|run| Some((run[0].as_u64()? as u8, run[1].as_u64()? as usize))).collect::<Option<Vec<_>>>()?;
        let credit: Vec<f64> = value["credit"].as_array()?.iter().map(|each| each.as_f64().unwrap_or(0.0)).collect();
        let kept = (value["kept"].as_u64()? as usize).min(credit.len().saturating_sub(1));
        // Grips with no clean answer yet, each as the frames its answers may be made in, and the sides of the faces to avoid
        let avoid = text("avoid");
        let mut clean = vec![0u64; count];
        let mut holds = 0u64;
        for (bit, hold) in value["holds"].as_array().map_or(&[][..], Vec::as_slice).iter().enumerate().take(64) {
            holds |= 1 << bit;
            let held = hold.as_array()?.iter().map(|frame| Frame::from_text(frame.as_str()?)).collect::<Option<Vec<_>>>()?;
            for (t, &(face, _)) in steps.iter().enumerate() {
                if held.iter().any(|frame| !avoid.as_bytes().contains(&frame.side_of(face))) {
                    clean[t] |= 1 << bit;
                }
            }
        }
        let least = value["least"].as_f64().unwrap_or(0.0).max(0.0);
        Some(SpeedBound { bar, least, turns: count, ways, counts, pairs, halves, closure, starts, axes: steps.iter().map(|&(face, _)| axis_of(face)).collect(), runs, kept, credit, holds, clean })
    }

    // Where a search starts: what holding the cube each way costs, how the joining stands, and the grips a path may still be clean in
    pub(crate) fn root(&self, costs: &mut [f64]) -> (Join, u64) {
        costs.copy_from_slice(&self.starts);
        self.rotate(costs);
        (Join { run: 0, met: false, joining: !self.runs.is_empty(), kept: self.kept, free: false }, self.holds)
    }

    // Rotations between turns: each frame at the cheapest way to get there
    fn rotate(&self, costs: &mut [f64]) {
        let Some(closure) = &self.closure else { return };
        let mut before = [NEVER; FRAMES];
        before.copy_from_slice(costs);
        for g in 0..FRAMES {
            costs[g] = (0..FRAMES).map(|f| before[f] + closure[f * FRAMES + g]).fold(NEVER, f64::min);
        }
    }

    // A path made one turn longer: its least cost in each frame after the turn (into `out`, from `before`, the costs before it, and for slice turns
    // `earlier`, the costs before the turn before it with that turn and whether it joined the moves before), how the joining stands, and the grips it
    // may still be clean in; true when no answer through it can come in under the bar with `remaining` turns after it (and it can't be clean where no
    // answer was yet)
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn child(&self, before: &[f64], earlier: Option<(&[f64], usize, bool)>, join: Join, holds: u64, turn: usize, remaining: u8, out: &mut [f64]) -> (bool, Join, u64) {
        let join = self.joined(join, self.axes[turn]);
        let holds = holds & self.clean[turn];
        let count = self.turns;
        let cost = |paid: f64| if join.free { 0.0 } else { paid };
        out.fill(NEVER);
        // The turn itself or as a wide turn, from each frame the path may be in
        for (f, &so_far) in before.iter().enumerate() {
            if so_far == NEVER {
                continue;
            }
            let cell = f * count + turn;
            for &(paid, g) in &self.ways[cell][..self.counts[cell] as usize] {
                let total = so_far + cost(paid);
                if total < out[g as usize] {
                    out[g as usize] = total;
                }
            }
        }
        // With the turn before it as one slice turn
        if let Some((costs, last, last_free)) = earlier {
            for (f, &so_far) in costs.iter().enumerate() {
                let (paid, g) = self.pairs[(f * count + last) * count + turn];
                if so_far == NEVER || paid == NEVER {
                    continue;
                }
                let total = so_far + if join.free || last_free { 0.0 } else { paid };
                if total < out[g as usize] {
                    out[g as usize] = total;
                }
            }
        }
        self.rotate(out);
        // The least of it all: the path made this far, or half of a slice turn that starts here (the turn after it pays the rest)
        let mut least = out.iter().copied().fold(NEVER, f64::min);
        for (f, &so_far) in before.iter().enumerate() {
            least = least.min(so_far + cost(self.halves[f * count + turn]));
        }
        // What joining the moves before could save: from where it stands, or while it may still go on, from as far as the turns left could take it
        // (they may join too, and then cost nothing)
        let (kept, rest) = if join.joining {
            let run = (join.run + remaining as usize).min(self.runs.len() - 1);
            (join.kept.min(self.runs[run].1), 0.0)
        } else {
            (join.kept, remaining as f64 * self.least)
        };
        let credit = self.credit.get(kept).copied().unwrap_or(0.0);
        (least - credit + rest > self.bar + 1e-6 && holds == 0, join, holds)
    }

    // The joining after a turn about this axis: a turn meets the moves before only on the axis of their last run of turns (or of the run before it,
    // once one turn met that one: it may have cancelled them all), and once one doesn't, the joining is over (as cancelsInto joins them, or more)
    fn joined(&self, join: Join, axis: u8) -> Join {
        if !join.joining {
            return Join { free: false, ..join };
        }
        if self.runs[join.run].0 == axis {
            return Join { met: true, kept: join.kept.min(self.runs[join.run].1), free: true, ..join };
        }
        let next = join.run + 1;
        if join.met && next < self.runs.len() && self.runs[next].0 == axis {
            return Join { run: next, met: true, kept: join.kept.min(self.runs[next].1), free: true, joining: true };
        }
        Join { joining: false, free: false, ..join }
    }
}
