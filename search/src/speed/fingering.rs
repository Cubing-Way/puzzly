// The search over hand positions (fingering.ts's advance and evaluate, costs only), the floors that skip answers without it, and an answer's cheapest
// writing with wide and slice turns. Every sum is made in the same order as in fingering.ts, so the costs come out the same to the last bit

use std::collections::HashMap;

use super::model::{apart_after, read_turn, round, Model, Turn, Way, BACK, HOME_STATE, STATES, WRISTS, X};
use super::writings::{writing_plan, Frame, Token};

// A state the hands can be in before a move: its number, and its wrist state and class (state = wrists * classes + class)
#[derive(Clone, Copy)]
struct Open {
    from: usize,
    wrists: usize,
    class: usize,
}

// What a way's finger regrips cost after a move of class `last`: one when the finger first has to reach the turn, and one when the move before was made by
// the same hand (which hasn't regripped since) and left out of place a finger this one needs: a finger that makes it, or the last one holding the cube from behind
fn finger_cost(model: &Model, last: usize, way: &Way, regripped: bool) -> f64 {
    let reach = if way.reach { model.finger_regrip } else { 0.0 };
    // Class 0 (no finger out of place) belongs to no hand
    if regripped || model.class_side[last] != way.side {
        return reach;
    }
    // Fingers the move before left out of place, and the back fingers this move leaves holding the cube
    let out = model.class_out[last];
    let holding = BACK & !way.fingers;
    let back = (!way.reach && way.fingers & out != 0) || (holding != 0 && holding & !out == 0);
    if back {
        reach + model.finger_regrip
    } else {
        reach
    }
}

// One move of the search: from each state the hands can be in before it (`before`: their costs so far), every way into a state after it, each handed to
// `offer` as (state after, cost so far, state before). `first`, `free`, `again`, `opposite` and `flow` as in fingering.ts's advance; `open` is room
// for the states the hands can be in before the move, each with its wrist state and class
#[allow(clippy::too_many_arguments)]
fn advance(model: &Model, turn: Option<Turn>, before: &[f64], first: bool, free: bool, again: f64, opposite: f64, flow: f64, open: &mut Vec<Open>, mut offer: impl FnMut(usize, f64, usize)) {
    let classes = model.classes;
    // States the hands can be in before this move (wrists and class worked out once each, not once per way)
    open.clear();
    open.extend((0..before.len()).filter(|&state| before[state] < f64::INFINITY).map(|state| Open { from: state, wrists: state / classes, class: state % classes }));
    if let Some(turn) = turn.filter(Turn::rotation) {
        // A rotation: both hands let go and take the cube again at home (free while the solve hasn't started); a half turn costs more
        let cost = if free { 0.0 } else if turn.quarters == 2 { model.rotation_half } else { model.rotation_quarter };
        for &Open { from, .. } in open.iter() {
            offer(HOME_STATE * classes, before[from] + cost, from);
        }
        // A tilt: an x turn the wrists make together without letting go, where both can go that way (x takes both a step up, x' a step down, x2 two steps)
        if turn.layer == X {
            let steps: &[isize] = if turn.quarters == 2 { &[2, -2] } else if turn.quarters == 1 { &[1] } else { &[-1] };
            for &step in steps {
                for &Open { from, wrists, .. } in open.iter() {
                    let (right, left) = ((wrists / WRISTS) as isize + step, (wrists % WRISTS) as isize + step);
                    if right.min(left) < 0 || right.max(left) >= WRISTS as isize {
                        continue;
                    }
                    // Both wrists turn with the whole cube in them, so it costs wherever it leads, back home too
                    let tilt = model.tilt * step.abs() as f64;
                    offer((right as usize * WRISTS + left as usize) * classes, before[from] + tilt, from);
                }
            }
        }
        return;
    }
    // A turn: from each open state, regrip to any wrist state (or stay) and make the turn any way that state allows
    let mut made = false;
    let each: &[Vec<Way>] = turn.map_or(&[], |turn| model.ways_of(turn));
    for (via, ways) in each.iter().enumerate() {
        if ways.is_empty() {
            continue;
        }
        made = true;
        for &Open { from, wrists, class } in open.iter() {
            let pair = wrists * STATES + via;
            let moved = model.hands_moved[pair];
            // Before the first turn the hands leave home: the first one cheaply, a second one at the full price (see Model::regrips_first)
            let regrips = if first { model.regrips_first[pair] } else { model.regrips_later[pair] };
            // A hand that regrips first breaks the rhythm, so the move saves nothing then
            let kept = if moved > 0 { 0.0 } else { flow };
            let base = before[from] + regrips + again - kept;
            let regripped = model.regripped[pair];
            for way in ways {
                let fingers = finger_cost(model, class, way, regripped & (1 << way.side) != 0);
                // An open opposite layer is the same strain as an awkward or a twisted grip (see Way): only the bigger of the two is paid
                let opened = (opposite - way.awkward - way.twisted).max(0.0);
                offer(way.to, base + way.cost + fingers + way.awkward + way.twisted + opened, from);
            }
        }
    }
    // No trick makes it from any state (E2, S2, a move the model can't read): it costs `other` and leaves the hands where they are
    if !made {
        for &Open { from, wrists, .. } in open.iter() {
            let twisted = if model.twisted_state[wrists] { model.twisted } else { 0.0 };
            let awkward = if twisted == 0.0 && model.both_away[wrists] { model.awkward } else { 0.0 };
            // An open opposite layer only adds what the grip's surcharge doesn't already charge
            let opened = (opposite - awkward - twisted).max(0.0);
            offer(wrists * classes, before[from] + model.other + awkward + twisted + opened + again, from);
        }
    }
}

