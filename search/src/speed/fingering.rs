// The search over hand positions (fingering.ts's advance and evaluate, costs only), the floors that skip answers without it, and an answer's cheapest
// writing with wide and slice turns. Every sum is made in the same order as in fingering.ts, so the costs come out the same to the last bit

use std::collections::HashMap;

use super::model::{apart_after, read_turn, round, Model, Turn, Way, BACK, HOME_STATE, RESTING, STATES, WRISTS, X};
use super::writings::{writing_plan, Frame, Token, WritingPlan};

// A state the hands can be in before a move: its number, its cost so far, and its wrist state, class and tire (state = (wrists * classes + class) * tires + tire)
#[derive(Clone, Copy)]
struct Open {
    from: usize,
    cost: f64,
    wrists: usize,
    class: usize,
    tire: usize,
}

impl Open {
    // A state with what the search reads from it worked out once, not once per way
    fn new(model: &Model, state: usize, cost: f64) -> Open {
        let hold = state / model.tires;
        Open { from: state, cost, wrists: hold / model.classes, class: hold % model.classes, tire: state % model.tires }
    }
}

// Calls `each` with every state set in these bits, in order
fn walk(bits: &[u64], mut each: impl FnMut(usize)) {
    for (at, &word) in bits.iter().enumerate() {
        let mut left = word;
        while left != 0 {
            each(at * 64 + left.trailing_zeros() as usize);
            left &= left - 1;
        }
    }
}

// Words of bits for this many states
fn words(size: usize) -> usize {
    size.div_ceil(64)
}

// Each hand state's cheapest cost so far (infinite = can't be in it), and which ones were reached as bits, so a move walks only those, in order
struct Costs {
    costs: Vec<f64>,
    bits: Vec<u64>,
}

impl Costs {
    // No state reached yet
    fn new(size: usize) -> Costs {
        Costs { costs: vec![f64::INFINITY; size], bits: vec![0; words(size)] }
    }

    // Keep the cheaper of two ways into a state
    fn offer(&mut self, to: usize, total: f64) {
        if total < self.costs[to] {
            self.costs[to] = total;
            self.bits[to / 64] |= 1 << (to % 64);
        }
    }

    // No state reached again
    fn clear(&mut self) {
        let costs = &mut self.costs;
        walk(&self.bits, |state| costs[state] = f64::INFINITY);
        self.bits.fill(0);
    }

    // The states worth going on from
    fn open(&self, model: &Model, open: &mut Vec<Open>) {
        open.clear();
        walk(&self.bits, |state| open.push(Open::new(model, state, self.costs[state])));
        keep_worthwhile(model, open);
    }
}

// Leaves out of the open states (in order, so the tires of a wrist state and class are together) those no way on can come through: two of them differ only by which fingers are tired for the next move, so the cheaper one can pay `tired` at most, one with no tired fingers nothing, and everything after that is the same. Only states that are strictly worse go, so the answer and its ties stay what they are with all of them (TypeScript's search keeps them all)
fn keep_worthwhile(model: &Model, open: &mut Vec<Open>) {
    let tires = model.tires;
    let (mut kept, mut at) = (0, 0);
    while at < open.len() {
        let hold = open[at].from / tires;
        let (mut end, mut least) = (at, f64::INFINITY);
        while end < open.len() && open[end].from / tires == hold {
            least = least.min(open[end].cost);
            end += 1;
        }
        // Tire 0 comes first among them when it's there
        let bar = if open[at].tire == 0 { open[at].cost.min(least + model.tired) } else { least + model.tired };
        for index in at..end {
            if open[index].cost <= bar + 1e-9 {
                open[kept] = open[index];
                kept += 1;
            }
        }
        at = end;
    }
    open.truncate(kept);
}

// Room for the states a move walks (more are made room for if it takes more)
const ROOM: usize = 256;

