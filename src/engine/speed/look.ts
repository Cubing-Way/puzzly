// Speed model, the eyes: what finding a step's pieces costs before its first turn (a pause the hands wait through), less when the pieces and the spots they
// go to are in sight; all of it is data, so it can be tuned. Only a method's steps ranked by speed pay it (a lone step has nothing before or after it)

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Piece names
import { PIECE_NAMES } from "../core/cube";
// Move text helpers
import { invertMoves } from "../core/moves";
// Roles, goal text and goal masks
import { readAlternatives, goalFromText, dropFree } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Engine data shapes
import type { Goal, Role, NextStep } from "../types";

// The whole model, in easy turns (1 = an R)
export interface LookModel {
  step: number; // a step after a solve's first one (that one is planned in inspection): finding its pieces when they and their spots are in plain sight
  hidden: number; // added when none of that is in sight (pieces and spots on the back and the bottom), in proportion when some is
  faces: Record<string, number>; // how much of a sticker on each face the solver sees with the cube held as it is (a piece is seen in full from two stickers)
  later: number; // ranking a step's own answers: how much every piece set the next step could take counts, against the easiest one (0 = only the easiest)
  flip: number; // a searched answer written with wide or slice turns (x2 … Rw2, M … Rw), when a step comes after it: they move the centers in its middle, so the next step's pieces the solver was tracking are somewhere else
  plan: number; // a solve's first step, planned in inspection: each piece its answer plans beyond the step's smallest alternative (an XCross's pair beyond the cross), so only an easy one pays off
  planHidden: number; // added to that per piece, in proportion to how much of it is out of sight on the scrambled cube (a pair on the back or the bottom is hard to track while planning)
}

// The default eyes (first guesses, to be tuned against real solving): U and F face the solver and R and L are seen at a slant, B and D not at all. So a pair
// in the front costs 2 to find after the pair before it, one in the back slot 3.5, and a whole step that a bigger first step (an XCross) did costs nothing.
// Turning the cube in the middle of an answer costs a look in plain sight: the pieces tracked during it are found again. Planning an XCross's pair in
// inspection costs 4 when it's in plain sight, up to 10 when it's out of sight
export const LOOK: LookModel = {
  step: 2,
  hidden: 3,
  faces: { U: 1, F: 1, R: 1, L: 1, B: 0, D: 0 },
  later: 0.5,
  flip: 2,
  plan: 2,
  planHidden: 3,
};

// A wide or slice turn in move text (Rw2, r', M, E, S…): it turns a middle layer, so the centers move
const WIDE_OR_SLICE = /(^|\s)([UDLRFB]w|[udlrfbMES])/;

// What an answer pays for turning the cube in its middle (see LookModel.flip): `hands` = as the hands make it, `plain` = as searched. It pays when the
// writing put wide or slice turns in (x2 … Rw2, or M … Rw that undo each other). Moves the step searched with (Roux's M) and tilts (x … x') don't pay
export function flipLook(hands: string, plain: string, look: LookModel = LOOK): number {
  return hands !== plain && WIDE_OR_SLICE.test(hands) ? look.flip : 0;
}

// Roles with a spot of their own to go to (the others go anywhere in a group, so only where the piece sits counts)
const HOMED: Role[] = ["solve", "place"];

// How much of a spot the solver sees, from its stickers' faces (0 = nothing, 1 = enough to know the piece)
function seen(spot: string, look: LookModel): number {
  return Math.min(1, [...spot].reduce((sum, face) => sum + (look.faces[face] ?? 0), 0) / 2);
}

// Pieces a goal holds, centers aside: how far a method run has got
export function pieceCount(goal: Goal): number {
  return Object.entries(goal).reduce((count, [orbit, roles]) => (orbit === "CENTERS" ? count : count + Object.keys(roles).length), 0);
}

// The pieces of `after` that `before` doesn't hold (centers aside)
export function newPieces(after: Goal, before: Goal): Goal {
  const fresh: Goal = {};
  for (const [orbit, roles] of Object.entries(after)) {
    if (orbit === "CENTERS") continue;
    const own = Object.entries(roles).filter(([piece]) => !before[orbit]?.[Number(piece)]);
    if (own.length) fresh[orbit] = Object.fromEntries(own);
  }
  return fresh;
}

