// The speed bound a step's lists prune with (a step ranked by speed): what the search worker needs to tell, from an answer's first turns, that no way the
// hands could make it can come in under the step's bar, so it isn't listed at all (see search/src/split/bound.rs). A step whose lists were cut short
// (by its cap on answers or its node budget) lists the rest this way, so what it may still list and search goes to answers that could beat its pick,
// not to the next ones in turn order: in the F2L case of the triple sexy, 1,815 answers of up to 11 turns come before the back slot's triple sexy in
// turn order. Nothing it leaves out could have come in under the bar: each turn counts at least what any writing of it can cost (as held in the grip and
// each twin, made as a wide or slice turn, with a rotation between, as the step's axes allow), turns that may cancel into the moves before the step count
// nothing and what that could save comes off, and a path that could still give a grip its first clean answer is followed anyway (the ranking puts an
// answer on the faces to avoid after any clean one held the same way)

// Move text helpers
import { joinMoves, shortRotations } from "../core/moves";
// Floors of what the hands make, what cancelling into the moves before saves, and where a writing may start
import { cancelSaving, speedFloor, tokenFloors, writingStarts } from "../speed/fingering";
// Frames rotations hold the cube in
import { frameAfter, undoRotations } from "../speed/writings";
// Engine data shapes
import type { StepOptions } from "../types";
// One alternative × grip of a step
import type { Combo } from "./combo";

// What a list request carries for its bound (see bound.rs): the bar; the least a turn left can cost; each token's floor; the axes wide turns, slice
// turns and rotations may turn about; each way to hold the cube at the start (a frame, see writings.ts) with its cost; the moves before the step as runs
// of turns about one axis from the end ([axis: 0 = x, 1 = y, 2 = z, where the run starts]), how many of them stay when nothing joins them, the most
// joining them could save from each place on; and the grips no clean answer was given in yet (each as the frames its answers may be made in) with the
// faces to avoid
export interface SpeedBoundData {
  bar: number;
  least: number;
  floors: Record<string, number>;
  wide: string;
  slice: string;
  rotation: string;
  starts: [string, number][];
  runs: [number, number][];
  kept: number;
  credit: number[];
  holds: string[][];
  avoid: string;
}

// A step's bar, the grips some clean answer was given in so far, and the least any answer pays for finding pieces (see Scorer.limit)
export interface Limit {
  bar: number;
  clean: string[];
  look: number;
}

