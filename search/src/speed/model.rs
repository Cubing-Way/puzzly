// The hand map (hands.ts's HandModel) read from its JSON, with what the search needs worked out once: each turn's ways from each wrist state and its floor

use std::collections::HashMap;

use serde_json::{Map, Value};

// Wrist positions in the order a wrist turn goes through them (hands.ts's WRISTS: down, home, up), and home's place
pub(crate) const WRISTS: usize = 3;
const HOME: usize = 1;
// Wrist states: both wrists as one number, right * 3 + left
pub(crate) const STATES: usize = WRISTS * WRISTS;
pub(crate) const HOME_STATE: usize = HOME * WRISTS + HOME;

// Fingers as bits, so sets of them can be compared
const FINGERS: [&str; 5] = ["thumb", "index", "middle", "ring", "pinky"];
const THUMB: u32 = 1;
// The fingers that hold the cube from behind while the others turn (middle and ring)
pub(crate) const BACK: u32 = 4 | 8;

// Layers the model reads, each one's place in the per-layer lists: faces, slices, then the whole-cube rotations
const LAYERS: &[u8; 12] = b"UDLRFBMESxyz";
pub(crate) const L: usize = 2;
pub(crate) const R: usize = 3;
pub(crate) const X: usize = 9;
const FACES: [usize; 6] = [0, 1, 2, 3, 4, 5];
const SLICES: [usize; 3] = [6, 7, 8];

// What follows a turn's letter, by its quarter turns clockwise (1 = plain, 2 = half, 3 = prime)
const SUFFIXES: [&str; 4] = ["", "", "2", "'"];

// A move read from text: its layer (a place in LAYERS), whether it's a wide turn, and its quarter turns clockwise (1–3)
#[derive(Clone, Copy)]
pub(crate) struct Turn {
    pub layer: usize,
    pub wide: bool,
    pub quarters: u8,
}

impl Turn {
    // Whether it turns the whole cube (x, y or z)
    pub fn rotation(&self) -> bool {
        self.layer >= X
    }

    // Its place among every turn the model can be asked about (layer, quarter turns, wide)
    fn key(&self) -> usize {
        self.layer * 6 + (self.quarters as usize - 1) * 2 + self.wide as usize
    }
}

// Read one move as fingering.ts's MOVE does (a face, slice or rotation, or a wide turn as Rw or r, with an optional count and prime); None when the model
// can't: other notation, or a move that turns nothing
pub(crate) fn read_turn(token: &str) -> Option<Turn> {
    let bytes = token.as_bytes();
    let first = *bytes.first()?;
    // The layer, whether it's wide, and what follows it
    let (layer, wide, rest) = if bytes.len() >= 2 && b"UDLRFB".contains(&first) && bytes[1] == b'w' {
        (first, true, &bytes[2..])
    } else if LAYERS.contains(&first) {
        (first, false, &bytes[1..])
    } else if b"udlrfb".contains(&first) {
        (first.to_ascii_uppercase(), true, &bytes[1..])
    } else {
        return None;
    };
    // A count (only its value mod 4 matters), then an optional prime, then nothing
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let count = if digits == 0 { 1 } else { rest[..digits].iter().fold(0, |sum, digit| (sum * 10 + (digit - b'0') as u32) % 4) };
    let prime = match &rest[digits..] {
        [] => false,
        [b'\''] => true,
        _ => return None,
    };
    // Quarter turns clockwise, so R3 reads as R' and R2' as R2
    let quarters = if prime { (4 - count) % 4 } else { count } as u8;
    if quarters == 0 {
        return None;
    }
    Some(Turn { layer: LAYERS.iter().position(|&each| each == layer)?, wide, quarters })
}

// One way to make a turn from a wrist state: its cost, the hand's number (0 = right, 1 = left), for a finger trick the fingers it uses, whether it's a
// reach (a finger regrip on top), the search state it leaves (the wrists after it * classes + the class it leaves: 0 for a wrist turn, no finger is out
// of place after it), and its surcharges for being made from, or ending in, a twisted grip or else an awkward one
pub(crate) struct Way {
    pub cost: f64,
    pub side: usize,
    pub fingers: u32,
    pub reach: bool,
    pub to: usize,
    pub twisted: f64,
    pub awkward: f64,
}

// A trick as the search uses it: its cost, its fingers as bits, and whether the finger has to reach for it
#[derive(Clone)]
struct Reached {
    cost: f64,
    fingers: u32,
    reach: bool,
}