// Where each piece sits on a held cube: a pattern, or only its pieces per orbit (all that finding pieces reads)
export type Spots = { patternData: Record<string, { pieces: number[] }> };

// How much of some pieces is out of sight on a held cube (0 = all in plain sight, 1 = none): where each piece sits (to find it) and, for a piece with a spot
// of its own, that spot (to see where it goes), averaged
export function hiddenShare(pattern: Spots, pieces: Goal, look: LookModel = LOOK): number {
  let hidden = 0;
  let parts = 0;
  for (const [orbit, roles] of Object.entries(pieces)) {
    if (orbit === "CENTERS") continue;
    const names = PIECE_NAMES[orbit];
    const spots = pattern.patternData[orbit].pieces;
    for (const [piece, role] of Object.entries(roles)) {
      // Where the piece sits now
      hidden += 1 - seen(names[spots.indexOf(Number(piece))], look);
      parts++;
      // Where it goes
      if (!HOMED.includes(role)) continue;
      hidden += 1 - seen(names[Number(piece)], look);
      parts++;
    }
  }
  return parts ? hidden / parts : 0;
}

// What finding a step's pieces costs, from how much of them is out of sight
export function lookCost(hidden: number, look: LookModel = LOOK): number {
  return look.step + look.hidden * hidden;
}

// A goal text's pieces, centers aside (they only set the frame)
function piecesOf(text: string): Goal {
  const goal = dropFree(goalFromText(text, false));
  delete goal.CENTERS;
  return goal;
}

// The pieces one of a step's alternatives adds beyond its smallest one (an XCross's pair beyond the cross), named as the alternative names them; none
// for the smallest one or a step with a single alternative
export function plannedExtra(pieces: string, alternative: number): Goal {
  const goals = readAlternatives(pieces).map(piecesOf);
  if (goals.length < 2 || !goals[alternative]) return {};
  const smallest = goals.reduce((least, goal) => (pieceCount(goal) < pieceCount(least) ? goal : least));
  return newPieces(goals[alternative], smallest);
}

// What planning a solve's first step in inspection costs (see LookModel.plan): nothing for its smallest alternative (a cross), and for each piece a bigger
// one plans beyond it `plan`, plus `planHidden` for how much of those pieces is out of sight on the cube as held before the answer's grip `rotation`
export function inspectionLook(pattern: KPattern, pieces: string, alternative: number, rotation: string, look: LookModel = LOOK): number {
  const extra = plannedExtra(pieces, alternative);
  const count = pieceCount(extra);
  if (!count) return 0;
  return count * (look.plan + look.planHidden * hiddenShare(pattern, rotateGoal(extra, invertMoves(rotation)), look));
}

// The piece sets the next step could take, named in the grip the cube is held in now: each of its alternatives in each of its grips, once each, without the
// ones the kept pieces already cover (the pair an XCross did, for a pair step)
export function nextGroups(next: NextStep, kept: Goal): Goal[] {
  const groups: Goal[] = [];
  const seenKeys = new Set<string>();
  for (const text of readAlternatives(next.pieces)) {
    // This alternative's pieces, centers aside
    const own = dropFree(goalFromText(text, false));
    delete own.CENTERS;
    for (const rotation of next.rotations) {
      // Named in that grip, so named here with the rotation undone
      const group = rotateGoal(own, invertMoves(rotation));
      const fresh = newPieces(group, kept);
      if (!pieceCount(fresh)) continue;
      // The same pieces from another alternative or grip count once
      const key = JSON.stringify(Object.entries(group).map(([orbit, roles]) => [orbit, Object.keys(roles).sort()]));
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      groups.push(fresh);
    }
  }
  return groups;
}

// What finding the next step's pieces costs after an answer, on the cube as it leaves it: the easiest of the piece sets the next step could take (the
// solver picks the one in sight), with every one counting `later` (pieces the steps after it will need, so a back slot done first leaves the front ones open)
export function nextLook(pattern: Spots, groups: Goal[], look: LookModel = LOOK): number {
  if (!groups.length) return 0;
  const shares = groups.map((group) => hiddenShare(pattern, group, look));
  const easiest = Math.min(...shares);
  const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  return lookCost((1 - look.later) * easiest + look.later * mean, look);
}
