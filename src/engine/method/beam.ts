// Beam search of a method by speed: many partial solves side by side, step by step, and the whole solve with the lowest speed cost and looks

// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Move text helpers
import { countMoves, joinMoves, joinStep, NO_STEPS, type JoinedSteps } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Goal text and a step's alternatives
import { goalToText, splitAlternatives } from "../goal/goal";
// Error messages
import { NOTHING_NEW } from "../messages";
// Speed cost of a move sequence after the moves before it
import { speedCostAfter } from "../speed/fingering";
// Step solvers
import { solveStep, stepCandidates, type CandidateOptions } from "../step/step";
// Engine data shapes
import type { Goal, Method, MethodResult, MethodStepResult, StepConfig, StepResult, TableProgress } from "../types";
// Runs a method
import { runMethodRows, joinCancelled, methodStepOptions, methodRow, methodTotals, piecesAfter, heldBack, nextStep, stepLook, avoided, handTurns, handsMoves, MAX_REPEATS, JUDGING_EXTRA_MOVES } from "./run";

// Partial solves a beam search keeps after each step for each set of pieces done, and answers each alternative of a step gives (the page's default)
export const BEAM_WIDTH = 4;

// Places are shared out as if there were at least this many sets of pieces done, so when few are left (the last layer: one set) each keeps more
const FILLED_SETS = 8;

// Options for a beam search: where it starts, how wide it is, a way to cut it short, and who hears about its progress
export interface MethodBeamOptions {
  done?: string; // moves already done after the scramble, before the first step
  width?: number; // partial solves kept after each step for each set of pieces done, and answers each alternative of a step gives (default BEAM_WIDTH)
  stop?: () => boolean; // asked before each step's answers: true finishes quickly (from then on one partial solve per set of pieces, each step its own best answer)
  onLevel?: (index: number, round: number, partials: number) => void; // hears each step (and round) as it starts, with how many partial solves it extends
  onProgress?: (progress: TableProgress) => void; // hears when the search worker builds or loads a table
}

// What a beam search found
export interface MethodBeamResult {
  best: MethodResult | null; // the whole solve with the lowest cost (null = no partial solve got through every step)
  cost: number | null; // its cost: each step's turning after the moves before it (cancels counted), plus what finding pieces costs, as a lookahead counts it
  seed: number | null; // the plain run's cost counted the same way (the beam starts from it, so it never does worse; null when that run failed)
  look: number | null; // how much of that cost is finding pieces
  partials: number; // partial solves extended, over every step
  stopped: boolean; // cut short: from then on each step took its own best answer
  ms: number;
}

// One step a partial solve took: which step and round, the moves before it, and its answer (made into a row only for the winner)
interface Taken {
  index: number;
  round: number;
  done: string;
  result: StepResult;
}

// One partial solve: the moves so far (after the scramble), the pieces done (named in the grip the next step starts in), the moves as the hands make them
// (joined, with where each step starts), the steps it took, and its cost so far with the looks in it
interface Partial {
  done: string;
  earlier: Goal;
  previous: JoinedSteps;
  taken: Taken[];
  cost: number;
  look: number;
}