// The layers turned so far as bits of LAYERS' places, for what turning one again costs
fn bit(turn: Turn) -> u32 {
    1 << turn.layer
}

// A move sequence's speed cost (fingering.ts's speedCost): the cheapest way for the hands to make it from home and back. `fresh` = nothing was turned
// before (rotations before the first turn are free), `starts` = where each step starts in a joined solve (the counts that belong to one step start over there)
pub(crate) fn speed_cost(model: &Model, moves: &str, fresh: bool, starts: &[u32]) -> f64 {
    let classes = model.classes;
    let size = STATES * classes;
    // Cheapest cost of each state after the moves so far (infinite = can't be in it): both hands start at home with every finger in place
    let mut costs = vec![f64::INFINITY; size];
    costs[HOME_STATE * classes] = 0.0;
    let mut next = vec![f64::INFINITY; size];
    let mut open = Vec::with_capacity(size);
    // Layers turned since the step's start or the last rotation, which of R and L are off the middle layer, the move before, and whether a turn was made yet
    let mut turned = 0;
    let mut apart = 0;
    let mut last: Option<Turn> = None;
    let mut started = false;
    for (index, token) in moves.split_whitespace().enumerate() {
        let turn = read_turn(token);
        let step_start = starts.contains(&(index as u32));
        // What the move pays for turning a layer the sequence turned before (counted from the step's start or the last rotation)
        if step_start || turn.is_some_and(|turn| turn.rotation()) {
            turned = 0;
        }
        let again = match turn {
            Some(turn) if !turn.rotation() => {
                let again = if turned & bit(turn) != 0 { model.again[turn.layer].unwrap_or(0.0) } else { 0.0 };
                turned |= bit(turn);
                again
            }
            _ => 0.0,
        };
        // What it saves by keeping the rhythm of the move before, and what it pays for leaving it
        let flow = model.flow_after(last, turn);
        let leave = model.leave_after(last, turn);
        // What a turn of R or L pays for the opposite layer being off, with nothing off at a step's start
        if step_start {
            apart = 0;
        }
        let opened = model.open_cost(turn, apart);
        apart = apart_after(turn, apart);
        // Before the first turn of a solve a regrip costs less and a rotation is free; keep the cheaper of two ways into a state
        let first = fresh && !started;
        next.fill(f64::INFINITY);
        advance(model, turn, &costs, first, first, again + leave, opened, flow, &mut open, |to, total, _| {
            if total < next[to] {
                next[to] = total;
            }
        });
        // Anything but a rotation is a turn (a move the model can't read too)
        if !turn.is_some_and(|turn| turn.rotation()) {
            started = true;
        }
        std::mem::swap(&mut costs, &mut next);
        last = turn;
    }
    // Each end state's cost with its hands brought back home; the cheapest one is where the sequence ends
    let total = (0..size).map(|end| costs[end] + model.last_regrip * model.hands_moved[end / classes * STATES + HOME_STATE] as f64).fold(f64::INFINITY, f64::min);
    round(total)
}

