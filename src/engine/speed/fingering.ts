// Speed model, the evaluator: the cheapest way for two hands to make a move sequence (finger tricks, wrist turns, finger regrips and hand regrips), and who makes each move

// The hand map, its wrist positions and its fingers
import { type HandModel, type Wrist, type Finger, HANDS, WRISTS, trickName } from "./hands";

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
  awkward: number; // added because the move is made with both hands away from home, the wrists turned the same way (0 = it isn't)
  twisted: number; // added because the move is made from, or ends in, a twisted grip: the wrists turned opposite ways (0 = it isn't)
  again: number; // added because the sequence turned this layer before, for layers that are slow to turn again and again (0 = not so)
  regrips: { hand: Hand; to: Wrist; cost: number }[]; // hands that take the cube again at another wrist position before the move
  others: FingerWay[]; // the other ways to make the move from the same hand position, cheapest first
  wrists: Record<Hand, Wrist>; // wrist positions after the move
}

// A move sequence's cheapest fingering: its cost in easy turns (R or a U flick = 1, regrips and the way back home included), its hand regrips between the moves,
// one step per move, and the hands that have to come back home after the last one
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

// A model made ready for the search, once: each hand's reach per wrist position, and every set of fingers its tricks use. A state's class says whose fingers
// the last move left out of place: 0 = nobody's, then one per hand and set
interface Ready {
  reach: Record<Hand, Reach[]>;
  sets: number[];
  classes: number;
}

// Models made ready so far
const readied = new WeakMap<HandModel, Ready>();

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
    ready = { reach, sets, classes: 1 + BOTH.length * sets.length };
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
      ways.push({ hand, finger: "wrist", cost, state: after, side: BOTH.indexOf(hand), fingers: 0, reach: false, class: 0 });
    }
    return ways;
  }
  // Any other turn is a finger trick of either hand, which leaves both wrists where they are
  const name = turn.layer + SUFFIXES[turn.quarters];
  BOTH.forEach((hand, side) => {
    for (const trick of ready.reach[hand][at[hand]].get(name) ?? []) {
      ways.push({ hand, finger: trick.finger, cost: trick.cost + extra, state, side, fingers: trick.fingers, reach: trick.reach, class: 1 + side * ready.sets.length + ready.sets.indexOf(trick.fingers) });
    }
  });
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

// How one state after a move was reached: the state before the move, the wrist state the move was made from (after any regrips), whether those regrips came
// before the first turn, who made the move, what it cost on its own, and its surcharges for an awkward or a twisted grip, for finger regrips and for turning its layer again
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
}