// Search a method's solves for the lowest speed cost: every partial solve is extended with each alternative's best few answers to the next step, and
// after each step the cheapest partial solves of each set of pieces done go on (a cross is never ranked against an XXCross: they meet once both have
// the same pieces done). Each step ranks by speed and pays for finding its pieces (its style says how), the lookahead's measure, so a step's answer that
// sets up a cancel, a skip or an easy last layer wins when the whole solve is cheaper. Lookahead and "over its best N answers" are left out: the beam is
// the lookahead. A repeated step goes round by round; a step held back takes its one answer, as a run does
export async function beamSearchMethod(scramble: string, method: Method, options: MethodBeamOptions = {}): Promise<MethodBeamResult> {
  const started = performance.now();
  const steps = method.steps;
  const width = Math.max(1, Math.floor(options.width ?? BEAM_WIDTH));
  let partials = 0;
  let stopped = false;
  // How many to keep from here on: the width, or one once stop says so
  const keepCount = (): number => ((stopped ||= Boolean(options.stop?.())) ? 1 : width);

  // A partial solve's answers to a step: each alternative's best by speed (one when cut short), only the best tier where faces are avoided
  const stepAnswers = async (index: number, partial: Partial): Promise<StepResult[]> => {
    // The step ranked by speed (the beam's measure), with its options from where the partial solve left the cube
    const step: StepConfig = { ...steps[index], rank: "speed" };
    const base: CandidateOptions = {
      ...methodStepOptions(step, partial.done, partial.earlier, options.onProgress, nextStep(method, index), partial.previous),
      rank: "speed",
      // Extra moves it compares: all of them on the first step (one partial solve to extend), one at most after it, as a lookahead judges (with so many
      // partial solves a rough cost is enough; the seed's own steps compared all of theirs)
      extraMoves: index ? Math.min(step.extraMoves ?? 0, JUDGING_EXTRA_MOVES) : (step.extraMoves ?? 0),
      avoid: avoided(step),
      ...handTurns(step),
    };
    // Held back when later steps need the rest of its alternatives: its one answer, as a run takes it (see heldBack)
    const held = heldBack(steps, index, partial.earlier);
    if (held) return [await solveStep(scramble, held.pieces, { ...base, rotations: held.rotations })];
    // Each alternative's best answers, as many as the width (an alg set's best algs, as many in all)
    const keep = keepCount();
    const many = { ...base, perAlternative: keep, maxCandidates: keep * splitAlternatives(step.pieces).length };
    const answers = await stepCandidates(scramble, step.pieces, keep > 1 ? many : { ...base, maxCandidates: 1 });
    // With faces to avoid, only the best tier there is (they come first)
    const best = answers[0]?.tier;
    return best === undefined ? answers : answers.filter((answer) => answer.tier === best);
  };

  // A partial solve one step further: the answer's turning after the moves before it (cancels counted), and what finding its pieces costs
  const extend = (index: number, round: number, partial: Partial, result: StepResult): Partial => {
    const hands = handsMoves(result);
    const look = stepLook(scramble, method, index, partial.done, partial.earlier, result);
    const turning = speedCostAfter(hands, partial.previous.moves, undefined, !partial.done.trim(), partial.previous.starts);
    return {
      done: joinMoves(partial.done, result.solution.toString()),
      earlier: piecesAfter(partial.earlier, result),
      previous: joinStep(partial.previous, hands),
      taken: [...partial.taken, { index, round, done: partial.done, result }],
      cost: partial.cost + turning + look,
      look: partial.look + look,
    };
  };

  // Key of a partial solve's place: its pieces done and the cube as held
  const keyOf = (partial: Partial): string => `${goalToText(partial.earlier)}\n${cellsKey(cellsOf(heldPattern(scramble, partial.done)))}`;

  // The partial solves worth going on with: the same cube with the same pieces done keeps its cheaper way there, then each set of pieces done keeps
  // its cheapest (the width each, more when there are few sets: as many places in all as FILLED_SETS sets would have)
  const prune = (children: Partial[]): Partial[] => {
    // One way to each cube and pieces done: the cheapest
    const cheapest = new Map<string, Partial>();
    for (const child of children) {
      const key = keyOf(child);
      const before = cheapest.get(key);
      if (!before || child.cost < before.cost) cheapest.set(key, child);
    }
    // Grouped by the pieces they have done
    const sets = new Map<string, Partial[]>();
    for (const child of cheapest.values()) {
      const text = goalToText(child.earlier);
      sets.set(text, [...(sets.get(text) ?? []), child]);
    }
    // Each set's cheapest, as many as its share
    const keep = keepCount();
    const share = keep === 1 ? 1 : Math.max(keep, Math.floor((keep * FILLED_SETS) / Math.max(1, sets.size)));
    return [...sets.values()].flatMap((set) => set.sort((a, b) => a.cost - b.cost).slice(0, share));
  };

  // Start: one partial solve, nothing done yet
  const start: Partial = { done: options.done ?? "", earlier: {}, previous: NO_STEPS, taken: [], cost: 0, look: 0 };
  let level: Partial[] = [start];
  // Seed: the plain run (each step with its own lookahead and all its extra moves). Its path is kept at every step, so the beam never ends above it
  let seedRows: MethodStepResult[] = [];
  try {
    seedRows = (await runMethodRows(scramble, method, { done: options.done, onProgress: options.onProgress })).steps;
  } catch {
    // No plain run: the beam goes on without a seed
  }
  let seed: Partial | null = seedRows.length ? start : null;
  for (const [index, step] of steps.entries()) {
    // Partial solves done with this step, and the ones a repeated step's next round goes on with
    const finished: Partial[] = [];
    let going = level;
    let lastError: unknown = null;
    for (let round = 1; going.length; round++) {
      if (round > MAX_REPEATS) throw new Error(`${step.name}: still finding something to do after ${MAX_REPEATS} rounds.`);
      options.onLevel?.(index, round, going.length);
      // Every partial solve with each of its answers
      const children: Partial[] = [];
      for (const partial of going) {
        partials++;
        let answers: StepResult[];
        try {
          answers = await stepAnswers(index, partial);
        } catch (error) {
          // A repeated step with nothing new left is done for this partial solve; any other error (no answer) drops it
          if (round > 1 && (error as Error).message === NOTHING_NEW) finished.push(partial);
          else lastError = error;
          continue;
        }
        // A repeated step's later round with nothing to do is done for this partial solve (its first round is listed even then)
        if (round > 1 && answers.every((answer) => !countMoves(answer.solution.toString()))) {
          finished.push(partial);
          continue;
        }
        for (const answer of answers) children.push(extend(index, round, partial, answer));
      }
      // One round only, or the next round goes on with the cheapest of these
      if (!step.repeat) {
        finished.push(...children);
        break;
      }
      going = prune(children);
    }
    level = prune(finished);
    // The plain run's path through this step (every round of it) stays, unless the same cube with the same pieces is kept already as cheaply
    if (seed) {
      let round = 0;
      for (const row of seedRows.filter((row) => row.step === index)) seed = extend(index, ++round, seed, row);
      const key = keyOf(seed);
      const same = level.findIndex((partial) => keyOf(partial) === key);
      if (same < 0) level.push(seed);
      else if (level[same].cost > seed.cost) level[same] = seed;
    }
    // No partial solve got through: say which step found nothing
    if (!level.length) throw new Error(`${step.name}: ${(lastError as Error | null)?.message ?? "no partial solve gets through this step."}`);
  }

  // The cheapest whole solve, its steps made into rows (each checked on its goal, steps that cancel joined: see joinCancelled), timed as the whole search
  const winner = level.reduce<Partial | null>((best, partial) => (!best || partial.cost < best.cost ? partial : best), null);
  const ms = performance.now() - started;
  const seedCost = seed ? seed.cost : null;
  if (!winner) return { best: null, cost: null, seed: seedCost, look: null, partials, stopped, ms };
  const rows = winner.taken.map(({ index, round, done, result }) => methodRow(scramble, method, index, round, done, result, 0, null));
  return { best: { ...methodTotals(joinCancelled(scramble, method, rows), winner.earlier), ms }, cost: winner.cost, seed: seedCost, look: winner.look, partials, stopped, ms };
}
