// Goals in other grips: the same pieces named for the grip the cube is held in

// Loaded cube definition and held cubes
import { solvedAfter, gripAfter } from "../core/puzzle";
// Engine data shapes
import type { Goal, Role } from "../types";
// Roles, goal text and goal masks
import { goalFromText } from "./goal";

// Goal (text or roles) renumbered to the actual pieces that fill its spots in the grip after `scramble` then `done` (e.g. for the viewer's mask)
export function goalOnCube(goal: string | Goal, scramble: string, done = ""): Goal {
  // Solved cube held in that grip: the piece at each spot is the one that belongs there
  const homes = solvedAfter(gripAfter(scramble, done)).patternData;
  const onCube: Goal = {};
  // Move each role from its spot number to the number of the piece that belongs there
  for (const [orbit, roles] of Object.entries(typeof goal === "string" ? goalFromText(goal) : goal)) {
    const renumbered: Record<number, Role> = (onCube[orbit] = {});
    for (const [spot, role] of Object.entries(roles)) renumbered[homes[orbit].pieces[Number(spot)]] = role;
  }
  return onCube;
}

// Rename a goal's spots for the grip after a whole-cube rotation, so it still means the same pieces (e.g. "FR" becomes "FL" after y)
export function rotateGoal(goal: Goal, rotation: string): Goal {
  const turned = solvedAfter(rotation).patternData;
  const renamed: Goal = {};
  for (const [orbit, roles] of Object.entries(goal)) {
    const moved: Record<number, Role> = (renamed[orbit] = {});
    // The rotation brings whatever was on spot `from` to spot `to`
    turned[orbit].pieces.forEach((from, to) => {
      if (roles[from]) moved[to] = roles[from];
    });
  }
  return renamed;
}
