// Method runs: steps in order, each from where the last one left the cube, with lookahead and repeated steps

// Piece names and grips
import { gripRotations } from "../core/cube";
// Move text helpers
import { countMoves, joinMoves } from "../core/moves";
// Roles, goal text and goal masks
import { mergeGoals, goalFromText, goalToText } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Offsets a goal counts up to
import { offsetsFromText } from "../goal/offsets";
// Solvable-with moves
import { solvableFromText } from "../goal/solvable";
// Error messages
import { NOTHING_NEW } from "../messages";
// Goal check
import { reachesGoal } from "../step/check";
// Step solvers
import { solveStep, stepCandidates } from "../step/step";
// Engine data shapes
import type { StepConfig, Goal, TableProgress, StepOptions, StepResult, Method, MethodOptions, MethodResult, MethodStepResult } from "../types";

// Most rounds of a repeated method step (a BLD solve needs about 6–10 per piece type)
export const MAX_REPEATS = 60;

// Search options for one step of a method, from where earlier steps left the cube (done), with their pieces named in the grip the step starts in (earlier)
export function methodStepOptions(step: StepConfig, done: string, earlier: Goal, onProgress?: (progress: TableProgress) => void): StepOptions {
  return {
    generatorMoves: step.moves,
    maxDepth: step.maxDepth ?? undefined,
    rotations: gripRotations(step.grips.bottom, step.grips.anyFront),
    done,
    offsets: offsetsFromText(step.offsets),
    solvableWith: solvableFromText(step.solvableWith ?? ""),
    firstFound: step.firstFound,
    keep: step.keep ? earlier : undefined,
    earlier,
    untouched: step.untouched,
    buffer: step.buffer,
    targetsPerStep: step.targetsPerStep,
    parity: step.parity,
    onProgress,
  };
}

// Earlier pieces after a step: they follow its grip turn, then the pieces it left for good join them (later roles win; with solvable-with moves,
// pieces those moves would still move stay out, so a later step that keeps earlier pieces doesn't hold them in place)
export function piecesAfter(earlier: Goal, result: Pick<StepResult, "rotation" | "settled">): Goal {
  return mergeGoals(rotateGoal(earlier, result.rotation), goalFromText(result.settled));
}

