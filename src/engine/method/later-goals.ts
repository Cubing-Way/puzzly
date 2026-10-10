// Later goals: what the steps after a step start may still ask for, found from the method alone, to bound the rest of a run from below

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Piece names and grips
import { gripRotations } from "../core/cube";
// Move text helpers
import { joinMoves, FACE_MOVES, invertMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { netRotation, heldInGrip } from "../core/puzzle";
// Moves as other grips see them
import { moveInGrip, distinctTurns, movesForGrip, movesKey } from "../core/turns";
// Roles, goal text and goal masks
import { goalToText, maskPattern } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Offsets a goal counts up to
import { offsetsFromText, offsetGroups } from "../goal/offsets";
// Solvable-with moves
import { solvableFromText, settledGoal } from "../goal/solvable";
// A goal's targets
import { reachableTargets, goalTargets, centersReachable } from "../goal/targets";
// A step's goal in each grip
import { type GripGoal, gripGoals } from "../step/grip-goals";
// Engine data shapes
import type { Goal, StepConfig, TableProgress } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// Runs a method
import { piecesAfter } from "./run";

// Most goals one later step may have from a step start, and most ways the steps before it may have gone, for a method search's lower bound
// (past either, the goal walk stops before that step)
const MAX_LATER_GOALS = 64;
const MAX_WALK_STATES = 256;

// A goal a later step of a method may have, seen from a step start: named in the grip that step would search in (a rotation from the start's grip),
// with every move the steps up to it may use (named in that grip too) and its offsets' targets (each offset group apart: one measure each) and solvable-with moves.
// The fewest moves to it from the start is a lower bound on the rest of the run
export interface LaterGoal {
  rotation: string;
  goal: Goal;
  moves: string[];
  targets: KPattern[][];
  solvableWith: string[];
}

// One way the steps from a step start may have gone, as the goal walk follows them: the grip they end in (from the start's grip), the earlier pieces
// named in that grip, and every move they may have used (named as the start holds the cube, see turnName)
interface WalkState {
  rotation: string;
  earlier: Goal;
  turns: string[];
}

// Goals the later steps of a method may have from the start of step `index` (earlier pieces named in its grip), found without the cube: every step's alternatives
// and grips are followed with the rules a run uses (kept pieces, grips where earlier pieces cover the fewest of its pieces, the pieces it leaves for good).
// Per later step, its goals, each once; only the steps whose pieces the next step doesn't keep (a step keeping them asks for more: CFOP's last pair, F2L, stands for
// the pairs before it), plus the last step reached. The walk stops after a repeated step's first round (more rounds may follow), before a step that keeps every other
// piece untouched (its goal depends on the cube), and where goals or ways get too many; a repeated or untouched step itself gives none
export function laterGoals(steps: StepConfig[], index: number, earlier: Goal): LaterGoal[][] {
  const later: { index: number; goals: LaterGoal[] }[] = [];
  // The last step reached stands for the rest, and so does every step whose pieces the next one doesn't keep
  const standing = () => later.filter((entry, at) => at === later.length - 1 || !steps[entry.index + 1].keep).map((entry) => entry.goals);
  if (steps[index].repeat || steps[index].untouched || steps[index].buffer) return [];
  let states: WalkState[] = [{ rotation: "", earlier, turns: [] }];
  for (let at = index; at < steps.length && states.length; at++) {
    const step = steps[at];
    if (at > index && (step.untouched || step.buffer)) break;
    const offsets = offsetsFromText(step.offsets);
    const solvableWith = solvableFromText(step.solvableWith ?? "");
    const rotations = gripRotations(step.grips.bottom, step.grips.anyFront);
    // This step's goals, each once (by what it asks of the cube as the start holds it), and the ways on after it
    const goals = new Map<string, LaterGoal>();
    const next = new Map<string, WalkState>();
    for (const state of states) {
      let options: GripGoal[];
      try {
        options = gripGoals(step.pieces, rotations, step.keep ? state.earlier : undefined, state.earlier);
      } catch {
        // Nothing new for this step this way: a run can't go on like that
        continue;
      }
      for (const { rotation, goal, gripMatters } of options) {
        // The grip the step searches in (from the start's grip), and every move used up to it, named as the start holds the cube
        const grip = netRotation(joinMoves(state.rotation, rotation));
        const own = step.moves.map((move) => moveInGrip(move, grip, ""));
        if (own.includes(null)) return standing();
        const turns = distinctTurns([...state.turns, ...(own as string[])]);
        if (at > index) {
          // Those moves named in the step's grip (a list some step uses when it's the same turns), and its goal's targets per offset group
          const moves = movesForGrip(turns, grip, [step.moves, ...steps.slice(index, at).map((earlierStep) => earlierStep.moves), FACE_MOVES]);
          if (!moves) return standing();
          const key = [
            goalToText(rotateGoal(goal, invertMoves(grip))),
            movesKey(grip, moves),
            gripMatters ? grip : "",
            offsets.map((offset) => movesKey(grip, [offset])).join("&"),
            movesKey(grip, solvableWith),
          ].join("/");
          if (!goals.has(key)) {
            // Each offset group's targets, each once (too many relative-group placements: the walk stops before this step)
            let targets: KPattern[][];
            try {
              targets = offsetGroups(offsets, moves).map((group) => {
                const seen = new Set<string>();
                return group.flatMap((offset) => reachableTargets(goalTargets(goal, offset), moves)).filter((target) => {
                  const cells = cellsKey(cellsOf(target));
                  return !seen.has(cells) && Boolean(seen.add(cells));
                });
              });
            } catch {
              return standing();
            }
            goals.set(key, { rotation: grip, goal, moves, targets, solvableWith });
          }
        }
        // The earlier pieces after it, as a run's piecesAfter makes them
        const after = piecesAfter(state.earlier, { rotation, settled: goalToText(solvableWith.length ? settledGoal(goal, solvableWith) : goal) });
        const key = `${grip}/${goalToText(after)}/${turns.join(" ")}`;
        if (!next.has(key)) next.set(key, { rotation: grip, earlier: after, turns });
      }
    }
    if (at > index) {
      if (!goals.size || goals.size > MAX_LATER_GOALS) break;
      later.push({ index: at, goals: [...goals.values()] });
      if (step.repeat) break;
    }
    states = next.size > MAX_WALK_STATES ? [] : [...next.values()];
  }
  return standing();
}

// Fewest moves a later step's goal needs from the cube after `scramble` then `done`: the closest offset group's measure (a lower bound; 0 when the worker
// can't tell, e.g. twips; Infinity when the moves can't reach it)
async function measureLater(scramble: string, done: string, later: LaterGoal, onProgress?: (progress: TableProgress) => void): Promise<number> {
  const start = maskPattern(heldInGrip(scramble, done, later.rotation), later.goal);
  const measures = later.targets.map(async (group) => {
    // Only targets whose centers the moves can bring home (as in stepCombos)
    const targets = group.filter((target) => centersReachable(start, target, later.moves));
    if (!targets.length) return Infinity;
    try {
      const { bound, exact } = await askWorker({ kind: "measure", start, targets, moves: later.moves, solvableWith: later.solvableWith }, onProgress);
      return exact ? (bound ?? Infinity) : (bound ?? 0);
    } catch {
      return 0;
    }
  });
  return Math.min(...(await Promise.all(measures)));
}

// Fewest moves the rest of a run needs from a step start, from the later steps' goals: each step's closest goal, the largest of those (0 = no later goals)
export async function laterBound(scramble: string, done: string, goals: LaterGoal[][], onProgress?: (progress: TableProgress) => void): Promise<number> {
  const perStep = await Promise.all(goals.map(async (options) => Math.min(...(await Promise.all(options.map((later) => measureLater(scramble, done, later, onProgress)))))));
  return Math.max(0, ...perStep);
}