// A lower bound of a move sequence's speed cost from its text alone (fingering.ts's speedFloor): each turn at its cheapest trick, with everything it pays or
// saves whoever makes it, and no regrip, awkward grip or way home at all
pub(crate) fn speed_floor(model: &Model, moves: &str, fresh: bool) -> f64 {
    let mut turned = 0;
    let mut total = 0.0;
    let mut started = false;
    let mut last: Option<Turn> = None;
    let mut apart = 0;
    for token in moves.split_whitespace() {
        let turn = read_turn(token);
        if let Some(rotation) = turn.filter(Turn::rotation) {
            // A rotation: free before a solve's first turn, otherwise a tilt at best (x) or a rotation (a half turn costs more)
            let cost = if rotation.quarters == 2 { model.rotation_half } else { model.rotation_quarter };
            if !(fresh && !started) {
                total += if rotation.layer == X { cost.min(model.tilt * if rotation.quarters == 2 { 2.0 } else { 1.0 }) } else { cost };
            }
            // It starts the layers turned again and the open layers over, as the cost does
            turned = 0;
            apart = apart_after(turn, apart);
            last = turn;
            continue;
        }
        started = true;
        if let Some(turn) = turn {
            // What the turn pays for a layer turned again, for leaving the rhythm and for an open opposite layer, less what it saves by keeping the rhythm
            let again = if turned & bit(turn) != 0 { model.again[turn.layer].unwrap_or(0.0) } else { 0.0 };
            turned |= bit(turn);
            total += model.turn_floor(turn) + again + model.leave_after(last, Some(turn)) + model.open_cost(Some(turn), apart) - model.flow_after(last, Some(turn));
            apart = apart_after(Some(turn), apart);
        } else {
            total += model.other;
        }
        last = turn;
    }
    total
}

// A lower bound of what cheapest_writing can give for an answer (plain face turns) after its grip rotation (fingering.ts's writingFloor)
pub(crate) fn writing_floor(model: &Model, moves: &str, fresh: bool, before: &str) -> f64 {
    let mut total = speed_floor(model, before, fresh);
    for token in moves.split_whitespace() {
        total += if token.ends_with('2') { model.any_half } else { model.any_quarter };
    }
    total
}

// One place in an answer being written: the frame the cube is held in, the layers turned so far that cost more to turn again, the rhythm the move made last
// leaves, which of R and L are off the middle layer, each hand state's cheapest cost so far, and how each state was reached (the place before as its
// level and number, the state there and the token made)
struct Place {
    frame: Frame,
    turned: u32,
    rhythm: u8,
    apart: u8,
    costs: Vec<f64>,
    from: Vec<Option<(usize, usize)>>,
    state: Vec<usize>,
    token: Vec<Token>,
}

// The places with the same number of the answer's turns made, in the order they were first reached, found by their key
#[derive(Default)]
struct Level {
    places: Vec<Place>,
    keys: HashMap<u64, usize>,
}

impl Level {
    // The place for these on this level (made on first use), as its number
    fn place_on(&mut self, frame: Frame, turned: u32, rhythm: u8, apart: u8, size: usize) -> usize {
        let key = (frame.code() as u64) << 32 | (turned as u64) << 8 | (rhythm as u64) << 4 | apart as u64;
        let places = &mut self.places;
        *self.keys.entry(key).or_insert_with(|| {
            places.push(Place { frame, turned, rhythm, apart, costs: vec![f64::INFINITY; size], from: vec![None; size], state: vec![0; size], token: vec![Token::default(); size] });
            places.len() - 1
        })
    }
}

// What a writing search gave: the cheapest writing and its cost (None: none was left under the limit), and which other limits would have searched the
// very same way, so given the very same answer: the highest lower bound among the places it went on from, and the lowest among those it gave up on
pub(crate) struct Searched {
    pub found: Option<(String, f64)>,
    pub kept: f64,
    pub pruned: f64,
}

