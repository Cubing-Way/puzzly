// A step's goal in each grip worth trying, worked out from the pieces earlier steps did (no cube needed)

// Roles, goal text and goal masks
import { readAlternatives, dropFree, goalFromText, mergeGoals, allCenters, covers } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Error messages
import { NOTHING_NEW } from "../messages";
// Engine data shapes
import type { Goal } from "../types";

// A step's goal in one grip, for one of its alternatives (no cube needed)
export interface GripGoal {
  alternative: number; // which of the step's alternatives
  rotation: string; // grip ("" = as held)
  goal: Goal; // the goal named in that grip (kept pieces included)
  gripMatters: boolean; // the goal has orient-group pieces, which are judged from the grip (so two grips never ask for the same thing)
  fresh: number; // goal pieces earlier steps don't cover yet in that grip
}

// A step's goals worth trying from the earlier pieces (named in the grip it starts in): per alternative, its goal in each grip where earlier pieces cover the fewest
// of its pieces (a grip turn can't trade its pieces for ones already done). When no alternative adds anything, the step is already done if the cube may stay as held
// (only that grip is tried, e.g. a last pair after an XCross); otherwise it throws NOTHING_NEW rather than answer with a bare grip turn
export function gripGoals(pieces: string, rotations: string[], keep: Goal | undefined, earlier: Goal | undefined): GripGoal[] {
  const perAlternative = readAlternatives(pieces).map((text, alternative) => {
    // This alternative's pieces (with kept pieces, its centers only count when typed, so the kept ones stand; :x pieces are just not checked)
    const own = dropFree(goalFromText(text, !keep));
    // Goal in one grip: the kept pieces renamed for that grip, with this alternative's pieces on top (no centers left at all = all six, like goal text)
    const goalFor = (rotation: string): Goal => {
      if (!keep) return own;
      const goal = mergeGoals(rotateGoal(keep, rotation), own);
      goal.CENTERS ??= allCenters();
      return goal;
    };
    // Its pieces as [type, number, role], centers left out (they only set the frame), to check each grip against earlier steps
    const ownPieces = Object.entries(own)
      .filter(([orbit]) => orbit !== "CENTERS")
      .flatMap(([orbit, roles]) => Object.entries(roles).map(([piece, role]) => [orbit, Number(piece), role] as const));
    // Orientation is judged from the grip, so orient-group goals can't be shared between grips
    const gripMatters = [own, keep ?? {}].some((goal) => Object.values(goal).some((roles) => Object.values(roles).some((role) => role.startsWith("orient"))));
    // Each grip: how many of its pieces earlier steps already cover there (e.g. a filled pair slot, or the solved first layer once x2 puts it on top)
    const goals = rotations.map((rotation) => {
      const before = rotateGoal(earlier ?? keep ?? {}, rotation);
      const covered = ownPieces.filter(([orbit, piece, role]) => covers(before[orbit]?.[piece], role)).length;
      return { alternative, rotation, goal: goalFor(rotation), gripMatters, covered, fresh: ownPieces.length - covered };
    });
    // Only the grips where earlier steps cover the fewest of its pieces; nothingNew: every grip only names pieces earlier steps already did
    const least = Math.min(...goals.map((goal) => goal.covered));
    return { goals: goals.filter((goal) => goal.covered === least), nothingNew: ownPieces.length > 0 && least === ownPieces.length };
  });
  // Alternatives that add something, else only the as-held grip
  const adding = perAlternative.filter((entry) => !entry.nothingNew);
  const goals = adding.length ? adding.flatMap((entry) => entry.goals) : perAlternative.flatMap((entry) => entry.goals.filter((goal) => goal.rotation === ""));
  if (!goals.length) throw new Error(NOTHING_NEW);
  return goals;
}