// What a way's finger regrips cost after a move of class `last` (0 when the hand regripped since): one when the finger first has to reach the turn, and one when the move before was made by
// the same hand and left out of place a finger this one needs: a finger that makes it, or the last one holding the cube from behind
fn finger_cost(model: &Model, last: usize, way: &Way) -> f64 {
    let reach = if way.reach { model.finger_regrip } else { 0.0 };
    // Class 0 (no finger out of place) belongs to no hand
    if model.class_side[last] != way.side {
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

// What's left of a state once its regrips are made before a move: the cheapest such state (the first one on a tie), with what they cost, and the class and tire left (a hand that regrips rests its fingers, so states that differ only by those are the same now)
#[derive(Clone, Copy)]
struct Ready {
    from: usize,
    base: f64,
    class: usize,
    tire: usize,
}

// One move of the search: from each state the hands can be in before it (`open`, with their costs so far), every way into a state after it, each handed to
// `offer` as (state after, cost so far, state before). `first`, `free`, `again`, `opposite` and `flow` as in fingering.ts's advance; `ready` is room for what's left of the states before each wrist state, which comes to the same as trying each way from every state and keeping the first of the cheapest
#[allow(clippy::too_many_arguments)]
fn advance(model: &Model, turn: Option<Turn>, open: &[Open], first: bool, free: bool, again: f64, opposite: f64, flow: f64, ready: &mut Vec<Ready>, mut offer: impl FnMut(usize, f64, usize)) {
    let (tires, width) = (model.tires, model.width);
    if let Some(turn) = turn.filter(Turn::rotation) {
        // A rotation: both hands let go and take the cube again at home (free while the solve hasn't started), which rests their fingers too; a half turn costs more
        let cost = if free { 0.0 } else if turn.quarters == 2 { model.rotation_half } else { model.rotation_quarter };
        for &Open { from, cost: before, .. } in open.iter() {
            offer(HOME_STATE * width, before + cost, from);
        }
        // A tilt: an x turn the wrists make together without letting go, where both can go that way (x takes both a step up, x' a step down, x2 two steps)
        if turn.layer == X {
            let steps: &[isize] = if turn.quarters == 2 { &[2, -2] } else if turn.quarters == 1 { &[1] } else { &[-1] };
            for &step in steps {
                for &Open { from, cost, wrists, .. } in open.iter() {
                    let (right, left) = ((wrists / WRISTS) as isize + step, (wrists % WRISTS) as isize + step);
                    if right.min(left) < 0 || right.max(left) >= WRISTS as isize {
                        continue;
                    }
                    // Both wrists turn with the whole cube in them, so it costs wherever it leads, back home too
                    let tilt = model.tilt * step.abs() as f64;
                    offer((right as usize * WRISTS + left as usize) * width, cost + tilt, from);
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
        ready.clear();
        for &Open { from, cost, wrists, class, tire } in open.iter() {
            let pair = wrists * STATES + via;
            let moved = model.hands_moved[pair];
            // Before the first turn the hands leave home: the first one cheaply, a second one at the full price (see Model::regrips_first)
            let regrips = if first { model.regrips_first[pair] } else { model.regrips_later[pair] };
            // A hand that regrips first breaks the rhythm, so the move saves nothing then
            let kept = if moved > 0 { 0.0 } else { flow };
            let base = cost + regrips + again - kept;
            // A hand that regrips rests its fingers: they're neither out of place nor tired after it
            let regripped = model.regripped[pair];
            let class = if class != 0 && regripped & (1 << model.class_side[class]) != 0 { 0 } else { class };
            let tire = if tire != 0 && regripped & (1 << model.tire_side[tire]) != 0 { 0 } else { tire };
            match ready.iter_mut().find(|same| same.class == class && same.tire == tire) {
                Some(same) => {
                    if base < same.base {
                        same.base = base;
                        same.from = from;
                    }
                }
                None => ready.push(Ready { from, base, class, tire }),
            }
        }
        // In the order the states come in, so a tie goes to the first of them
        ready.sort_unstable_by_key(|each| each.from);
        for &Ready { from, base, class, tire } in ready.iter() {
            // The fingers the move before made are tired for the next move
            let tiring = model.class_tire[class];
            for way in ways {
                let fingers = finger_cost(model, class, way);
                // A finger that made the move before the one before pays; a push is the opposite motion, and a trick with the thumb in it is the wrist's or the holding finger's work
                let tired = if model.tire_side[tire] == way.side && way.fingers & model.tire_fingers[tire] != 0 && way.fingers & RESTING == 0 { model.tired } else { 0.0 };
                // An open opposite layer is the same strain as an awkward or a twisted grip (see Way): only the bigger of the two is paid
                let opened = (opposite - way.awkward - way.twisted).max(0.0);
                offer(way.to * tires + tiring, base + way.cost + fingers + tired + way.awkward + way.twisted + opened, from);
            }
        }
    }
    // No trick makes it from any state (E2, S2, a move the model can't read): it costs `other` and leaves the hands where they are
    if !made {
        for &Open { from, cost, wrists, class, .. } in open.iter() {
            let twisted = if model.twisted_state[wrists] { model.twisted } else { 0.0 };
            let awkward = if twisted == 0.0 && model.both_away[wrists] { model.awkward } else { 0.0 };
            // An open opposite layer only adds what the grip's surcharge doesn't already charge
            let opened = (opposite - awkward - twisted).max(0.0);
            offer(wrists * width + model.class_tire[class], cost + model.other + awkward + twisted + opened + again, from);
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
    let width = model.width;
    let size = STATES * width;
    // Cheapest cost of each state after the moves so far (infinite = can't be in it): both hands start at home with every finger in place
    let mut costs = Costs::new(size);
    costs.offer(HOME_STATE * width, 0.0);
    let mut next = Costs::new(size);
    let mut open = Vec::with_capacity(ROOM);
    let mut ready = Vec::with_capacity(ROOM);
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
        costs.open(model, &mut open);
        next.clear();
        advance(model, turn, &open, first, first, again + leave, opened, flow, &mut ready, |to, total, _| next.offer(to, total));
        // Anything but a rotation is a turn (a move the model can't read too)
        if !turn.is_some_and(|turn| turn.rotation()) {
            started = true;
        }
        std::mem::swap(&mut costs, &mut next);
        last = turn;
    }
    // Each end state's cost with its hands brought back home; the cheapest one is where the sequence ends
    let mut total = f64::INFINITY;
    walk(&costs.bits, |end| total = total.min(costs.costs[end] + model.last_regrip * model.hands_moved[end / width * STATES + HOME_STATE] as f64));
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

// A hand state a place has reached: its cheapest cost so far, and how it was reached (the place before as its level and number, the state there and the token made)
struct Reached {
    cost: f64,
    from: Option<(usize, usize)>,
    state: usize,
    token: Token,
}

// One place in an answer being written: the frame the cube is held in, the layers turned so far that cost more to turn again, the rhythm the move made last
// leaves, which of R and L are off the middle layer, the hand states reached (a place reaches few of them: `slots` says where each one is in `reached`, plus
// one, and `bits` which ones they are). A place a writing starts from also says whether its first turn is a solve's first (regrips cost less), and for a
// start other than after `before`, which of the other starts it is
struct Place {
    frame: Frame,
    turned: u32,
    rhythm: u8,
    apart: u8,
    slots: Vec<u16>,
    bits: Vec<u64>,
    reached: Vec<Reached>,
    first: bool,
    start: Option<usize>,
}

impl Place {
    // Keep the cheaper of two ways into a hand state
    fn offer(&mut self, to: usize, way: Reached) {
        match self.slots[to] {
            0 => {
                self.reached.push(way);
                self.slots[to] = self.reached.len() as u16;
                self.bits[to / 64] |= 1 << (to % 64);
            }
            slot => {
                let kept = &mut self.reached[slot as usize - 1];
                if way.cost < kept.cost {
                    *kept = way;
                }
            }
        }
    }

    // A reached hand state
    fn at(&self, state: usize) -> &Reached {
        &self.reached[self.slots[state] as usize - 1]
    }

    // Start over from these hand states, reached by nothing before them
    fn start_from(&mut self, costs: &Costs) {
        self.slots.fill(0);
        self.bits.fill(0);
        self.reached.clear();
        walk(&costs.bits, |state| self.offer(state, Reached { cost: costs.costs[state], from: None, state: 0, token: Token::default() }));
    }

    // The states worth going on from
    fn open(&self, model: &Model, open: &mut Vec<Open>) {
        open.clear();
        walk(&self.bits, |state| open.push(Open::new(model, state, self.at(state).cost)));
        keep_worthwhile(model, open);
    }
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
            places.push(Place { frame, turned, rhythm, apart, slots: vec![0; size], bits: vec![0; words(size)], reached: Vec::new(), first: false, start: None });
            places.len() - 1
        })
    }
}

// The least the rest of an answer can cost from a place in a frame, whatever the hands do (fingering.ts's restOf in writingSearch): the cheapest way on
// to the end with each token at its floor less what keeping the rhythm could save it, so a frame the cube has to be brought round from pays for the
// wide turns that do it. Worked out once per place and frame
fn rest_floor(model: &Model, plan: &mut WritingPlan, floors: &mut HashMap<(usize, Frame), f64>, at: usize, frame: Frame) -> f64 {
    if at == plan.length() {
        return 0.0;
    }
    if let Some(&floor) = floors.get(&(at, frame)) {
        return floor;
    }
    let options: Vec<(Option<Turn>, usize, Frame)> = plan.options_at(at, frame).iter().map(|option| (read_turn(option.token.as_str()), option.covers, option.frame)).collect();
    let mut floor = f64::INFINITY;
    for (turn, covers, next) in options {
        let Some(turn) = turn else { continue };
        floor = floor.min(model.turn_floor(turn) - model.flow[turn.layer].unwrap_or(0.0) + rest_floor(model, plan, floors, at + covers, next));
    }
    floors.insert((at, frame), floor);
    floor
}

// What a writing search gave: the cheapest writing, its cost and for a writing that starts held another way the rotations made in place of `before`
// (None: none was left under the limit), and which other limits would have searched the very same way, so given the very same answer: the highest
// lower bound among the places it went on from, and the lowest among those it gave up on
pub(crate) struct Searched {
    pub found: Option<(String, f64, Option<String>)>,
    pub kept: f64,
    pub pruned: f64,
    pub ends: Vec<Option<(String, f64, Option<String>)>>,
}

// The cheapest way for the hands to write an answer's face turns when some may be made as wide turns about the `wide` axes or slice turns about the
// `slice` axes (letters of "xyz"), the cube ending held as its grip names it (fingering.ts's cheapestWriting): its text and its cost with `before` (the
// grip rotation) or with one of the `starts` (fingering.ts's writingStarts, each "frame rotations", comma-separated), and the cheapest that ends in each
// of the `ends` frames (comma-separated: fingering.ts's writingSearch); None when the plain writing is the only one. Writings that can't cost `limit`
// or less are given up on the way, and none is found when none is left
#[allow(clippy::too_many_arguments)]
pub(crate) fn cheapest_writing(model: &Model, moves: &str, wide: &str, slice: &str, fresh: bool, before: &str, limit: f64, starts: &str, ends: &str) -> Option<Searched> {
    let turns: Vec<&str> = moves.split_whitespace().collect();
    // The other starts: the frame the cube is held in, and the rotations the hands make to hold it so
    let starts: Vec<(Frame, &str)> = starts.split(',').filter(|start| !start.is_empty()).filter_map(|start| Some((Frame::from_text(start.get(..6)?)?, start[6..].trim()))).collect();
    let frames: Vec<Frame> = starts.iter().map(|&(frame, _)| frame).collect();
    // The frames it may end in: held as its grip names it, then the others
    let ends: Vec<Frame> = ends.split(',').filter_map(Frame::from_text).collect();
    let mut plan = writing_plan(&turns, wide, slice, &frames, &ends)?;
    let ends: Vec<Frame> = std::iter::once(plan.home()).chain(ends).collect();
    // The least the rest of the answer can cost from each place and frame, whatever the hands do (see rest_floor)
    let mut rest = HashMap::new();
    let width = model.width;
    let size = STATES * width;
    let mut open = Vec::with_capacity(ROOM);
    let mut ready = Vec::with_capacity(ROOM);
    // A layer turned again pays only for the layers the model lists (the others aren't counted, so places don't split on them)
    let again_bit = |turn: Option<Turn>| turn.filter(|turn| model.again[turn.layer].is_some()).map_or(0, bit);
    let again_cost = |turned: u32, turn: Option<Turn>| match turn {
        Some(turn) if turned & again_bit(Some(turn)) != 0 => model.again[turn.layer].unwrap_or(0.0),
        _ => 0.0,
    };
    // Moves made first, as the cost makes them: both hands start at home with every finger in place. Gives each hand state's cost after them, whether a
    // turn was made, the layers turned (that cost more to turn again), the move made last and which of R and L are off the middle layer
    let mut made_first = |text: &str| {
        let mut costs = Costs::new(size);
        costs.offer(HOME_STATE * width, 0.0);
        let mut next = Costs::new(size);
        let mut started = false;
        let mut turned = 0;
        let mut last: Option<Turn> = None;
        let mut apart = 0;
        for token in text.split_whitespace() {
            let turn = read_turn(token);
            let rotation = turn.is_some_and(|turn| turn.rotation());
            let bits = if rotation { 0 } else { again_bit(turn) };
            next.clear();
            let first = fresh && !started;
            let again = (if rotation { 0.0 } else { again_cost(turned, turn) }) + model.leave_after(last, turn);
            costs.open(model, &mut open);
            advance(model, turn, &open, first, first, again, model.open_cost(turn, apart), model.flow_after(last, turn), &mut ready, |to, total, _| next.offer(to, total));
            if !rotation {
                started = true;
            }
            // A rotation starts the layers turned again over
            if rotation {
                turned = 0;
            }
            turned |= bits;
            std::mem::swap(&mut costs, &mut next);
            last = turn;
            apart = apart_after(turn, apart);
        }
        (costs, started, turned, last, apart)
    };
    // Places by how many of the answer's turns are made so far, then by frame, layers turned, the rhythm the last move leaves and which of R and L are off
    let mut levels: Vec<Level> = (0..=turns.len()).map(|_| Level::default()).collect();
    // Where the writing starts: after `before`, held as the grip names the cube, then from each other start the rest of the answer can end right from
    for (start, (frame, rotations)) in std::iter::once((None, (plan.home(), before))).chain(starts.iter().enumerate().map(|(index, &start)| (Some(index), start))) {
        if start.is_some() && plan.options_at(0, frame).is_empty() {
            continue;
        }
        let (costs, started, turned, last, apart) = made_first(rotations);
        let number = levels[0].place_on(frame, turned, model.rhythm_of(last), apart, size);
        let place = &mut levels[0].places[number];
        place.start_from(&costs);
        place.first = fresh && !started;
        place.start = start;
    }
    // The highest lower bound of a place gone on from, and the lowest of a place given up on
    let (mut kept, mut pruned) = (f64::NEG_INFINITY, f64::INFINITY);
    for at in 0..turns.len() {
        // Each way to go on from a place leads to a place further on
        let (done, later) = levels.split_at_mut(at + 1);
        for (number, place) in done[at].places.iter().enumerate() {
            // Regrips before a solve's first turn cost less
            let first = at == 0 && place.first;
            // No way on from here can come in under the limit: its cheapest hand state plus the least the turns left cost is over it
            let least = place.reached.iter().map(|way| way.cost).fold(f64::INFINITY, f64::min) + rest_floor(model, &mut plan, &mut rest, at, place.frame);
            if limit < f64::INFINITY && least > limit + 1e-6 {
                pruned = pruned.min(least);
                continue;
            }
            kept = kept.max(least);
            place.open(model, &mut open);
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
                advance(model, turn, &open, first, false, again_cost(place.turned, turn) + leave, model.open_cost(turn, place.apart), flow, &mut ready, |to, total, from| {
                    target.offer(to, Reached { cost: total, from: Some((at, number)), state: from, token: option.token });
                });
            }
        }
    }
    // The cheapest end state with its hands brought back home, over the places the answer can end in, for each frame it may end in (held as its grip
    // names it first, then the other ends); the first one on a tie
    let mut bests: Vec<Option<(usize, usize, f64)>> = vec![None; ends.len()];
    for (number, place) in levels[turns.len()].places.iter().enumerate() {
        let Some(end) = ends.iter().position(|&frame| frame == place.frame) else { continue };
        walk(&place.bits, |state| {
            let total = place.at(state).cost + model.last_regrip * model.hands_moved[state / width * STATES + HOME_STATE] as f64;
            if bests[end].is_none_or(|(_, _, best)| round(total) < round(best)) {
                bests[end] = Some((number, state, total));
            }
        });
    }
    // Each one walked back, one token per place, to the place it started from: its start is left out when it started held as it ends
    let mut writings = bests.iter().zip(&ends).map(|(best, &end)| {
        best.filter(|(_, _, total)| *total < f64::INFINITY).map(|(mut number, mut state, total)| {
            let mut tokens = Vec::new();
            let mut level = turns.len();
            while let Some((back_level, back_number)) = levels[level].places[number].at(state).from {
                let way = levels[level].places[number].at(state);
                tokens.push(way.token.as_str().to_owned());
                (level, number, state) = (back_level, back_number, way.state);
            }
            tokens.reverse();
            let first = &levels[level].places[number];
            let start = (first.frame != end).then(|| first.start.map_or(before, |index| starts[index].1).to_owned());
            (tokens.join(" "), round(total), start)
        })
    });
    let found = writings.next().flatten();
    Some(Searched { found, kept, pruned, ends: writings.collect() })
}