// The cheapest way for the hands to write an answer's face turns when some may be made as wide turns about the `wide` axes or slice turns about the
// `slice` axes (letters of "xyz"), the cube ending held as it started (fingering.ts's cheapestWriting): its text and its cost with `before` (the grip
// rotation); None when the plain writing is the only one. Writings that can't cost `limit` or less are given up on the way, and none is found when none
// is left
#[allow(clippy::too_many_arguments)]
pub(crate) fn cheapest_writing(model: &Model, moves: &str, wide: &str, slice: &str, fresh: bool, before: &str, limit: f64) -> Option<Searched> {
    let turns: Vec<&str> = moves.split_whitespace().collect();
    let mut plan = writing_plan(&turns, wide, slice)?;
    // The least the turns from each place on can cost, whatever the writing
    let mut rest = vec![0.0; turns.len() + 1];
    for at in (0..turns.len()).rev() {
        rest[at] = rest[at + 1] + if turns[at].ends_with('2') { model.any_half } else { model.any_quarter };
    }
    let classes = model.classes;
    let size = STATES * classes;
    let mut open = Vec::with_capacity(size);
    // A layer turned again pays only for the layers the model lists (the others aren't counted, so places don't split on them)
    let again_bit = |turn: Option<Turn>| turn.filter(|turn| model.again[turn.layer].is_some()).map_or(0, bit);
    let again_cost = |turned: u32, turn: Option<Turn>| match turn {
        Some(turn) if turned & again_bit(Some(turn)) != 0 => model.again[turn.layer].unwrap_or(0.0),
        _ => 0.0,
    };
    // The moves made first, as the cost makes them: both hands start at home with every finger in place
    let mut costs = vec![f64::INFINITY; size];
    costs[HOME_STATE * classes] = 0.0;
    let mut started = false;
    let mut turned = 0;
    let mut last: Option<Turn> = None;
    let mut apart = 0;
    for token in before.split_whitespace() {
        let turn = read_turn(token);
        let rotation = turn.is_some_and(|turn| turn.rotation());
        let bits = if rotation { 0 } else { again_bit(turn) };
        let mut next = vec![f64::INFINITY; size];
        let first = fresh && !started;
        let again = (if rotation { 0.0 } else { again_cost(turned, turn) }) + model.leave_after(last, turn);
        advance(model, turn, &costs, first, first, again, model.open_cost(turn, apart), model.flow_after(last, turn), &mut open, |to, total, _| {
            if total < next[to] {
                next[to] = total;
            }
        });
        if !rotation {
            started = true;
        }
        // A rotation starts the layers turned again over
        if rotation {
            turned = 0;
        }
        turned |= bits;
        costs = next;
        last = turn;
        apart = apart_after(turn, apart);
    }
    // Places by how many of the answer's turns are made so far, then by frame, layers turned, the rhythm the last move leaves and which of R and L are off
    let mut levels: Vec<Level> = (0..=turns.len()).map(|_| Level::default()).collect();
    let home = levels[0].place_on(plan.home(), turned, model.rhythm_of(last), apart, size);
    levels[0].places[home].costs = costs;
    // The highest lower bound of a place gone on from, and the lowest of a place given up on
    let (mut kept, mut pruned) = (f64::NEG_INFINITY, f64::INFINITY);
    for at in 0..turns.len() {
        // Regrips before a solve's first turn cost less
        let first = fresh && !started && at == 0;
        // Each way to go on from a place leads to a place further on
        let (done, later) = levels.split_at_mut(at + 1);
        for (number, place) in done[at].places.iter().enumerate() {
            // No way on from here can come in under the limit: its cheapest hand state plus the least the turns left cost is over it
            let least = place.costs.iter().copied().fold(f64::INFINITY, f64::min) + rest[at];
            if limit < f64::INFINITY && least > limit + 1e-6 {
                pruned = pruned.min(least);
                continue;
            }
            kept = kept.max(least);
            for option in plan.options_at(at, place.frame) {
                let turn = read_turn(option.token.as_str());
                let after = place.turned | again_bit(turn);
                let level = &mut later[option.covers - 1];
                let next = level.place_on(option.frame, after, model.rhythm_of(turn), apart_after(turn, place.apart), size);
                // A turn after a move that flows keeps its rhythm when its own layer flows too; one on a slow layer leaves it, unless the move before was on one too
                let leave = match turn {
                    Some(turn) if place.rhythm != 2 => model.leave[turn.layer].unwrap_or(0.0),
                    _ => 0.0,
                };
                let flow = match turn {
                    Some(turn) if place.rhythm == 1 => model.flow[turn.layer].unwrap_or(0.0),
                    _ => 0.0,
                };
                // The token made from this place into the next one, which keeps the cheapest way into each of its states
                let target = &mut level.places[next];
                advance(model, turn, &place.costs, first, false, again_cost(place.turned, turn) + leave, model.open_cost(turn, place.apart), flow, &mut open, |to, total, from| {
                    if total < target.costs[to] {
                        target.costs[to] = total;
                        target.from[to] = Some((at, number));
                        target.state[to] = from;
                        target.token[to] = option.token;
                    }
                });
            }
        }
    }
    // The cheapest end state with its hands brought back home, over the places the answer can end in (all held as it started); the first one on a tie
    let mut best: Option<(usize, usize, f64)> = None;
    for (number, place) in levels[turns.len()].places.iter().enumerate() {
        for state in 0..size {
            let total = place.costs[state] + model.last_regrip * model.hands_moved[state / classes * STATES + HOME_STATE] as f64;
            if best.is_none_or(|(_, _, best)| round(total) < round(best)) {
                best = Some((number, state, total));
            }
        }
    }
    let found = best.filter(|(_, _, total)| *total < f64::INFINITY).map(|(mut number, mut state, total)| {
        // Walk back from it, one token per place
        let mut tokens = Vec::new();
        let mut level = turns.len();
        while let Some((back_level, back_number)) = levels[level].places[number].from[state] {
            let place = &levels[level].places[number];
            tokens.push(place.token[state].as_str().to_owned());
            (level, number, state) = (back_level, back_number, place.state[state]);
        }
        tokens.reverse();
        (tokens.join(" "), round(total))
    });
    Some(Searched { found, kept, pruned })
}