// The hand map, its costs as plain numbers (a layer's entry None = the layer isn't listed), and what the search needs, worked out once
pub(crate) struct Model {
    pub wrist_quarter: f64,
    pub wrist_half: f64,
    pub wide_wrist: f64,
    pub wide_finger: f64,
    pub layers: [f64; 12],
    pub flow: [Option<f64>; 12],
    pub leave: [Option<f64>; 12],
    pub again: [Option<f64>; 12],
    pub regrip: f64,
    pub regrip_home: f64,
    pub first_regrip: f64,
    pub last_regrip: f64,
    pub finger_regrip: f64,
    pub awkward: f64,
    pub open_l: f64,
    pub open_r: f64,
    pub twisted: f64,
    pub rotation_quarter: f64,
    pub rotation_half: f64,
    pub tilt: f64,
    pub other: f64,
    // Every set of fingers the tricks use, and the classes a state can have: 0 = no finger out of place, then one per hand and set
    pub sets: Vec<u32>,
    pub classes: usize,
    // Per class: the hand whose fingers it leaves out of place (none for class 0) and which fingers
    pub class_side: Vec<usize>,
    pub class_out: Vec<u32>,
    // Per pair of wrist states (from * STATES + to): how many hands regrip, how many of them to home, and which ones (bit 1 = right, 2 = left)
    pub hands_moved: [usize; STATES * STATES],
    home_regrips: [usize; STATES * STATES],
    pub regripped: [u32; STATES * STATES],
    // What those regrips cost before a solve's first turn (one hand cheaply, a second at the full price), and anywhere else (less to come back home)
    pub regrips_first: [f64; STATES * STATES],
    pub regrips_later: [f64; STATES * STATES],
    // Wrist states with both hands away from home (an awkward grip), and of those the ones with the wrists turned opposite ways (a twisted grip)
    pub both_away: [bool; STATES],
    pub twisted_state: [bool; STATES],
    // Per turn (see Turn::key): the ways to make it from each wrist state, and the least it can cost
    ways: Vec<Vec<Vec<Way>>>,
    floors: Vec<f64>,
    // The least any quarter turn and any half turn of an answer can cost in any writing (see fingering.ts's anyFloors)
    pub any_quarter: f64,
    pub any_half: f64,
}

// A number field of the JSON (0 when it's missing)
fn number(object: &Map<String, Value>, name: &str) -> f64 {
    object.get(name).and_then(Value::as_f64).unwrap_or(0.0)
}

// A field holding an object (an empty one when it's missing)
fn object<'a>(object: &'a Map<String, Value>, name: &str) -> &'a Map<String, Value> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    object.get(name).and_then(Value::as_object).unwrap_or_else(|| EMPTY.get_or_init(Map::new))
}

// A layer → cost record (layers, flow, leave, again, open) as one entry per layer the model reads
fn per_layer(record: &Map<String, Value>) -> [Option<f64>; 12] {
    let mut values = [None; 12];
    for (name, value) in record {
        if let (Some(place), Some(cost)) = (LAYERS.iter().position(|&layer| name.as_bytes() == [layer]), value.as_f64()) {
            values[place] = Some(cost);
        }
    }
    values
}

// A list of fingers as bits
fn bits_of(fingers: &Value) -> u32 {
    fingers.as_array().map_or(0, |list| list.iter().filter_map(|finger| FINGERS.iter().position(|&name| finger.as_str() == Some(name))).fold(0, |bits, place| bits | 1 << place))
}

// A turn as the other hand makes it (its left-right mirror image): the other way round, except half turns and the middle slice, which mirror onto themselves
fn mirror(turn: &str) -> String {
    if turn.starts_with('M') || turn.ends_with('2') {
        turn.to_owned()
    } else if let Some(plain) = turn.strip_suffix('\'') {
        plain.to_owned()
    } else {
        format!("{turn}'")
    }
}

// The hands that sit differently in two wrist states, each with where it goes: (hand number, wrist)
fn regrips_between(from: usize, to: usize) -> Vec<(usize, usize)> {
    let (before, after) = ([from / WRISTS, from % WRISTS], [to / WRISTS, to % WRISTS]);
    (0..2).filter(|&hand| before[hand] != after[hand]).map(|hand| (hand, after[hand])).collect()
}

