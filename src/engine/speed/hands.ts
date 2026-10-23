// Speed model, the hand map: the turns each finger can make at each wrist position and what they cost (1 = an easy turn); all of it is data, so it can be tuned

// Where a hand's thumb sits, which says how far its wrist is turned: down = on the bottom (the right hand after R'), home = on the front, up = on top (after R)
export type Wrist = "down" | "home" | "up";

// Wrist positions in the order a wrist turn goes through them (R takes the right hand one step up)
export const WRISTS: Wrist[] = ["down", "home", "up"];

// A finger
export type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";

// One finger trick: the turn it makes, the fingers that make it and its cost
export interface Trick {
  turn: string; // e.g. "U", "U2", "F'"
  fingers: Finger[]; // the fingers that make it (they're out of their place right after it)
  push?: boolean; // the finger pushes the layer (it pulls otherwise)
  reach?: boolean; // the finger first leaves its place to get to the turn: a finger regrip, added to the cost
  cost: number; // the turn itself, without finger regrips
}

// The whole model: the right hand's tricks at each wrist position (the left hand's are their mirror image), and what everything else costs
export interface HandModel {
  tricks: Record<Wrist, Trick[]>; // a turn may have several tricks at one position: the cheapest is used, the others are shown as its other ways
  wrist: { quarter: number; half: number }; // a wrist turn: R, R' / R2 with the right hand, L, L' / L2 with the left
  wide: { wrist: number; finger: number }; // added to a wide turn on top of the finger regrip every wide turn takes (the hand opens, or the finger moves over, to take a second layer along): one the wrist makes (Rw, Lw), and one a finger makes on two layers (Uw, Fw…; never a thumb)
  layers: Record<string, number>; // added to every turn of a layer, by how well it turns: nothing for R and U, a little for L (the weaker hand's wrist), more for F and D, most for B
  flow: Record<string, number>; // taken off a turn of a layer made right after a turn of one of these layers, no regrip between: the hands keep their rhythm, so runs on R and U turn fastest (the most turns per second), runs with L a little less
  leave: Record<string, number>; // added to a turn of a layer that leaves that rhythm (D, B: the hand reaches under or behind the cube; F is turned by the fingers that turn U) unless the move before it was on one of these layers too, so once per run of such turns
  again: Record<string, number>; // added to a layer's turns after its first in a sequence (B once is a quick flick, B again and again isn't)
  regrip: number; // between turns, one hand lets go and takes the cube again at another wrist position
  regripHome: number; // the same when the hand comes back home (the easy way round)
  firstRegrip: number; // one hand's regrip before the first turn of a solve (done during inspection); a second hand regripping there pays `regrip`, and so does any regrip before a later step's first turn (the hands come straight from the step before)
  lastRegrip: number; // after the last turn, each hand that isn't at home (it has to come back before the next moves)
  fingerRegrip: number; // one finger goes somewhere else while the hand keeps its grip: to reach a turn (a `reach` trick, or any wide turn), or back to where the next move needs it
  awkward: number; // added to every move made from, or ending in, a grip with both hands away from home (both thumbs on top, or both on the bottom): L' with the right thumb still on top
  open: Record<string, number>; // added to a turn of R or L made while the opposite one is a quarter turn off (the L' of R U L'): the hand on that layer can't hold the rest still, whatever was turned in between and however it grips; less for R, the stronger wrist. A move that already pays for an awkward or a twisted grip pays only the bigger of the two (the same strain)
  twisted: number; // added instead to every move made from, or ending in, a grip with the wrists turned opposite ways (after R L or R' L': one thumb on top, the other on the bottom)
  rotation: { quarter: number; half: number }; // x, y or z with both hands letting go: they end at home (free before the first turn of a solve: the cube is picked up that way); a half turn (y2, x2, z2) turns the cube twice as far, so it's slower
  tilt: number; // an x turn the wrists make together without letting go, per quarter turn: both wrists go a step up (x) or down (x'), the whole cube turning in them
  other: number; // a move no trick makes (E2, S2, notation the model can't read)
}

// A trick's name in a fingering: its fingers, and whether it's a push
export function trickName(trick: Pick<Trick, "fingers" | "push">): string {
  return trick.fingers.join(" + ") + (trick.push ? " push" : "");
}

// Costs by kind of trick, so one number tunes them all: a flick (a finger pulls the layer it lies on), a double flick (with the finger beside it, a half turn)
// and a push (the finger pushes that layer the other way; it has to get behind it first, so a push is always a reach). How well each layer turns is apart, in `layers`
const FLICK = 1;
const DOUBLE = 1.6;
const PUSH = 1.2;
// A thumb push costs more than a flick: a short drag by the finger the hand holds the cube with
const THUMB = 1.5;
// Added to a flick (or double flick) of the layer the hand's own thumb lies on, F with the thumb on the front and U with it on top: the thumb holds that
// layer and has to let go, so it's no plain flick and costs more than a push (at home the other hand's index finger pushes the same turn instead)
const AGAINST_THUMB = 0.5;

