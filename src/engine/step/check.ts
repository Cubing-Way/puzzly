// Goal check: whether a scramble plus some moves really reaches a goal, worked out apart from the search

// Move text helpers
import { joinMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Roles, goal text and goal masks
import { goalFromText, splitAlternatives, dropFree, maskPattern } from "../goal/goal";
// Solvable-with moves
import { solvableIndex } from "../goal/solvable";
// A goal's targets
import { goalTargets } from "../goal/targets";
// Goals that keep every other piece untouched
import { keptOthers } from "../goal/untouched";

// Check that scramble + done (earlier steps and this solution) really reaches the goal, in the grip it ends in, up to any of the step's offsets
// (and with solvable-with moves, up to what those moves can still do); with alternatives, any one counts (pieces = null means the whole cube, where neither applies).
// For a step that keeps every other piece untouched, `untouched` also asks that every spot but the changed ones holds what it held before the step
// (from = the moves before it, plus its grip rotation)
export function reachesGoal(
  scramble: string,
  done: string,
  pieces: string | null,
  offsets = [""],
  solvableWith: string[] = [],
  untouched?: { from: string; changed: string },
): boolean {
  // Full goal: every piece home, judged by the centers
  if (pieces === null) {
    return heldPattern(joinMoves(scramble, done)).experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  }
  // Step goal: some alternative's pieces match the solved cube turned by one of the offsets (relative groups anywhere they fit), everything else hidden
  const held = heldPattern(scramble, done);
  if (untouched && !keptOthers(heldPattern(scramble, untouched.from), held, goalFromText(untouched.changed, false))) return false;
  return splitAlternatives(pieces).some((text) => {
    const goal = dropFree(goalFromText(text));
    const reached = maskPattern(held, goal);
    const targets = (offsets.length ? offsets : [""]).flatMap((offset) => goalTargets(goal, offset));
    // With solvable-with moves, a target those moves can reach from here counts too
    return solvableWith.length ? solvableIndex(reached, targets, solvableWith) >= 0 : targets.some((target) => reached.isIdentical(target));
  });
}