impl Model {
    // Read a HandModel's JSON and make it ready for the search
    pub fn from_json(json: &str) -> Result<Model, String> {
        let value: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        let hands = value.as_object().ok_or("The hand model isn't an object")?;
        let tricks = object(hands, "tricks");
        // Each wrist position's tricks as listed (the right hand's)
        let listed: Vec<&[Value]> = ["down", "home", "up"].iter().map(|wrist| tricks.get(*wrist).and_then(Value::as_array).map_or(&[][..], Vec::as_slice)).collect();
        // Every set of fingers the tricks use, in the order they first come up
        let mut sets: Vec<u32> = Vec::new();
        for trick in listed.iter().flat_map(|list| list.iter()) {
            let bits = bits_of(&trick["fingers"]);
            if !sets.contains(&bits) {
                sets.push(bits);
            }
        }
        let finger_regrip = number(hands, "fingerRegrip");
        // Each hand's reach per wrist position: turn → its tricks, cheapest first counting a reach's finger regrip (the left hand's are the listed ones mirrored)
        let reach: Vec<Vec<HashMap<String, Vec<Reached>>>> = [false, true]
            .iter()
            .map(|&mirrored| {
                listed
                    .iter()
                    .map(|list| {
                        let mut made: HashMap<String, Vec<Reached>> = HashMap::new();
                        for trick in list.iter() {
                            let turn = trick["turn"].as_str().unwrap_or_default();
                            let turn = if mirrored { mirror(turn) } else { turn.to_owned() };
                            let reached = Reached { cost: trick["cost"].as_f64().unwrap_or(0.0), fingers: bits_of(&trick["fingers"]), reach: trick["reach"].as_bool().unwrap_or(false) };
                            made.entry(turn).or_default().push(reached);
                        }
                        let whole = |trick: &Reached| trick.cost + if trick.reach { finger_regrip } else { 0.0 };
                        for ways in made.values_mut() {
                            ways.sort_by(|a, b| whole(a).total_cmp(&whole(b)));
                        }
                        made
                    })
                    .collect()
            })
            .collect();
        let (wrist, wide, rotation, open) = (object(hands, "wrist"), object(hands, "wide"), object(hands, "rotation"), object(hands, "open"));
        let mut model = Model {
            wrist_quarter: number(wrist, "quarter"),
            wrist_half: number(wrist, "half"),
            wide_wrist: number(wide, "wrist"),
            wide_finger: number(wide, "finger"),
            layers: per_layer(object(hands, "layers")).map(|cost| cost.unwrap_or(0.0)),
            flow: per_layer(object(hands, "flow")),
            leave: per_layer(object(hands, "leave")),
            again: per_layer(object(hands, "again")),
            regrip: number(hands, "regrip"),
            regrip_home: number(hands, "regripHome"),
            first_regrip: number(hands, "firstRegrip"),
            last_regrip: number(hands, "lastRegrip"),
            finger_regrip,
            awkward: number(hands, "awkward"),
            open_l: number(open, "L"),
            open_r: number(open, "R"),
            twisted: number(hands, "twisted"),
            rotation_quarter: number(rotation, "quarter"),
            rotation_half: number(rotation, "half"),
            tilt: number(hands, "tilt"),
            other: number(hands, "other"),
            classes: 1 + 2 * sets.len(),
            class_side: (0..1 + 2 * sets.len()).map(|class| if class == 0 { usize::MAX } else { (class - 1) / sets.len() }).collect(),
            class_out: (0..1 + 2 * sets.len()).map(|class| if class == 0 { 0 } else { sets[(class - 1) % sets.len()] }).collect(),
            sets,
            hands_moved: [0; STATES * STATES],
            home_regrips: [0; STATES * STATES],
            regripped: [0; STATES * STATES],
            regrips_first: [0.0; STATES * STATES],
            regrips_later: [0.0; STATES * STATES],
            both_away: [false; STATES],
            twisted_state: [false; STATES],
            ways: Vec::new(),
            floors: Vec::new(),
            any_quarter: 0.0,
            any_half: 0.0,
        };
        // The regrips between each pair of wrist states
        for pair in 0..STATES * STATES {
            let regrips = regrips_between(pair / STATES, pair % STATES);
            model.hands_moved[pair] = regrips.len();
            model.home_regrips[pair] = regrips.iter().filter(|(_, to)| *to == HOME).count();
            model.regripped[pair] = regrips.iter().fold(0, |bits, (hand, _)| bits | 1 << hand);
            // Their cost, summed as fingering.ts's advance sums it
            let (moved, home) = (model.hands_moved[pair], model.home_regrips[pair]);
            model.regrips_first[pair] = if moved > 0 { model.first_regrip + model.regrip * (moved - 1) as f64 } else { 0.0 };
            model.regrips_later[pair] = model.regrip_home * home as f64 + model.regrip * (moved - home) as f64;
        }
        // Awkward and twisted grips
        for state in 0..STATES {
            model.both_away[state] = model.hands_moved[state * STATES + HOME_STATE] == 2;
            model.twisted_state[state] = model.both_away[state] && state / WRISTS != state % WRISTS;
        }
        // Every turn's ways from each wrist state (rotations have none: the search makes them apart), and its floor
        for key in 0..LAYERS.len() * 6 {
            let turn = Turn { layer: key / 6, quarters: (key % 6 / 2 + 1) as u8, wide: key % 2 == 1 };
            let ways: Vec<Vec<Way>> = if turn.rotation() { Vec::new() } else { (0..STATES).map(|state| model.ways_from(turn, state, &reach)).collect() };
            // The least it can cost: its cheapest way, a reach's finger regrip included (`other` when no trick makes it)
            let floor = ways.iter().flatten().map(|way| way.cost + if way.reach { finger_regrip } else { 0.0 }).fold(f64::INFINITY, f64::min);
            model.floors.push(if floor == f64::INFINITY { model.other } else { floor });
            model.ways.push(ways);
        }
        // The least any quarter and half turn can cost in any writing: a face turn at its cheapest and in rhythm, or half a slice turn (which makes two turns)
        let flow = object(hands, "flow").values().filter_map(Value::as_f64).fold(0.0, f64::max);
        let least = |quarters: u8| {
            let faces = FACES.iter().map(|&layer| model.turn_floor(Turn { layer, wide: false, quarters }) - flow);
            let slices = SLICES.iter().map(|&layer| model.turn_floor(Turn { layer, wide: false, quarters }) / 2.0);
            faces.chain(slices).fold(f64::INFINITY, f64::min)
        };
        (model.any_quarter, model.any_half) = (least(1).min(least(3)), least(2));
        Ok(model)
    }