// A cost to two decimals (sums of tenths drift otherwise)
function tenths(cost: number): number {
  return Math.round(cost * 100) / 100;
}

// Tricks of the same fingers from a short list, turn → cost; `reach` = the finger has to leave its place to get to them (a finger regrip on top of the cost)
function tricks(fingers: Finger[], turns: Record<string, number>, reach = false): Trick[] {
  return Object.entries(turns).map(([turn, cost]) => ({ turn, fingers, cost: tenths(cost), ...(reach ? { reach } : {}) }));
}

// A finger's tricks on the layer it lies on: a flick (the turn given), a double flick with the finger beside it, and, only where the finger can get
// behind the layer (`pushes`), a push the other way; `extra` is added to each where the finger is weaker or the reach is awkward, and `against` to the
// flicks alone where they pull the layer the hand's own thumb lies on (see AGAINST_THUMB)
function layer(finger: Finger, beside: Finger, flick: string, extra = 0, pushes = false, against = 0): Trick[] {
  const push = flick.endsWith("'") ? flick.slice(0, -1) : `${flick}'`;
  return [
    { turn: flick, fingers: [finger], cost: tenths(FLICK + extra + against) },
    { turn: `${flick[0]}2`, fingers: [finger, beside], cost: tenths(DOUBLE + extra + against) },
    ...(pushes ? [{ turn: push, fingers: [finger], push: true, reach: true, cost: tenths(PUSH + extra) }] : []),
  ];
}

// The default hands (first guesses, to be tuned against real solving). The three fingers keep their tricks as the wrist turns, on whichever layers they then lie on:
// the index finger's U tricks become F tricks with the thumb on the bottom and B tricks with it on top, the ring finger's D tricks become B and F tricks.
// Pushes don't follow: a finger can only push a layer it reaches from behind (U and D at home, and U for the index finger with the thumb on top), or F'
// at home, where the index finger reaches over the top.
// Tricks a finger has to leave its place for are reaches (a finger regrip each): F at home with the index finger or the thumb, every slice turn, every push.
// Every wide turn takes a finger regrip too (see fingering.ts), so only wrist turns and plain flicks (and double flicks) turn without one
export const HANDS: HandModel = {
  tricks: {
    // Thumb on the bottom (after R'): the fingers lie over the top, index on F, middle beside the S slice, ring on B, and each pulls its layer down the right side
    down: [...layer("index", "middle", "F"), ...tricks(["middle"], { S: FLICK }, true), ...layer("ring", "pinky", "B'")],
    // Thumb on the front: the fingers lie on the back, index on U, middle beside the E slice, ring on D, and each pulls its layer round to the right;
    // the index finger also reaches over the top to F, where it pushes F' or pulls F against its own thumb (slower), the thumb pushes F up, and the
    // middle slice is turned from behind (or by the thumb)
    home: [
      ...layer("index", "middle", "U", 0, true),
      ...tricks(["index"], { F: FLICK + AGAINST_THUMB, M: FLICK }, true),
      { turn: "F'", fingers: ["index"], push: true, reach: true, cost: PUSH },
      ...tricks(["middle"], { "E'": FLICK + 0.1 }, true),
      ...layer("ring", "pinky", "D'", 0, true),
      ...tricks(["ring"], { "M'": FLICK }, true),
      ...tricks(["ring", "middle"], { M2: DOUBLE }, true),
      ...tricks(["thumb"], { "F'": THUMB, "M'": THUMB }, true),
    ],
    // Thumb on top (after R): the fingers lie under the cube, index on B, middle beside the S slice, ring on F, and each pulls its layer up the right side;
    // the index finger also still reaches U (the U of R U R' U') from behind, where its flicks pull against its own thumb (slower, as F at home), and
    // with a longer reach D
    up: [
      ...layer("index", "middle", "B"),
      ...layer("index", "middle", "U", 0, true, AGAINST_THUMB),
      ...tricks(["index"], { "D'": FLICK }, true),
      ...tricks(["middle"], { "S'": FLICK + 0.2 }, true),
      ...layer("ring", "pinky", "F'"),
    ],
  },
  wrist: { quarter: 1, half: 1.4 },
  wide: { wrist: 0, finger: 0 },
  layers: { L: 0.25, F: 0.3, D: 0.4, B: 0.6 },
  flow: { R: 0.3, U: 0.3, L: 0.15 },
  leave: { D: 0.3, B: 0.3 },
  again: { B: 1 },
  regrip: 1.8,
  regripHome: 1,
  firstRegrip: 0.5,
  lastRegrip: 1,
  fingerRegrip: 0.6,
  awkward: 0.7,
  open: { L: 0.8, R: 0.3 },
  twisted: 1.2,
  rotation: { quarter: 3, half: 4.5 },
  tilt: 0.5,
  other: 2.5,
};