// A plain face turn
const FACE = /^[URFDLB]$/;
// Each face's axis (0 = x, 1 = y, 2 = z)
const AXIS_OF: Record<string, number> = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
// The sides of a frame, in order
const SIDES = "UDRLFB";
// A move the hands make: its family (a wide turn as Rw or r), a count and a prime
const MOVE = /^([UDLRFBMESxyz]|[UDLRFB]w|[udlrfb])(\d*)('?)$/;
// What a turn on more than one layer turns, per quarter turn clockwise: the side of a face it turns, as held before it, and the rotation it makes (as faces.ts's PARTS)
const PARTS: Record<string, [string, string]> = { r: ["L", "x"], l: ["R", "x'"], u: ["D", "y"], d: ["U", "y'"], f: ["B", "z"], b: ["F", "z'"], M: ["R", "x'"], E: ["U", "y'"], S: ["B", "z"] };
// The rotation tokens about one axis
const TURNS_OF = (axis: string) => [axis, `${axis}'`, `${axis}2`];
// The rotations a hands text starts with (the grip its answer is held in, as the ranking tells clean grips apart)
const HOLD = /^((?:[xyz]\S* ?)*)/;
// Most grips a bound keeps apart (one bit each in the search)
const MAX_HOLDS = 64;

// A rotation given for one quarter turn clockwise, made `quarters` times (1–3)
function turned(rotation: string, quarters: number): string {
  if (quarters === 2) return `${rotation[0]}2`;
  return (quarters === 3) === rotation.endsWith("'") ? rotation[0] : `${rotation[0]}'`;
}

// The moves before a step as runs of turns about one axis, from the end, each axis as the step's grip (`rotation`) names it, with where each run starts
// (rotations in between don't end a run), and where the rotations they end with start (null: they end with a turn)
function runsBefore(previous: string, rotation: string): { runs: [number, number][]; trailing: number | null } {
  const tokens = previous.split(/\s+/).filter(Boolean);
  // Each face as the moves end on the side the grip rotation puts it on
  const grip = frameAfter(rotation);
  const axisInGrip = (face: string) => AXIS_OF[SIDES[grip.indexOf(face)]];
  // Each side's face as the moves end, going back through them
  let frame = SIDES;
  const runs: [number, number][] = [];
  let trailing: number | null = null;
  for (let at = tokens.length - 1; at >= 0; at--) {
    const match = MOVE.exec(tokens[at]);
    // A move the joining can't read: going on past it only lowers the bound
    if (!match) continue;
    const [, family, count, prime] = match;
    const quarters = ((((count ? Number(count) : 1) * (prime ? -1 : 1)) % 4) + 4) % 4;
    if (!quarters) continue;
    const key = family.length === 2 ? family[0].toLowerCase() : family;
    if ("xyz".includes(key)) {
      frame = frameAfter(undoRotations(turned(key, quarters)), frame);
      if (!runs.length) trailing = at;
      continue;
    }
    // A wide or slice turn's face is read as the cube was held before it
    const part = PARTS[key];
    if (part) frame = frameAfter(undoRotations(turned(part[1], quarters)), frame);
    const axis = axisInGrip(frame[SIDES.indexOf(part ? part[0] : key)]);
    if (runs.length && runs[runs.length - 1][0] === axis) runs[runs.length - 1][1] = at;
    else runs.push([axis, at]);
  }
  return { runs, trailing };
}

// The most cancelling into the moves before could save once they're cut back to each length (see cancelSaving: any cut at that length or longer), from
// `from` on (no joining reaches shorter ones), worked out once per moves before (lookahead asks again for each candidate)
const credits = new Map<string, number[]>();
function creditFrom(previous: string, starts: number[] | undefined, from: number): number[] {
  const key = `${from}/${starts?.join(",")}/${previous}`;
  let credit = credits.get(key);
  if (!credit) {
    if (credits.size > 200) credits.clear();
    const tokens = previous.split(/\s+/).filter(Boolean);
    credit = new Array<number>(tokens.length + 1).fill(0);
    for (let cut = tokens.length - 1; cut >= from; cut--) credit[cut] = Math.max(credit[cut + 1], cancelSaving(previous, tokens.slice(0, cut).join(" "), undefined, starts));
    credit.fill(credit[from], 0, from);
    credits.set(key, credit);
  }
  return credit;
}

// A combo's bound for its lists, given the step's bar and clean grips at the time of each list (null: none, when the step searches with moves that
// aren't plain face turns); `deepest` = the longest answer it lists
export function speedBound(combo: Combo, options: StepOptions, deepest: number): ((limit: Limit) => SpeedBoundData | undefined) | null {
  if (!(options.generatorMoves ?? ["U"]).every((move) => FACE.test(move))) return null;
  // As the scoring reads the step's options (see makeScorer)
  const fresh = !options.done?.trim();
  const wideAxes = options.wideAxes ?? [];
  const sliceAxes = options.sliceAxes ?? wideAxes;
  const rotationAxes = options.rotationAxes ?? wideAxes;
  const writtenAxes = [...new Set([...wideAxes, ...sliceAxes])];
  const avoid = options.avoid ?? [];
  const floors = tokenFloors();
  // The least a turn can cost: a face or wide turn at its floor, or half a slice turn
  const least = Math.min(...Object.entries(floors).filter(([token]) => !"xyz".includes(token[0])).map(([token, floor]) => ("MES".includes(token[0]) ? floor / 2 : floor)));
  // The moves before the step: how far cancelling into them could reach, and what it could save
  const previous = options.previous ?? "";
  const { runs, trailing } = runsBefore(previous, combo.rotation);
  const length = previous.split(/\s+/).filter(Boolean).length;
  const kept = trailing ?? length;
  const from = Math.min(kept, runs.length ? runs[Math.min(deepest, runs.length - 1)][1] : kept);
  const credit = previous ? creditFrom(previous, options.previousStarts, from) : [0];
  // The cube as held before the grip rotation, in the combo's frame; the grip and its twins, each as a frame with the rotations that make it
  const held = frameAfter(undoRotations(combo.rotation));
  const helds = [combo, ...(combo.twins ?? [])].map((each) => ({ rotation: each.rotation, frame: frameAfter(each.rotation, held) }));
  const rotations = rotationAxes.flatMap(TURNS_OF);
  // Where an answer may start: as each grip holds it (its rotation paid for), where a writing may start instead, and with a rotation the step may make
  // first joined to the grip's (the rotations the moves before end with may join it too: then nothing is paid)
  const starts = new Map<string, number>();
  const start = (frame: string, cost: number) => starts.set(frame, Math.min(starts.get(frame) ?? Infinity, trailing === null ? cost : 0));
  for (const { rotation, frame } of helds) {
    start(frame, speedFloor(rotation, undefined, fresh));
    for (const other of writingStarts(fresh, rotation, writtenAxes)) start(frameAfter(other.rotations, held), speedFloor(other.rotations, undefined, fresh));
    for (const more of rotations) start(frameAfter(more, frame), speedFloor(shortRotations(joinMoves(rotation, more)), undefined, fresh));
  }
  // Each grip an answer may be held in for the ranking (the rotations its text starts with) and the frames its turns may be made in
  const grips = new Map<string, Set<string>>();
  if (avoid.length) {
    for (const { rotation, frame } of helds) {
      const frames = rotations.length ? [frame, ...rotations.map((more) => frameAfter(more, frame))] : [frame];
      for (const text of [joinMoves(rotation, "U"), ...rotations.map((more) => shortRotations(joinMoves(rotation, more, "U")))]) {
        const grip = HOLD.exec(text)![1].trim();
        grips.set(grip, new Set([...(grips.get(grip) ?? []), ...frames]));
      }
    }
  }
  return ({ bar, clean, look }) => {
    const holds = [...grips].filter(([grip]) => !clean.includes(grip)).map(([, frames]) => [...frames]);
    // No bar yet, or more grips than the search keeps apart: nothing is left out
    if (bar === Infinity || holds.length > MAX_HOLDS) return undefined;
    // What finding pieces costs every answer comes on top of its turns, so the turns have that much less to come in under
    return { bar: bar - look, least, floors, wide: wideAxes.join(""), slice: sliceAxes.join(""), rotation: rotationAxes.join(""), starts: [...starts], runs, kept, credit, holds, avoid: avoid.join("") };
  };
}