    // Every way to make a turn with the wrists in this state (none when it takes a regrip first, or when no trick makes it), as fingering.ts's waysFrom
    fn ways_from(&self, turn: Turn, state: usize, reach: &[Vec<HashMap<String, Vec<Reached>>>]) -> Vec<Way> {
        let mut ways = Vec::new();
        let at = [state / WRISTS, state % WRISTS];
        // Added to every way: a wide turn's extra, and what the layer itself costs to turn
        let wide = if turn.layer == R || turn.layer == L { self.wide_wrist } else { self.wide_finger };
        let extra = (if turn.wide { wide } else { 0.0 }) + self.layers[turn.layer];
        // R and L are wrist turns: R takes the right wrist up and L the left wrist down (its mirror image); a half turn may go either way
        if turn.layer == R || turn.layer == L {
            let hand = if turn.layer == R { 0 } else { 1 };
            let up = turn.quarters == if hand == 0 { 1 } else { 3 };
            let steps: &[isize] = if turn.quarters == 2 { &[2, -2] } else if up { &[1] } else { &[-1] };
            for step in steps {
                let to = at[hand] as isize + step;
                // A wrist can't turn past down or up
                if to < 0 || to >= WRISTS as isize {
                    continue;
                }
                let cost = (if turn.quarters == 2 { self.wrist_half } else { self.wrist_quarter }) + extra;
                let after = if hand == 0 { to as usize * WRISTS + at[1] } else { at[0] * WRISTS + to as usize };
                // A wide turn takes a finger regrip: the hand opens to take a second layer along
                ways.push(self.way(state, cost, after, hand, 0, turn.wide, 0));
            }
            return ways;
        }
        // Any other turn is a finger trick of either hand, which leaves both wrists where they are
        let name = format!("{}{}", LAYERS[turn.layer] as char, SUFFIXES[turn.quarters as usize]);
        for side in 0..2 {
            for trick in reach[side][at[side]].get(&name).map_or(&[][..], Vec::as_slice) {
                // A thumb can't take a second layer along, so it makes no wide turn
                if turn.wide && trick.fingers & THUMB != 0 {
                    continue;
                }
                // A wide turn takes a finger regrip, like a reach: the finger moves over to take a second layer along
                let set = self.sets.iter().position(|&set| set == trick.fingers).unwrap_or(0);
                ways.push(self.way(state, trick.cost + extra, state, side, trick.fingers, trick.reach || turn.wide, 1 + side * self.sets.len() + set));
            }
        }
        ways
    }

