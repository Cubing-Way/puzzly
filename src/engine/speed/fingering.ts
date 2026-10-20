// Speed model, the evaluator: the cheapest way for two hands to make a move sequence (finger tricks, wrist turns, finger regrips and hand regrips), and who makes each move

// The hand map, its wrist positions and its fingers
import { type HandModel, type Wrist, type Finger, HANDS, WRISTS, trickName } from "./hands";
// The ways an answer can be written with wide and slice turns
import { writingPlan } from "./writings";
// A step's moves joined onto the moves before it
import { cancelInto } from "../core/moves";
// The speed model in Rust (search/src/speed.rs): the class loadEngine hands over once the Rust code is loaded
import type { SpeedModel } from "../../../search/pkg/puzzly_search.js";

// A hand
export type Hand = "right" | "left";

// One way to make a move: the hand and finger ("wrist" for a wrist turn) and its cost (with the finger regrip of a trick the finger has to reach for)
export interface FingerWay {
  hand: Hand;
  finger: string;
  cost: number;
}

// One move of a fingering: who makes it, what it costs, the other ways it could be made, and where the hands are after it
export interface FingeringStep {
  move: string; // as written in the sequence
  hand: Hand | null; // null = no one hand: a rotation, or a move no trick makes
  finger: string; // "wrist", a trick's fingers, "rotation", "tilt" (an x turn the wrists make together) or "other"
  cost: number; // the move's own cost (its finger regrips, grip surcharges and hand regrips are counted apart)
  fingerRegrips: number; // what its finger regrips cost: a finger leaving its place to reach the turn, or coming back to where this move needs it (0 = none)
  awkward: number; // added because the move is made from, or ends in, a grip with both hands away from home, the wrists turned the same way (0 = it isn't)
  twisted: number; // added because the move is made from, or ends in, a twisted grip: the wrists turned opposite ways (0 = it isn't)
  again: number; // added because the sequence turned this layer before, for layers that are slow to turn again and again (0 = not so)
  flow: number; // taken off because the move keeps the rhythm of the move before it: both on layers that flow (R, U, L), no regrip between (0 = it doesn't)
  leave: number; // added because the move leaves that rhythm: it's on a slow layer (D, B) and the move before it wasn't (0 = it doesn't)
  open: number; // added because the move turns R or L while the opposite one is a quarter turn off the middle layer, beyond what it pays for an awkward or a twisted grip (the same strain, so only the bigger of the two is paid; 0 = nothing more)
  regrips: { hand: Hand; to: Wrist; cost: number }[]; // hands that take the cube again at another wrist position before the move
  others: FingerWay[]; // the other ways to make the move from the same hand position, cheapest first
  wrists: Record<Hand, Wrist>; // wrist positions after the move
}

// A move sequence's cheapest fingering: its cost in easy turns (R or a U flick = 1, regrips and the way back home included), its hand regrips (between the
// moves, and each hand that comes back home after the last one: that's a regrip too), one step per move, and the hands that have to come back home
export interface Fingering {
  cost: number;
  regrips: number;
  steps: FingeringStep[];
  ending: { hand: Hand; cost: number }[];
}

// Both hands, right first (a hand's number is its place here)
const BOTH: Hand[] = ["right", "left"];

// Wrist states: both wrists as one number, right * 3 + left, each wrist its place in WRISTS
const STATES = WRISTS.length * WRISTS.length;
const HOME_STATE = WRISTS.indexOf("home") * WRISTS.length + WRISTS.indexOf("home");

// Fingers as bits, so sets of them can be compared
const BITS: Record<Finger, number> = { thumb: 1, index: 2, middle: 4, ring: 8, pinky: 16 };

// The fingers that hold the cube from behind while the others turn
const BACK = BITS.middle | BITS.ring;

// Whole-cube rotations
const ROTATIONS = "xyz";

// What follows a turn's letter, by its quarter turns clockwise (1 = plain, 2 = half, 3 = prime)
const SUFFIXES = ["", "", "2", "'"];