// Run a method's steps in order, each from where the earlier ones left the cube (start = scramble, then options.done).
// A step with lookahead lists its candidate answers and takes the one with the fewest moves over it and its next steps (each of those solved its own shortest way)
export async function runMethod(scramble: string, method: Method, options: MethodOptions = {}): Promise<MethodResult> {
  const steps: MethodStepResult[] = [];
  // Moves after the scramble so far, always passed as done (never folded into the scramble), so only their x, y, z change the grip
  let done = options.done ?? "";
  // Every earlier step's pieces, named in the grip the next step starts in
  let earlier: Goal = {};
  // Each step's own shortest answer from a given state, solved once per run (lookahead visits many states, and the run itself may reach one of them again)
  const ownAnswers = new Map<string, Promise<StepResult>>();
  const solveOwn = (index: number, from: string, before: Goal): Promise<StepResult> => {
    const key = `${index}\n${from}\n${goalToText(before)}`;
    let answer = ownAnswers.get(key);
    if (!answer) {
      const step = method.steps[index];
      answer = solveStep(scramble, step.pieces, methodStepOptions(step, from, before, options.onProgress));
      ownAnswers.set(key, answer);
    }
    return answer;
  };
  // Moves the next `count` steps after step `index` take, each its own shortest answer, from where `from` leaves the cube (Infinity when one of them finds nothing).
  // A repeated step comes back until a round has nothing left (0 moves, or nothing new), then the step after it; those empty rounds don't count
  const movesAhead = async (index: number, count: number, from: string, before: Goal): Promise<number> => {
    let total = 0;
    // Step that ran last, and whether it runs again next
    let at = index;
    let again = Boolean(method.steps[index].repeat);
    for (let judged = 0; judged < count; ) {
      const next = again ? at : at + 1;
      if (next >= method.steps.length) break;
      let result: StepResult;
      try {
        result = await solveOwn(next, from, before);
      } catch (error) {
        // A repeated step with nothing new left is finished: go on with the next step
        if (again && (error as Error).message === NOTHING_NEW) {
          again = false;
          continue;
        }
        return Infinity;
      }
      const solution = result.solution.toString();
      const moves = countMoves(solution);
      // Same when its round has nothing to do
      if (again && !moves) {
        again = false;
        continue;
      }
      total += moves;
      from = joinMoves(from, solution);
      before = piecesAfter(before, result);
      judged++;
      at = next;
      again = Boolean(method.steps[next].repeat) && moves > 0;
    }
    return total;
  };
  for (const [index, step] of method.steps.entries()) {
    // Rounds of this step: one, or with repeat as many as it finds something to do (each listed as "name 1", "name 2"…)
    for (let round = 1; ; round++) {
      options.onStart?.(index, round);
      const started = performance.now();
      // Later steps (or rounds) that judge this step's answers (none past the last step)
      const ahead = step.repeat ? (step.lookahead ?? 0) : Math.min(step.lookahead ?? 0, method.steps.length - 1 - index);
      let result: StepResult;
      let lookahead: MethodStepResult["lookahead"] = null;
      try {
        if (ahead > 0) {
          // Every candidate answer, judged by its own moves plus the next steps' own shortest answers (all asked at once: the worker answers them in turn)
          const candidates = await stepCandidates(scramble, step.pieces, { ...methodStepOptions(step, done, earlier, options.onProgress), extraMoves: step.extraMoves ?? 0 });
          const totals = await Promise.all(
            candidates.map(async (candidate) => {
              const solution = candidate.solution.toString();
              return countMoves(solution) + (await movesAhead(index, ahead, joinMoves(done, solution), piecesAfter(earlier, candidate)));
            }),
          );
          // Fewest moves in total wins; on a tie the earlier candidate (the step's own shortest answer comes first)
          const winner = totals.indexOf(Math.min(...totals));
          result = candidates[winner];
          lookahead = { candidates: candidates.length, steps: ahead, total: Number.isFinite(totals[winner]) ? totals[winner] : null };
        } else {
          // Search this step from where the last one ended, keeping the earlier pieces if it asks to
          result = await solveOwn(index, done, earlier);
        }
      } catch (error) {
        // A repeated step with nothing new left is finished
        if (round > 1 && (error as Error).message === NOTHING_NEW) break;
        // Say which step found nothing
        throw new Error(`${step.repeat ? `${step.name} ${round}` : step.name}: ${(error as Error).message}`);
      }
      const ms = performance.now() - started;
      const solution = result.solution.toString();
      // A repeated step whose round has nothing to do is finished (its first round is listed even then)
      if (round > 1 && !countMoves(solution)) break;
      // Earlier pieces follow the step's grip turn, then this step's pieces join them (later roles win)
      earlier = piecesAfter(earlier, result);
      // Record the step, checked on its own goal and offsets (and, when it keeps every other piece untouched, on those pieces too)
      const finished = methodRow(scramble, method, index, round, done, result, ms, lookahead);
      steps.push(finished);
      options.onStep?.(finished, index);
      done = joinMoves(done, solution);
      // One round only, or nothing left to do
      if (!step.repeat || !finished.moves) break;
      if (round >= MAX_REPEATS) throw new Error(`${step.name}: still finding something to do after ${MAX_REPEATS} rounds.`);
    }
  }
  // Totals over all steps
  return methodTotals(steps, earlier);
}

// One finished step of a method run: its result, named (numbered by round for a repeated step), with the moves before it, its offsets and solvable-with moves,
// and the check that it really reaches its goal (and, when it keeps every other piece untouched, that those stay)
export function methodRow(scramble: string, method: Method, index: number, round: number, done: string, result: StepResult, ms: number, lookahead: MethodStepResult["lookahead"]): MethodStepResult {
  const step = method.steps[index];
  const offsets = offsetsFromText(step.offsets);
  const solvableWith = solvableFromText(step.solvableWith ?? "");
  const solution = result.solution.toString();
  const after = joinMoves(done, solution);
  const untouched = result.changed === undefined ? undefined : { from: joinMoves(done, result.rotation), changed: result.changed };
  return {
    ...result,
    name: step.repeat ? `${step.name} ${round}` : step.name,
    step: index,
    done,
    offsets,
    solvableWith,
    moves: countMoves(solution),
    ms,
    ok: reachesGoal(scramble, after, result.pieces, offsets, solvableWith, untouched),
    lookahead,
  };
}

// A whole method run from its steps: every solution in order, every step's pieces (named in the grip the run ends in), the offset the last step left in, and the totals
export function methodTotals(steps: MethodStepResult[], pieces: Goal): MethodResult {
  return {
    steps,
    solution: joinMoves(...steps.map((step) => step.solution.toString())),
    pieces: goalToText(pieces),
    offset: steps.at(-1)?.offset ?? "",
    moves: steps.reduce((sum, step) => sum + step.moves, 0),
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    ok: steps.every((step) => step.ok),
  };
}