// The search behind fingering and speedCost. A state is the wrists and the class of the last move (wrists * classes + class); with `trace` off only the cost is worked out
function evaluate(moves: string, hands: HandModel, fresh: boolean, trace: boolean): Fingering {
  const ready = readyFor(hands);
  const { classes } = ready;
  const size = STATES * classes;
  const tokens = moves.split(/\s+/).filter(Boolean);
  const turns = tokens.map(readTurn);
  // What each move pays for turning a layer the sequence turned before (only for the layers the model lists; the same whoever makes the move)
  const turned = new Set<string>();
  const agains = turns.map((turn) => {
    if (!turn || ROTATIONS.includes(turn.layer)) return 0;
    const again = turned.has(turn.layer) ? (hands.again[turn.layer] ?? 0) : 0;
    turned.add(turn.layer);
    return again;
  });
  // Cheapest cost of each state after the moves so far (Infinity = can't be in it): both hands start at home with every finger in place
  let costs = new Array<number>(size).fill(Infinity);
  costs[HOME_STATE * classes] = 0;
  // Per move, each state's link back to the state before it
  const trail: (Link | null)[][] = [];
  // Whether a turn was made yet
  let started = false;
  for (const [index, turn] of turns.entries()) {
    const before = costs;
    const again = agains[index];
    const next = new Array<number>(size).fill(Infinity);
    const links = trace ? new Array<Link | null>(size).fill(null) : null;
    // Keep the cheaper of two ways into a state (its link only when tracing)
    const offer = (to: number, total: number, link: () => Link): void => {
      if (total >= next[to]) return;
      next[to] = total;
      if (links) links[to] = link();
    };
    // States the hands can be in before this move
    const open: number[] = [];
    for (let state = 0; state < size; state++) if (before[state] < Infinity) open.push(state);
    if (turn && ROTATIONS.includes(turn.layer)) {
      // A rotation: both hands let go and take the cube again at home (free while the solve hasn't started)
      const cost = fresh && !started ? 0 : hands.rotation;
      for (const from of open) offer(HOME_STATE * classes, before[from] + cost, () => ({ from, via: Math.floor(from / classes), first: !started, hand: null, finger: "rotation", cost, awkward: 0, twisted: 0, fingers: 0, again: 0 }));
      // A tilt: an x turn the wrists make together without letting go, where both can go that way (x takes both a step up, x' a step down, x2 two steps)
      if (turn.layer === "x") {
        for (const step of turn.quarters === 2 ? [2, -2] : [turn.quarters === 1 ? 1 : -1]) {
          for (const from of open) {
            const wrists = Math.floor(from / classes);
            const [right, left] = [wristsOf(wrists).right + step, wristsOf(wrists).left + step];
            if (Math.min(right, left) < 0 || Math.max(right, left) >= WRISTS.length) continue;
            // Free when it brings both hands home (they're already holding the cube that way), otherwise the wrists have to bend to make it
            const tilt = right * WRISTS.length + left === HOME_STATE ? 0 : hands.tilt * Math.abs(step);
            offer((right * WRISTS.length + left) * classes, before[from] + tilt, () => ({ from, via: wrists, first: !started, hand: null, finger: "tilt", cost: tilt, awkward: 0, twisted: 0, fingers: 0, again: 0 }));
          }
        }
      }
    } else {
      // A turn: from each open state, regrip to any wrist state (or stay) and make the turn any way that state allows
      const first = !started;
      for (let via = 0; via < STATES; via++) {
        const ways = turn ? waysFrom(turn, via, hands, ready) : [];
        if (!ways.length) continue;
        for (const from of open) {
          const pair = Math.floor(from / classes) * STATES + via;
          const [moved, home] = [HANDS_MOVED[pair], HOME_REGRIPS[pair]];
          // Before the first turn the hands leave home: the first one cheaply, a second one at the full price
          const regrips = first ? (moved ? hands.firstRegrip + hands.regrip * (moved - 1) : 0) : hands.regripHome * home + hands.regrip * (moved - home);
          const base = before[from] + regrips + again;
          for (const way of ways) {
            const fingers = fingerCost(hands, ready, from % classes, way, (REGRIPPED[pair] & (1 << way.side)) !== 0);
            // A move made from a twisted grip, or ending in one, costs more; so does one made with both hands away from home, a little less
            const twisted = TWISTED[via] || TWISTED[way.state] ? hands.twisted : 0;
            const awkward = !twisted && BOTH_AWAY[via] ? hands.awkward : 0;
            offer(way.state * classes + way.class, base + way.cost + fingers + awkward + twisted, () => ({ from, via, first, hand: way.hand, finger: way.finger, cost: way.cost, awkward, twisted, fingers, again }));
          }
        }
      }
      // No trick makes it from any state (E2, S2, a move the model can't read): it costs `other` and leaves the hands where they are
      if (next.every((cost) => cost === Infinity)) {
        for (const from of open) {
          const wrists = Math.floor(from / classes);
          const twisted = TWISTED[wrists] ? hands.twisted : 0;
          const awkward = !twisted && BOTH_AWAY[wrists] ? hands.awkward : 0;
          offer(wrists * classes, before[from] + hands.other + awkward + twisted + again, () => ({ from, via: wrists, first, hand: null, finger: "other", cost: hands.other, awkward, twisted, fingers: 0, again }));
        }
      }
      started = true;
    }
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
      again: link.again,
      regrips: regripsBetween(Math.floor(link.from / classes), link.via).map((regrip, second) => ({ ...regrip, cost: regripCost(hands, regrip.to, link.first, second > 0) })),
      others: others.map(({ hand, finger, cost, reach }) => ({ hand, finger, cost: round(cost + (reach ? hands.fingerRegrip : 0)) })).sort((a, b) => a.cost - b.cost),
      wrists: { right: WRISTS[at.right], left: WRISTS[at.left] },
    });
    state = link.from;
  }
  return { cost: round(total), regrips: steps.reduce((sum, step) => sum + step.regrips.length, 0), steps, ending };
}

// A cost to two decimals (sums of tenths drift otherwise)
function round(cost: number): number {
  return Math.round(cost * 100) / 100;
}

// The cheapest fingering of a move sequence, from both hands at home (regrips before the first turn cost less: they're done while still looking at the cube)
// and back to home (each hand that ends somewhere else pays for coming back, so of two equal ways the one ending nearer home wins).
// `fresh` = nothing was turned before these moves (they start a solve), so rotations before their first turn are free: the cube is picked up that way
export function fingering(moves: string, hands: HandModel = HANDS, fresh = false): Fingering {
  return evaluate(moves, hands, fresh, true);
}

// A move sequence's speed cost: its cheapest fingering's (lower = faster to turn); `fresh` as for fingering
export function speedCost(moves: string, hands: HandModel = HANDS, fresh = false): number {
  return evaluate(moves, hands, fresh, false).cost;
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