    // A way made from wrist state `via`, with what the search reads from it worked out once: the search state it leaves and its grip surcharges
    #[allow(clippy::too_many_arguments)]
    fn way(&self, via: usize, cost: f64, state: usize, side: usize, fingers: u32, reach: bool, class: usize) -> Way {
        // A move made from a twisted grip, or ending in one, costs more; so does one made from, or ending in, a grip with both hands away from home, a little less
        let twisted = if self.twisted_state[via] || self.twisted_state[state] { self.twisted } else { 0.0 };
        let awkward = if twisted == 0.0 && (self.both_away[via] || self.both_away[state]) { self.awkward } else { 0.0 };
        Way { cost, side, fingers, reach, to: state * self.classes + class, twisted, awkward }
    }

    // The ways to make a turn from each wrist state (empty for a rotation)
    pub fn ways_of(&self, turn: Turn) -> &[Vec<Way>] {
        &self.ways[turn.key()]
    }

    // The least a turn can cost: its cheapest trick from any hand position, a reach's finger regrip and the layer's own cost included
    pub fn turn_floor(&self, turn: Turn) -> f64 {
        self.floors[turn.key()]
    }

    // The rhythm a move leaves for the next one: 1 = it's on a layer that flows, 2 = on a slow one, 0 = neither (a slice turn, a rotation, no move)
    pub fn rhythm_of(&self, turn: Option<Turn>) -> u8 {
        match turn {
            Some(turn) if self.flow[turn.layer].is_some() => 1,
            Some(turn) if self.leave[turn.layer].is_some() => 2,
            _ => 0,
        }
    }

    // What a turn saves when it comes right after this one: both on layers that flow, so nothing after a rotation, a slice turn or a move the model can't read
    pub fn flow_after(&self, last: Option<Turn>, turn: Option<Turn>) -> f64 {
        match (last, turn) {
            (Some(last), Some(turn)) if self.flow[last.layer].is_some() => self.flow[turn.layer].unwrap_or(0.0),
            _ => 0.0,
        }
    }

    // What a turn pays for leaving that rhythm: it's on a slow layer and the move before it wasn't (or there was none), so a run of slow turns pays once
    pub fn leave_after(&self, last: Option<Turn>, turn: Option<Turn>) -> f64 {
        match turn {
            Some(turn) if last.is_none_or(|last| self.leave[last.layer].is_none()) => self.leave[turn.layer].unwrap_or(0.0),
            _ => 0.0,
        }
    }

    // What a turn of R or L pays for the opposite layer being a quarter turn off (`apart`: bit 1 = R is, bit 2 = L is); a wide turn takes the middle along
    pub fn open_cost(&self, turn: Option<Turn>, apart: u8) -> f64 {
        match turn {
            Some(turn) if !turn.wide && turn.layer == L && apart & 1 != 0 => self.open_l,
            Some(turn) if !turn.wide && turn.layer == R && apart & 2 != 0 => self.open_r,
            _ => 0.0,
        }
    }
}

// Which of R and L are a quarter turn off after a turn (see open_cost): a plain quarter turn of R or L opens or closes its own layer; wide and slice turns
// leave it as it is, and a rotation leaves neither off (the hands take the cube again, and R and L may be other layers now)
pub(crate) fn apart_after(turn: Option<Turn>, apart: u8) -> u8 {
    match turn {
        Some(turn) if turn.rotation() => 0,
        Some(turn) if !turn.wide && turn.quarters % 2 == 1 && turn.layer == R => apart ^ 1,
        Some(turn) if !turn.wide && turn.quarters % 2 == 1 && turn.layer == L => apart ^ 2,
        _ => apart,
    }
}

// A cost to two decimals, as JavaScript's Math.round does it (halves go up)
pub(crate) fn round(cost: f64) -> f64 {
    let scaled = cost * 100.0;
    let floor = scaled.floor();
    (if scaled - floor >= 0.5 { floor + 1.0 } else { floor }) / 100.0
}
