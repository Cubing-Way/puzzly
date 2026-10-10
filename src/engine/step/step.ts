// Step solvers: the shortest answer over a step's combos, every answer up to some extra moves (for lookahead), and the full-cube solver

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Full 3x3x3 solver
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
// Move text helpers
import { FACE_MOVES, countMoves, joinMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Roles, goal text and goal masks
import { maskPattern, goalToText } from "../goal/goal";
// Solvable-with moves
import { solvableIndex, settledGoal } from "../goal/solvable";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// One alternative × grip of a step
import { type Combo, type Answer, knownAnswer, searchCombo, orbitTables } from "./combo";
// Builds and measures a step's combos
import { stepCombos } from "./step-combos";

// Search the measured combos in turn for the shortest answer (on a tie, the alternative adding more new pieces), skipping combos that can't beat the best so far
export async function searchCombos(queue: Combo[], options: StepOptions, lastError: unknown): Promise<{ answer: Answer; searches: number }> {
  // Best answer so far, its length and how many new pieces it adds
  let best: Answer | null = null;
  let bestLength = Infinity;
  let bestFresh = -1;
  let searches = 0;
  // Untouched combos whose answer is known already go first: they cost nothing and bound the searches after them (other steps keep their order)
  const known = queue.filter((combo) => knownAnswer(combo, options.generatorMoves ?? FACE_MOVES) !== undefined);
  for (const combo of [...known, ...queue.filter((combo) => !known.includes(combo))]) {
    const { fresh, bound } = combo;
    // Only look for answers shorter than the best so far, or as short when this alternative adds more new pieces (and within the user's limit)
    const maxDepth = Math.min(options.maxDepth ?? Infinity, fresh > bestFresh ? bestLength : bestLength - 1);
    // Skip a combo whose distance (or lower bound) is already too long: no search there can beat the best so far
    if (bound > maxDepth) continue;
    searches++;
    try {
      const moves = await searchCombo(combo, options, maxDepth);
      // Keep it if it's shorter than the best so far, or as short with more new pieces
      const length = countMoves(moves);
      if (length < bestLength || (length === bestLength && fresh > bestFresh)) {
        bestLength = length;
        bestFresh = fresh;
        best = { combo, moves };
      }
      // First-answer mode: any answer within the limit will do, so skip the remaining combos
      if (options.firstFound) break;
    } catch (error) {
      // No answer within the limit for this combo: remember why (twips throws a plain string) and try the next one
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  // No combo found an answer
  if (!best) throw lastError ?? new Error("No solution found.");
  return { answer: best, searches };
}

// A step's result for one answer: the grip rotation and moves, the offset it reached (the target the cube matches after it, or with solvable-with moves
// the one those moves reach; a lone target needs no check), and the pieces it left for good
export function stepResult({ combo, moves }: Answer, searches: number, solvableWith: string[] = []): StepResult {
  const end = maskPattern(combo.held.applyAlg(moves), combo.goal);
  const reached = !solvableWith.length
    ? combo.targets.findIndex((target) => end.isIdentical(target))
    : combo.targets.length > 1
      ? solvableIndex(end, combo.targets, solvableWith)
      : 0;
  const offset = combo.offsets[Math.max(0, reached)];
  // Pieces it solved (an untouched step: the ones it sent home, not the whole cube it was relabeled to), and the ones later steps may keep (the solvable-with moves may still move the others)
  const pieces = combo.untouched?.pieces ?? goalToText(combo.goal);
  const settled = solvableWith.length ? goalToText(settledGoal(combo.goal, solvableWith)) : pieces;
  return {
    solution: new Alg(joinMoves(combo.rotation, moves)),
    rotation: combo.rotation,
    offset,
    pieces,
    settled,
    alternative: combo.alternative,
    searches,
    ...(combo.untouched ? { changed: combo.untouched.changed } : {}),
  };
}

// Solve only the goal pieces (a step like the cross), trying each alternative × grip (each with all its offsets at once) and keeping the shortest answer
// (on a tie, the alternative adding more new pieces wins, so "cross | XCross" takes the XCross when it costs no extra move).
// The worker first measures every combo (exact distance from one table, or a lower bound from split tables), so only combos that can still win are searched
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  return stepResult(answer, searches, options.solvableWith);
}

// Most answers stepCandidates gives by default (each one costs a run of the next steps when a method looks ahead)
export const MAX_CANDIDATES = 64;

// Options for listing a step's answers: solveStep's, plus how much longer than the shortest an answer may be, and how many to give
export interface CandidateOptions extends StepOptions {
  extraMoves?: number; // answers up to this many moves longer than the step's shortest count too (default 0: the shortest answers only)
  maxCandidates?: number; // most answers given (default MAX_CANDIDATES), shortest first
}

// Answers a step could take, for looking ahead: solveStep's answer first, then every other answer of every alternative × grip × offset up to extraMoves longer
// (shortest first, then the ones adding more new pieces, then the closest combos). Answers leaving the cube the same way count once, and an answer never
// passes through the goal on its way (that would be a shorter answer plus moves that keep the goal, which the next steps can always make themselves)
export async function stepCandidates(scramble: string, pieces: string, options: CandidateOptions = {}): Promise<StepResult[]> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  const shortest = countMoves(answer.moves);
  const most = Math.max(1, options.maxCandidates ?? MAX_CANDIDATES);
  // Longest answer that still counts: the shortest plus the extra moves, within the user's limit
  const longest = Math.min(shortest + Math.max(0, options.extraMoves ?? 0), options.maxDepth ?? Infinity);
  // How an answer leaves the cube (grip and every piece, as it really is: untouched steps' held cubes are relabeled), so answers leaving it the same way count once
  const leaves = ({ combo, moves }: Answer) => `${combo.rotation}/${JSON.stringify((combo.cube ?? combo.held).applyAlg(moves).patternData)}`;
  const seen = new Set([leaves(answer)]);
  const found: { answer: Answer; length: number; order: number }[] = [];
  let lists = 0;
  // A step that's already done (0 moves) has nothing else worth trying, and one candidate is just the shortest answer
  if (shortest > 0 && most > 1) {
    for (const [order, combo] of queue.entries()) {
      // Skip a combo whose distance (or lower bound) is already too long
      if (combo.bound > longest) continue;
      lists++;
      try {
        // Every answer of this combo up to the longest (the worker only lists answers shorter than its maxDepth, hence + 1)
        const reply = await askWorker(
          {
            kind: "list",
            start: combo.start,
            targets: combo.targets,
            moves: options.generatorMoves ?? FACE_MOVES,
            solvableWith: options.solvableWith,
            orbitTables: orbitTables(combo),
            maxDepth: longest + 1,
            maxAnswers: most,
          },
          options.onProgress,
        );
        for (const moves of reply.answers ?? []) {
          const candidate = { combo, moves };
          const key = leaves(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ answer: candidate, length: countMoves(moves), order });
        }
      } catch {
        // No answer within the limit for this combo
      }
    }
  }
  // Shortest first, then the ones adding more new pieces, then the closest combos (the sort keeps each list's own order on ties)
  found.sort((a, b) => a.length - b.length || b.answer.combo.fresh - a.answer.combo.fresh || a.order - b.order);
  return [answer, ...found.slice(0, most - 1).map((entry) => entry.answer)].map((entry) => stepResult(entry, searches + lists, options.solvableWith));
}

// Solve the whole cube, judged by its centers in the grip it's held in
export async function solveFull(scramble: string, done = ""): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(joinMoves(scramble, done)));
}
