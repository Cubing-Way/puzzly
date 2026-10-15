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
}

// The default eyes (first guesses, to be tuned against real solving): U and F face the solver and R and L are seen at a slant, B and D not at all. So a pair
// in the front costs 2 to find after the pair before it, one in the back slot 3.5, and a whole step that a bigger first step (an XCross) did costs nothing
export const LOOK: LookModel = {
  step: 2,
  hidden: 3,
  faces: { U: 1, F: 1, R: 1, L: 1, B: 0, D: 0 },
  later: 0.5,
};

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

// How much of some pieces is out of sight on a held cube (0 = all in plain sight, 1 = none): where each piece sits (to find it) and, for a piece with a spot
// of its own, that spot (to see where it goes), averaged
export function hiddenShare(pattern: KPattern, pieces: Goal, look: LookModel = LOOK): number {
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
export function nextLook(pattern: KPattern, groups: Goal[], look: LookModel = LOOK): number {
  if (!groups.length) return 0;
  const shares = groups.map((group) => hiddenShare(pattern, group, look));
  const easiest = Math.min(...shares);
  const mean = shares.reduce((sum, share) => sum + share, 0) / shares.length;
  return lookCost((1 - look.later) * easiest + look.later * mean, look);
}