// Move text the model reads: a face, slice or rotation, or a wide turn (Rw or r), with an optional count and prime
const MOVE = /^([UDLRFBMESxyz]|[UDLRFB]w|[udlrfb])(\d*)('?)$/;

// A move read from text: its layer (a face, M, E, S, or a rotation's x, y, z), whether it's a wide turn, and its quarter turns clockwise (1–3)
interface Turn {
  layer: string;
  wide: boolean;
  quarters: number;
}

// Read one move (null when the model can't: other notation, or a move that turns nothing)
function readTurn(move: string): Turn | null {
  const match = MOVE.exec(move);
  if (!match) return null;
  const [, family, count, prime] = match;
  // Quarter turns clockwise, so R3 reads as R' and R2' as R2
  const quarters = ((((count ? Number(count) : 1) * (prime ? -1 : 1)) % 4) + 4) % 4;
  if (!quarters) return null;
  const wide = family.length === 2 || "udlrfb".includes(family);
  return { layer: wide ? family[0].toUpperCase() : family, wide, quarters };
}

// A turn as the other hand makes it (its left-right mirror image): the other way round, except half turns and the middle slice, which mirror onto themselves
function mirror(turn: string): string {
  if (turn.startsWith("M") || turn.endsWith("2")) return turn;
  return turn.endsWith("'") ? turn.slice(0, -1) : `${turn}'`;
}

// A trick as the search uses it: its name, its cost, its fingers as bits, and whether the finger has to reach for it (a finger regrip on top)
interface Reached {
  finger: string;
  cost: number;
  fingers: number;
  reach: boolean;
}

// What a hand at one wrist position can make: turn → its tricks, cheapest first
type Reach = Map<string, Reached[]>;

// A model made ready for the search, once: each hand's reach per wrist position, every set of fingers its tricks use, and the ways to make each turn seen
// so far, from each wrist state. A state's class says whose fingers the last move left out of place: 0 = nobody's, then one per hand and set
interface Ready {
  reach: Record<Hand, Reach[]>;
  sets: number[];
  classes: number;
  ways: Map<string, Way[][]>;
  floors: Map<string, number>; // the least each turn seen so far can cost (see turnFloor)
  any?: { quarter: number; half: number }; // the least any quarter turn and any half turn can cost in any writing (see writingFloor)
}

// Models made ready so far
const readied = new WeakMap<HandModel, Ready>();

// The speed model in Rust, once loadEngine has loaded it (null until then: the TypeScript code below scores, with the same costs). Only fingering
// stays in TypeScript: it says who makes each move, for one solution at a time
let rustModel: typeof SpeedModel | null = null;
// Each hand map's copy in Rust (made on first use)
const rustCopies = new WeakMap<HandModel, SpeedModel>();
// No step starts (most costs are of one step)
const NO_STARTS = new Uint32Array(0);

// Score with the speed model in Rust from now on (loadEngine calls it once the Rust code is loaded; null goes back to the TypeScript code)
export function useRustSpeed(model: typeof SpeedModel | null): void {
  rustModel = model;
}

// A hand map's copy in Rust, or null while the Rust code isn't loaded
function rustFor(hands: HandModel): SpeedModel | null {
  if (!rustModel) return null;
  let copy = rustCopies.get(hands);
  if (!copy) rustCopies.set(hands, (copy = new rustModel(JSON.stringify(hands))));
  return copy;
}

// A list of fingers as bits
function bitsOf(fingers: Finger[]): number {
  return fingers.reduce((bits, finger) => bits | BITS[finger], 0);
}

// One hand's reach at a wrist position (the left hand's tricks are the listed ones mirrored)
function reachAt(hands: HandModel, wrist: Wrist, mirrored: boolean): Reach {
  const reach: Reach = new Map();
  for (const trick of hands.tricks[wrist] ?? []) {
    const turn = mirrored ? mirror(trick.turn) : trick.turn;
    reach.set(turn, [...(reach.get(turn) ?? []), { finger: trickName(trick), cost: trick.cost, fingers: bitsOf(trick.fingers), reach: Boolean(trick.reach) }]);
  }
  // Cheapest first, counting the finger regrip of the tricks a finger has to reach for
  const whole = (trick: Reached) => trick.cost + (trick.reach ? hands.fingerRegrip : 0);
  for (const made of reach.values()) made.sort((a, b) => whole(a) - whole(b));
  return reach;
}

// A model ready for the search (made on first use)
function readyFor(hands: HandModel): Ready {
  let ready = readied.get(hands);
  if (!ready) {
    const reach = { right: WRISTS.map((wrist) => reachAt(hands, wrist, false)), left: WRISTS.map((wrist) => reachAt(hands, wrist, true)) };
    const sets = [...new Set(WRISTS.flatMap((wrist) => (hands.tricks[wrist] ?? []).map((trick) => bitsOf(trick.fingers))))];
    ready = { reach, sets, classes: 1 + BOTH.length * sets.length, ways: new Map(), floors: new Map() };
    readied.set(hands, ready);
  }
  return ready;
}

// Both wrists of a wrist state, as places in WRISTS
function wristsOf(state: number): Record<Hand, number> {
  return { right: Math.floor(state / WRISTS.length), left: state % WRISTS.length };
}

// One way to make a turn from a wrist state: who makes it and its cost, the wrist state it leaves, the hand's number, and for a finger trick the fingers it uses,
// whether it's a reach, and the class it leaves (0 for a wrist turn: no finger is out of place after it)
interface Way extends FingerWay {
  state: number;
  side: number;
  fingers: number;
  reach: boolean;
  class: number;
}

// Every way to make a turn with the wrists in this state (none when it takes a regrip first, or when no trick makes it)
function waysFrom(turn: Turn, state: number, hands: HandModel, ready: Ready): Way[] {
  const ways: Way[] = [];
  const at = wristsOf(state);
  // Added to every way: a wide turn's extra, and what the layer itself costs to turn
  const wide = turn.layer === "R" || turn.layer === "L" ? hands.wide.wrist : hands.wide.finger;
  const extra = (turn.wide ? wide : 0) + (hands.layers[turn.layer] ?? 0);
  // R and L are wrist turns: R takes the right wrist up and L the left wrist down (its mirror image); a half turn may go either way
  if (turn.layer === "R" || turn.layer === "L") {
    const hand: Hand = turn.layer === "R" ? "right" : "left";
    const up = turn.quarters === (hand === "right" ? 1 : 3);
    for (const step of turn.quarters === 2 ? [2, -2] : [up ? 1 : -1]) {
      const to = at[hand] + step;
      // A wrist can't turn past down or up
      if (to < 0 || to >= WRISTS.length) continue;
      const cost = (turn.quarters === 2 ? hands.wrist.half : hands.wrist.quarter) + extra;
      const after = hand === "right" ? to * WRISTS.length + at.left : at.right * WRISTS.length + to;
      // A wide turn takes a finger regrip: the hand opens to take a second layer along
      ways.push({ hand, finger: "wrist", cost, state: after, side: BOTH.indexOf(hand), fingers: 0, reach: turn.wide, class: 0 });
    }
    return ways;
  }
  // Any other turn is a finger trick of either hand, which leaves both wrists where they are
  const name = turn.layer + SUFFIXES[turn.quarters];
  BOTH.forEach((hand, side) => {
    for (const trick of ready.reach[hand][at[hand]].get(name) ?? []) {
      // A thumb can't take a second layer along, so it makes no wide turn
      if (turn.wide && (trick.fingers & BITS.thumb) !== 0) continue;
      // A wide turn takes a finger regrip, like a reach: the finger moves over to take a second layer along
      ways.push({ hand, finger: trick.finger, cost: trick.cost + extra, state, side, fingers: trick.fingers, reach: trick.reach || turn.wide, class: 1 + side * ready.sets.length + ready.sets.indexOf(trick.fingers) });
    }
  });
  return ways;
}

// The ways to make a turn from each wrist state (worked out once per model and turn: a search asks for the same turns again and again)
function waysOf(turn: Turn, hands: HandModel, ready: Ready): Way[][] {
  const key = `${turn.layer}${turn.quarters}${turn.wide ? "w" : ""}`;
  let ways = ready.ways.get(key);
  if (!ways) {
    ways = Array.from({ length: STATES }, (_, state) => waysFrom(turn, state, hands, ready));
    ready.ways.set(key, ways);
  }
  return ways;
}

// The hands that sit differently in two wrist states, with where each one goes (a regrip each)
function regripsBetween(from: number, to: number): { hand: Hand; to: Wrist }[] {
  const [before, after] = [wristsOf(from), wristsOf(to)];
  return BOTH.filter((hand) => before[hand] !== after[hand]).map((hand) => ({ hand, to: WRISTS[after[hand]] }));
}

// Per pair of wrist states (from * STATES + to): how many hands regrip, how many of them to home, and which ones (bit 1 = right, 2 = left)
const PAIRS = Array.from({ length: STATES * STATES }, (_, pair) => regripsBetween(Math.floor(pair / STATES), pair % STATES));
const HANDS_MOVED = PAIRS.map((regrips) => regrips.length);
const HOME_REGRIPS = PAIRS.map((regrips) => regrips.filter((regrip) => regrip.to === "home").length);
const REGRIPPED = PAIRS.map((regrips) => regrips.reduce((bits, regrip) => bits | (1 << BOTH.indexOf(regrip.hand)), 0));

// Wrist states with both hands away from home: an awkward grip to make a move in
const BOTH_AWAY = Array.from({ length: STATES }, (_, state) => HANDS_MOVED[state * STATES + HOME_STATE] === 2);

// Of those, the ones with the wrists turned opposite ways (one thumb on top, the other on the bottom): a twisted grip, which is worse
const TWISTED = BOTH_AWAY.map((away, state) => away && wristsOf(state).right !== wristsOf(state).left);

// What one hand's regrip costs: little before the first turn, unless the other hand regrips there too (`second`: starting with both hands regripped is awkward,
// so that one pays as between turns); after the first turn, less to come back home than to go anywhere else
function regripCost(hands: HandModel, to: Wrist, first: boolean, second: boolean): number {
  return first && !second ? hands.firstRegrip : to === "home" ? hands.regripHome : hands.regrip;
}

// What a way's finger regrips cost after a move of class `last`: one when the finger first has to reach the turn, and one when the move before was made by
// the same hand (which hasn't regripped since) and left out of place a finger this one needs: a finger that makes it, or the last one holding the cube from behind
function fingerCost(hands: HandModel, ready: Ready, last: number, way: Way, regripped: boolean): number {
  const reach = way.reach ? hands.fingerRegrip : 0;
  if (last === 0 || regripped || Math.floor((last - 1) / ready.sets.length) !== way.side) return reach;
  // Fingers the move before left out of place, and the back fingers this move leaves holding the cube
  const out = ready.sets[(last - 1) % ready.sets.length];
  const holding = BACK & ~way.fingers;
  const back = (!way.reach && (way.fingers & out) !== 0) || (holding !== 0 && (holding & ~out) === 0);
  return back ? reach + hands.fingerRegrip : reach;
}

// What a turn saves when it comes right after this one: both on layers that flow (see HandModel.flow), so nothing after a rotation, a slice turn or a move the model can't read
function flowAfter(hands: HandModel, last: Turn | null, turn: Turn | null): number {
  return last && turn && hands.flow[last.layer] !== undefined ? (hands.flow[turn.layer] ?? 0) : 0;
}

// What a turn pays for leaving that rhythm: it's on a slow layer (see HandModel.leave) and the move before it wasn't (or there was none), so a run of slow turns pays once
function leaveAfter(hands: HandModel, last: Turn | null, turn: Turn | null): number {
  return turn && (!last || hands.leave[last.layer] === undefined) ? (hands.leave[turn.layer] ?? 0) : 0;
}

// What a turn of R or L pays for the opposite layer being a quarter turn off (`apart`: bit 1 = R is, bit 2 = L is): the hand on that layer can't
// hold the rest still. A wide turn takes the middle along, so it pays nothing
function openCost(hands: HandModel, turn: Turn | null, apart: number): number {
  if (!turn || turn.wide) return 0;
  return turn.layer === "L" && apart & 1 ? (hands.open.L ?? 0) : turn.layer === "R" && apart & 2 ? (hands.open.R ?? 0) : 0;
}

// Which of R and L are a quarter turn off after a turn (see openCost): a plain quarter turn of R or L opens or closes its own layer (wide and
// slice turns, which known algs make freely against an open layer, leave it as it is). A rotation leaves neither off: the hands take the cube
// again, and R and L may be other layers now
function apartAfter(turn: Turn | null, apart: number): number {
  if (turn && ROTATIONS.includes(turn.layer)) return 0;
  if (!turn || turn.wide || turn.quarters % 2 === 0) return apart;
  return turn.layer === "R" ? apart ^ 1 : turn.layer === "L" ? apart ^ 2 : apart;
}

// How one state after a move was reached: the state before the move, the wrist state the move was made from (after any regrips), whether those regrips came
// before the first turn, who made the move, what it cost on its own, its surcharges for an awkward or a twisted grip, for finger regrips and for turning its
// layer again, what it saved by keeping the rhythm, and what it paid for an open opposite layer beyond its grip's surcharge
interface Link {
  from: number;
  via: number;
  first: boolean;
  hand: Hand | null;
  finger: string;
  cost: number;
  awkward: number;
  twisted: number;
  fingers: number;
  again: number;
  flow: number;
  open: number;
}

// What advance hands over for each way into a state: the state, its cost so far, and the parts of its link (see Link; `first` is the caller's own).
// Plain values, so a search that only wants costs makes no object per way
type Offer = (to: number, total: number, from: number, via: number, hand: Hand | null, finger: string, cost: number, awkward: number, twisted: number, fingers: number, again: number, flow: number, open: number) => void;

// One move of the search: from each state the hands can be in before it (`before`: their costs so far), every way into a state after it, each handed to
// `offer`. `first` = no turn was made yet (regrips cost less), `free` = a rotation costs nothing (nothing was turned yet, at the start of a solve),
// `again` = what the move pays for turning its layer again (and for leaving the rhythm), `opposite` = what it pays for an open opposite layer (see openCost)
// unless its grip is awkward or twisted, `flow` = what it saves when no hand regrips before it (it keeps the rhythm of the move before)
function advance(hands: HandModel, ready: Ready, turn: Turn | null, before: number[], first: boolean, free: boolean, again: number, opposite: number, flow: number, offer: Offer): void {
  const { classes } = ready;
  // States the hands can be in before this move
  const open: number[] = [];
  for (let state = 0; state < before.length; state++) if (before[state] < Infinity) open.push(state);
  if (turn && ROTATIONS.includes(turn.layer)) {
    // A rotation: both hands let go and take the cube again at home (free while the solve hasn't started); a half turn costs more
    const cost = free ? 0 : turn.quarters === 2 ? hands.rotation.half : hands.rotation.quarter;
    for (const from of open) offer(HOME_STATE * classes, before[from] + cost, from, Math.floor(from / classes), null, "rotation", cost, 0, 0, 0, 0, 0, 0);
    // A tilt: an x turn the wrists make together without letting go, where both can go that way (x takes both a step up, x' a step down, x2 two steps)
    if (turn.layer === "x") {
      for (const step of turn.quarters === 2 ? [2, -2] : [turn.quarters === 1 ? 1 : -1]) {
        for (const from of open) {
          const wrists = Math.floor(from / classes);
          const [right, left] = [wristsOf(wrists).right + step, wristsOf(wrists).left + step];
          if (Math.min(right, left) < 0 || Math.max(right, left) >= WRISTS.length) continue;
          // Both wrists turn with the whole cube in them, so it costs wherever it leads, back home too (the cube really turns, it isn't just named anew)
          const tilt = hands.tilt * Math.abs(step);
          offer((right * WRISTS.length + left) * classes, before[from] + tilt, from, wrists, null, "tilt", tilt, 0, 0, 0, 0, 0, 0);
        }
      }
    }
    return;
  }
  // A turn: from each open state, regrip to any wrist state (or stay) and make the turn any way that state allows
  let made = false;
  const each = turn ? waysOf(turn, hands, ready) : [];
  for (let via = 0; via < each.length; via++) {
    const ways = each[via];
    if (!ways.length) continue;
    made = true;
    for (const from of open) {
      const pair = Math.floor(from / classes) * STATES + via;
      const moved = HANDS_MOVED[pair];
      const home = HOME_REGRIPS[pair];
      // Before the first turn the hands leave home: the first one cheaply, a second one at the full price
      const regrips = first ? (moved ? hands.firstRegrip + hands.regrip * (moved - 1) : 0) : hands.regripHome * home + hands.regrip * (moved - home);
      // A hand that regrips first breaks the rhythm, so the move saves nothing then
      const kept = moved ? 0 : flow;
      const base = before[from] + regrips + again - kept;
      for (const way of ways) {
        const fingers = fingerCost(hands, ready, from % classes, way, (REGRIPPED[pair] & (1 << way.side)) !== 0);
        // A move made from a twisted grip, or ending in one, costs more; so does one made from, or ending in, a grip with both hands away from home, a little less
        const twisted = TWISTED[via] || TWISTED[way.state] ? hands.twisted : 0;
        const awkward = !twisted && (BOTH_AWAY[via] || BOTH_AWAY[way.state]) ? hands.awkward : 0;
        // An open opposite layer is the same strain as an awkward or a twisted grip (the hands can't hold the rest still): only the bigger of the two is paid
        const opened = Math.max(0, opposite - awkward - twisted);
        offer(way.state * classes + way.class, base + way.cost + fingers + awkward + twisted + opened, from, via, way.hand, way.finger, way.cost, awkward, twisted, fingers, again, kept, opened);
      }
    }
  }
  // No trick makes it from any state (E2, S2, a move the model can't read): it costs `other` and leaves the hands where they are
  if (!made) {
    for (const from of open) {
      const wrists = Math.floor(from / classes);
      const twisted = TWISTED[wrists] ? hands.twisted : 0;
      const awkward = !twisted && BOTH_AWAY[wrists] ? hands.awkward : 0;
      // An open opposite layer only adds what the grip's surcharge doesn't already charge
      const opened = Math.max(0, opposite - awkward - twisted);
      offer(wrists * classes, before[from] + hands.other + awkward + twisted + opened + again, from, wrists, null, "other", hands.other, awkward, twisted, 0, again, 0, opened);
    }
  }
}

// The search behind fingering and speedCost. A state is the wrists and the class of the last move (wrists * classes + class); with `trace` off only the cost is worked out.
// `starts` = where each step starts, for a joined solve (see joinStep): the counts that belong to one step start over there
function evaluate(moves: string, hands: HandModel, fresh: boolean, trace: boolean, starts: number[] = []): Fingering {
  const ready = readyFor(hands);
  const { classes } = ready;
  const size = STATES * classes;
  const tokens = moves.split(/\s+/).filter(Boolean);
  const turns = tokens.map(readTurn);
  const stepStarts = new Set(starts);
  // What each move pays for turning a layer the sequence turned before (only for the layers the model lists; the same whoever makes the move), counted
  // from the step's start or the last rotation (after one, the letters may name other layers)
  const turned = new Set<string>();
  const agains = turns.map((turn, index) => {
    if (stepStarts.has(index)) turned.clear();
    if (turn && ROTATIONS.includes(turn.layer)) turned.clear();
    if (!turn || ROTATIONS.includes(turn.layer)) return 0;
    const again = turned.has(turn.layer) ? (hands.again[turn.layer] ?? 0) : 0;
    turned.add(turn.layer);
    return again;
  });
  // What each move saves by keeping the rhythm of the move before it (both on layers that flow; a rotation in between breaks it)
  const flows = turns.map((turn, index) => flowAfter(hands, index ? turns[index - 1] : null, turn));
  // What each move pays for leaving it (a slow layer after a move that wasn't on one)
  const leaves = turns.map((turn, index) => leaveAfter(hands, index ? turns[index - 1] : null, turn));
  // What each turn of R or L pays for the opposite layer being a quarter turn off (less what an awkward or a twisted grip already charges, see advance),
  // with nothing off at a step's start (the hands came home after the step before, see lastRegrip)
  let apart = 0;
  const opens = turns.map((turn, index) => {
    if (stepStarts.has(index)) apart = 0;
    const open = openCost(hands, turn, apart);
    apart = apartAfter(turn, apart);
    return open;
  });
  // Cheapest cost of each state after the moves so far (Infinity = can't be in it): both hands start at home with every finger in place
  let costs = new Array<number>(size).fill(Infinity);
  costs[HOME_STATE * classes] = 0;
  // Per move, each state's link back to the state before it
  const trail: (Link | null)[][] = [];
  // Whether a turn was made yet
  let started = false;
  for (const [index, turn] of turns.entries()) {
    const next = new Array<number>(size).fill(Infinity);
    const links = trace ? new Array<Link | null>(size).fill(null) : null;
    // Before the first turn of a solve a regrip costs less and a rotation is free (in the middle of a solve the hands come straight from the moves before)
    const first = fresh && !started;
    // Keep the cheaper of two ways into a state (its link only when tracing)
    advance(hands, ready, turn, costs, first, first, agains[index] + leaves[index], opens[index], flows[index], (to, total, from, via, hand, finger, cost, awkward, twisted, fingers, again, flow, open) => {
      if (total >= next[to]) return;
      next[to] = total;
      if (links) links[to] = { from, via, first, hand, finger, cost, awkward, twisted, fingers, again, flow, open };
    });
    // Anything but a rotation is a turn (a move the model can't read too)
    if (!turn || !ROTATIONS.includes(turn.layer)) started = true;
    costs = next;
    if (links) trail.push(links);
  }
  // Each end state's cost with its hands brought back home; the cheapest one is where the sequence ends
  const away = (state: number) => HANDS_MOVED[Math.floor(state / classes) * STATES + HOME_STATE];
  const ends = costs.map((cost, end) => cost + hands.lastRegrip * away(end));
  const total = Math.min(...ends);
  if (!trace) return { cost: round(total), regrips: 0, steps: [], ending: [] };
  // On a tie the end state with fewer hands away from home wins (home itself first)
  let state = HOME_STATE * classes;
  for (let end = 0; end < size; end++) {
    const sooner = round(ends[end]) - round(ends[state]);
    if (sooner < 0 || (sooner === 0 && away(end) < away(state))) state = end;
  }
  const ending = regripsBetween(Math.floor(state / classes), HOME_STATE).map(({ hand }) => ({ hand, cost: hands.lastRegrip }));
  // Walk back from that end state, one step per move
  const steps: FingeringStep[] = [];
  for (let index = tokens.length - 1; index >= 0; index--) {
    const link = trail[index][state]!;
    const turn = turns[index];
    const at = wristsOf(Math.floor(state / classes));
    // The other ways from the hand position the move was made in (finger tricks of either hand; a wrist turn has none)
    const others = link.hand && turn ? waysFrom(turn, link.via, hands, ready).filter((way) => way.hand !== link.hand || way.finger !== link.finger) : [];
    steps.unshift({
      move: tokens[index],
      hand: link.hand,
      finger: link.finger,
      cost: round(link.cost),
      fingerRegrips: round(link.fingers),
      awkward: link.awkward,
      twisted: link.twisted,
      again: agains[index],
      flow: link.flow,
      leave: leaves[index],
      open: round(link.open),
      regrips: regripsBetween(Math.floor(link.from / classes), link.via).map((regrip, second) => ({ ...regrip, cost: regripCost(hands, regrip.to, link.first, second > 0) })),
      others: others.map(({ hand, finger, cost, reach }) => ({ hand, finger, cost: round(cost + (reach ? hands.fingerRegrip : 0)) })).sort((a, b) => a.cost - b.cost),
      wrists: { right: WRISTS[at.right], left: WRISTS[at.left] },
    });
    state = link.from;
  }
  // Regrips before the moves, and the hands coming back home at the end
  return { cost: round(total), regrips: steps.reduce((sum, step) => sum + step.regrips.length, 0) + ending.length, steps, ending };
}

// One place in an answer being written: the frame the cube is held in there, the layers turned so far that cost more to turn again (as bits), the rhythm
// the move made last leaves (1 = it's on a layer that flows, 2 = on a slow one, 0 = neither), which of R and L are a quarter turn off the middle layer
// (see openCost), each hand state's cheapest cost so far, and how each state was reached (the place before, the state there and the token made)
interface Place {
  frame: string;
  turned: number;
  rhythm: number;
  apart: number;
  costs: number[];
  from: Place[];
  state: number[];
  token: string[];
}

// The cheapest way for the hands to write an answer's face turns when some may be made as wide or slice turns about these axes ("x", "y", "z") with the
// cube ending held as it started (see writings.ts): the same search as evaluate, over every such writing at once, so `r U R' U' r' F R F'` is found from
// `L F R' F' L' F R F'`. `axes` = one list for both kinds, or the wide turns' and the slice turns' axes apart. `before` = moves made first (the grip
// rotation), `fresh` as for fingering. Gives the writing and its cost with `before` (the plain writing when nothing beats it); null when the plain
// writing is the only one. With a `limit`, writings that can't cost that or less are given up on the way (each turn left costs at least what
// writingFloor says), and null is given when none is left
export function cheapestWriting(moves: string, axes: string[] | { wide: string[]; slice: string[] }, hands: HandModel = HANDS, fresh = false, before = "", limit = Infinity): { text: string; cost: number } | null {
  return writingSearch(moves, axes, hands, fresh, before, limit).found;
}

// What a writing search gave: the cheapest writing (null: none, or none left under the limit), and which other limits would have searched the very same
// way, so given the very same writing: those that go on from every place with a lower bound up to `kept` and give up on every place from `pruned` on
// (a place gives up when its bound is over limit + 1e-6). A search with no writing but the plain one gives the same for any limit
export interface WritingSearch {
  found: { text: string; cost: number } | null;
  kept: number;
  pruned: number;
}

// The search behind cheapestWriting, with its bounds (see WritingSearch)
export function writingSearch(moves: string, axes: string[] | { wide: string[]; slice: string[] }, hands: HandModel = HANDS, fresh = false, before = "", limit = Infinity): WritingSearch {
  const turns = moves.split(/\s+/).filter(Boolean);
  // Wide and slice axes: the same list for both, or each its own
  const [wide, slice] = Array.isArray(axes) ? [axes, axes] : [axes.wide, axes.slice];
  // In Rust once it's loaded (the writing it gives is read, then freed)
  const rust = rustFor(hands);
  if (rust) {
    const searched = rust.cheapestWriting(moves, wide.join(""), slice.join(""), fresh, before, limit);
    if (!searched) return { found: null, kept: -Infinity, pruned: Infinity };
    const result = { found: searched.found ? { text: searched.text, cost: searched.cost } : null, kept: searched.kept, pruned: searched.pruned };
    searched.free();
    return result;
  }
  const plan = writingPlan(turns, wide, slice);
  if (!plan) return { found: null, kept: -Infinity, pruned: Infinity };
  const ready = readyFor(hands);
  // The least the turns from each place on can cost, whatever the writing
  const any = (ready.any ??= anyFloors(hands, ready));
  const rest = new Array<number>(turns.length + 1).fill(0);
  for (let at = turns.length - 1; at >= 0; at--) rest[at] = rest[at + 1] + (turns[at].endsWith("2") ? any.half : any.quarter);
  const { classes } = ready;
  const size = STATES * classes;
  // Layers that cost more to turn again, each a bit of a place's `turned`; what a turn of a layer pays when its bit is set
  const layers = Object.keys(hands.again);
  const againCost = (turned: number, bit: number) => (bit >= 0 && turned & (1 << bit) ? hands.again[layers[bit]] : 0);
  // The moves made first, as evaluate makes them: both hands start at home with every finger in place
  let costs = new Array<number>(size).fill(Infinity);
  costs[HOME_STATE * classes] = 0;
  let started = false;
  let turned = 0;
  // The move made last (null = none yet, or one the model can't read): the next one may keep its rhythm
  let last: Turn | null = null;
  // Which of R and L are a quarter turn off the middle layer so far
  let apart = 0;
  for (const turn of before.split(/\s+/).filter(Boolean).map(readTurn)) {
    const next = new Array<number>(size).fill(Infinity);
    const rotation = turn !== null && ROTATIONS.includes(turn.layer);
    const bit = turn && !rotation ? layers.indexOf(turn.layer) : -1;
    advance(hands, ready, turn, costs, fresh && !started, fresh && !started, againCost(turned, bit) + leaveAfter(hands, last, turn), openCost(hands, turn, apart), flowAfter(hands, last, turn), (to, total) => {
      if (total < next[to]) next[to] = total;
    });
    if (!rotation) started = true;
    // A rotation starts the layers turned again over (as evaluate counts them)
    if (rotation) turned = 0;
    if (bit >= 0) turned |= 1 << bit;
    costs = next;
    last = turn;
    apart = apartAfter(turn, apart);
  }
  // The rhythm a move leaves for the next one: 1 = it's on a layer that flows, 2 = on a slow one, 0 = neither (a slice turn, a tilt, no move yet)
  const rhythmOf = (turn: Turn | null) => (!turn ? 0 : hands.flow[turn.layer] !== undefined ? 1 : hands.leave[turn.layer] !== undefined ? 2 : 0);
  // Places by how many of the answer's turns are made so far, then by frame, layers turned, the rhythm the last move leaves and which of R and L are off the middle layer
  const levels: Map<string, Place>[] = Array.from({ length: plan.length + 1 }, () => new Map<string, Place>());
  // The place on a level for these (made on first use)
  const placeOn = (level: Map<string, Place>, frame: string, turned: number, rhythm: number, apart: number): Place => {
    const key = `${frame}/${turned}/${rhythm}${apart}`;
    let place = level.get(key);
    if (!place) level.set(key, (place = { frame, turned, rhythm, apart, costs: new Array<number>(size).fill(Infinity), from: [], state: [], token: [] }));
    return place;
  };
  placeOn(levels[0], plan.home, turned, rhythmOf(last), apart).costs = costs;
  // The highest lower bound of a place gone on from, and the lowest of a place given up on
  let [kept, pruned] = [-Infinity, Infinity];
  // One token made from a place into the next one, which keeps the cheapest way into each of its states
  const make = (place: Place, next: Place, token: string, turn: Turn | null, first: boolean, again: number, open: number, flow: number): void => {
    advance(hands, ready, turn, place.costs, first, false, again, open, flow, (to, total, from) => {
      if (total >= next.costs[to]) return;
      next.costs[to] = total;
      next.from[to] = place;
      next.state[to] = from;
      next.token[to] = token;
    });
  };
  for (let at = 0; at < plan.length; at++) {
    // Regrips before a solve's first turn cost less
    const first = fresh && !started && at === 0;
    // Each way to go on from a place leads to a place further on
    for (const place of levels[at].values()) {
      // No way on from here can come in under the limit: its cheapest hand state plus the least the turns left cost is over it
      const least = Math.min(...place.costs) + rest[at];
      if (limit < Infinity && least > limit + 1e-6) {
        pruned = Math.min(pruned, least);
        continue;
      }
      kept = Math.max(kept, least);
      for (const option of plan.optionsAt(at, place.frame)) {
        const turn = readTurn(option.token);
        const bit = turn ? layers.indexOf(turn.layer) : -1;
        const after = bit >= 0 ? place.turned | (1 << bit) : place.turned;
        const next = placeOn(levels[at + option.covers], option.frame, after, rhythmOf(turn), apartAfter(turn, place.apart));
        // A turn after a move that flows keeps its rhythm when its own layer flows too; one on a slow layer leaves it, unless the move before was on one too
        const leave = turn && place.rhythm !== 2 ? (hands.leave[turn.layer] ?? 0) : 0;
        make(place, next, option.token, turn, first, againCost(place.turned, bit) + leave, openCost(hands, turn, place.apart), place.rhythm === 1 && turn ? (hands.flow[turn.layer] ?? 0) : 0);
      }
    }
  }
  // The cheapest end state with its hands brought back home, over the places the answer can end in (all held as it started)
  let best: { place: Place; state: number; total: number } | null = null;
  for (const place of levels[plan.length].values()) {
    for (let state = 0; state < size; state++) {
      const total = place.costs[state] + hands.lastRegrip * HANDS_MOVED[Math.floor(state / classes) * STATES + HOME_STATE];
      if (!best || round(total) < round(best.total)) best = { place, state, total };
    }
  }
  if (!best || best.total === Infinity) return { found: null, kept, pruned };
  // Walk back from it, one token per place
  const tokens: string[] = [];
  for (let { place, state } = best; place.from[state]; [place, state] = [place.from[state], place.state[state]]) tokens.unshift(place.token[state]);
  return { found: { text: tokens.join(" "), cost: round(best.total) }, kept, pruned };
}

// The least a turn can cost: its cheapest trick from any hand position, a reach's finger regrip and the layer's own cost included (`other` when no
// trick makes it); worked out once per model and turn
function turnFloor(turn: Turn, hands: HandModel, ready: Ready): number {
  const key = `${turn.layer}${turn.quarters}${turn.wide ? "w" : ""}`;
  let floor = ready.floors.get(key);
  if (floor === undefined) {
    floor = Infinity;
    for (const ways of waysOf(turn, hands, ready)) for (const way of ways) floor = Math.min(floor, way.cost + (way.reach ? hands.fingerRegrip : 0));
    if (floor === Infinity) floor = hands.other;
    ready.floors.set(key, floor);
  }
  return floor;
}

// A lower bound of a move sequence's speed cost, from its text alone (no search over hand positions, so about a hundred times quicker than the cost):
// each turn at its cheapest trick, with everything it pays or saves whoever makes it (a layer turned again, the rhythm, an open opposite layer), and
// no regrip, awkward grip or way home at all. A step ranked by speed uses it to leave unscored the answers that can't beat the ones it has
export function speedFloor(moves: string, hands: HandModel = HANDS, fresh = false): number {
  // In Rust once it's loaded
  const rust = rustFor(hands);
  if (rust) return rust.floor(moves, fresh);
  const ready = readyFor(hands);
  const turned = new Set<string>();
  let total = 0;
  let started = false;
  let last: Turn | null = null;
  let apart = 0;
  for (const token of moves.split(/\s+/).filter(Boolean)) {
    const turn = readTurn(token);
    if (turn && ROTATIONS.includes(turn.layer)) {
      // A rotation: free before a solve's first turn, otherwise a tilt at best (x) or a rotation (a half turn costs more)
      const rotation = turn.quarters === 2 ? hands.rotation.half : hands.rotation.quarter;
      if (!(fresh && !started)) total += turn.layer === "x" ? Math.min(rotation, hands.tilt * (turn.quarters === 2 ? 2 : 1)) : rotation;
      // It starts the layers turned again and the open layers over, as evaluate does (or the floor could be above the cost)
      turned.clear();
      apart = apartAfter(turn, apart);
      last = turn;
      continue;
    }
    started = true;
    if (turn) {
      // What the turn pays for a layer turned again, for leaving the rhythm and for an open opposite layer, less what it saves by keeping the rhythm
      const again = turned.has(turn.layer) ? (hands.again[turn.layer] ?? 0) : 0;
      turned.add(turn.layer);
      total += turnFloor(turn, hands, ready) + again + leaveAfter(hands, last, turn) + openCost(hands, turn, apart) - flowAfter(hands, last, turn);
      apart = apartAfter(turn, apart);
    } else total += hands.other;
    last = turn;
  }
  return total;
}

// The least any quarter turn and any half turn of an answer can cost in any writing: a face turn at its cheapest and in rhythm, or half a slice turn
// (which makes two of the answer's turns)
function anyFloors(hands: HandModel, ready: Ready): { quarter: number; half: number } {
  const flow = Math.max(0, ...Object.values(hands.flow));
  const least = (quarters: number) =>
    Math.min(
      ...["U", "D", "L", "R", "F", "B"].map((layer) => turnFloor({ layer, wide: false, quarters }, hands, ready) - flow),
      ...["M", "E", "S"].map((layer) => turnFloor({ layer, wide: false, quarters }, hands, ready) / 2),
    );
  return { quarter: Math.min(least(1), least(3)), half: least(2) };
}

// A lower bound of what cheapestWriting can give for an answer (plain face turns) after its grip rotation: no writing of it is cheaper
export function writingFloor(moves: string, hands: HandModel = HANDS, fresh = false, before = ""): number {
  // In Rust once it's loaded
  const rust = rustFor(hands);
  if (rust) return rust.writingFloor(moves, fresh, before);
  const ready = readyFor(hands);
  const any = (ready.any ??= anyFloors(hands, ready));
  let total = speedFloor(before, hands, fresh);
  for (const token of moves.split(/\s+/).filter(Boolean)) total += token.endsWith("2") ? any.half : any.quarter;
  return total;
}

// True when a move sequence turns R or L while the opposite one is a quarter turn off the middle layer (see HandModel.open): a strained answer, however
// the hands grip it
export function strained(moves: string, hands: HandModel = HANDS): boolean {
  let apart = 0;
  for (const turn of moves.split(/\s+/).filter(Boolean).map(readTurn)) {
    if (openCost(hands, turn, apart) > 0) return true;
    apart = apartAfter(turn, apart);
  }
  return false;
}

// A cost to two decimals (sums of tenths drift otherwise)
function round(cost: number): number {
  return Math.round(cost * 100) / 100;
}

// The cheapest fingering of a move sequence, from both hands at home (regrips before the first turn cost less: they're done while still looking at the cube)
// and back to home (each hand that ends somewhere else pays for coming back, so of two equal ways the one ending nearer home wins).
// `fresh` = nothing was turned before these moves (they start a solve), so rotations before their first turn are free: the cube is picked up that way.
// `starts` = where each step starts when the moves are a joined solve (see joinStep): a layer turned again, or opposite R or L, counts from there
export function fingering(moves: string, hands: HandModel = HANDS, fresh = false, starts: number[] = []): Fingering {
  return evaluate(moves, hands, fresh, true, starts);
}

// A move sequence's speed cost: its cheapest fingering's (lower = faster to turn); `fresh` and `starts` as for fingering
export function speedCost(moves: string, hands: HandModel = HANDS, fresh = false, starts: number[] = []): number {
  // In Rust once it's loaded
  const rust = rustFor(hands);
  if (rust) return rust.cost(moves, fresh, starts.length ? Uint32Array.from(starts) : NO_STARTS);
  return evaluate(moves, hands, fresh, false, starts).cost;
}

// Speed costs of moves a step comes after, per model, by their step starts and text: a step scores many answers after the same moves (started over when it gets big)
const costsBefore = new WeakMap<HandModel, Map<string, number>>();

// The speed cost of moves a step comes after: a solve's moves so far, so nothing was turned before them (`starts`: where each of its steps starts)
function costBefore(moves: string, hands: HandModel, starts: number[]): number {
  let costs = costsBefore.get(hands);
  if (!costs || costs.size > 1000) costsBefore.set(hands, (costs = new Map()));
  const key = `${starts.join(",")}/${moves}`;
  let cost = costs.get(key);
  if (cost === undefined) costs.set(key, (cost = speedCost(moves, hands, true, starts)));
  return cost;
}

// What a step saves when its first turns cancel into the moves before it (`before`, a solve's moves so far as the hands make them, with where each of
// its steps starts; `kept`, the part of them that stays, see cancelInto): what those moves no longer turn. The step costs what's left of it (cancelInto's `rest`) less this
export function cancelSaving(before: string, kept: string, hands: HandModel = HANDS, starts: number[] = []): number {
  return round(costBefore(before, hands, starts) - costBefore(kept, hands, starts));
}

// A step's speed cost after the moves before it (`before`, a solve's moves so far as the hands make them, `starts` where each of their steps starts):
// where its first turns cancel into their last ones (R then R', U then y U', see joinSteps), what's left of it less what those moves no longer turn;
// otherwise its own speedCost. `fresh` as for speedCost
export function speedCostAfter(moves: string, before: string, hands: HandModel = HANDS, fresh = false, starts: number[] = []): number {
  const cut = before ? cancelInto(before, moves) : null;
  return cut ? round(speedCost(cut.rest, hands, fresh) - cancelSaving(before, cut.kept, hands, starts)) : speedCost(moves, hands, fresh);
}

// Where a hand's thumb is at each wrist position, for text
export const THUMBS: Record<Wrist, string> = { down: "thumb on the bottom", home: "thumb on the front", up: "thumb on top" };

// A fingering as one line: each move with the hand and finger that makes it (wrist turns stay bare), regrips in between and hands coming back home at the end,
// e.g. "R' · F (right index) · R · F' (left index)"
export function fingeringText(result: Fingering): string {
  return result.steps
    .flatMap((step) => [
      // Regrips before the move
      ...step.regrips.map((regrip) => `regrip ${regrip.hand}: ${THUMBS[regrip.to]}`),
      // The move: bare for a wrist turn, otherwise with who makes it (or why nobody does)
      step.finger === "wrist" ? step.move : `${step.move} (${step.hand ? `${step.hand} ${step.finger}` : step.finger === "other" ? "no trick" : step.finger})`,
    ])
    // Hands that come back home after the last move
    .concat(result.ending.map((end) => `${end.hand} back home`))
    .join(" · ");
}
