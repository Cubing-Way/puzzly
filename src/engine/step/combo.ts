// Combos: one alternative × grip of a step, ready to search; its shortest answer comes from the worker, or from memory for BLD cases seen before

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Move text helpers
import { FACE_MOVES, countMoves } from "../core/moves";
// Engine data shapes
import type { Goal, StepOptions } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";

// One alternative × grip with all its offsets' targets (one table holds them all), measured and ready to search
export interface Combo {
  alternative: number; // which of the step's alternatives
  rotation: string; // grip ("" = as held)
  goal: Goal; // the goal named in that grip (kept pieces included)
  fresh: number; // goal pieces earlier steps don't cover yet in that grip
  held: KPattern; // cube held in that grip
  start: KPattern; // held cube with the goal's hidden pieces masked
  offsets: string[]; // offsets the goal counts up to, one per target (repeated when relative groups give an offset several targets)
  targets: KPattern[]; // masked targets (solved cube turned by each offset, with each placement of the relative groups)
  bound: number; // measured distance: exact from one table, a lower bound from split tables or the pieces' own moves
  twips?: boolean; // the worker answers it with twips (no tables fit): a list gives only its one shortest answer
  cube?: KPattern; // untouched steps: the cube held in that grip as it really is (held is it relabeled, so the wanted end state is the solved cube)
  untouched?: { pieces: string; changed: string }; // untouched steps: the pieces it solves and every spot it may change (pieces text)
}

// One answer of a step: the combo it came from and its moves (after the grip rotation)
export interface Answer {
  combo: Combo;
  moves: string;
}

// Most states of a whole-orbit sub-table that BLD steps ask the worker for (all 8 corners = 88M states, ~44 MB, a few seconds to build once)
const ORBIT_TABLE_STATES = 100_000_000;

// Whole-orbit tables a combo's worker requests ask for: untouched (BLD) steps get them (they make parity steps ~10–50× faster), others none
export function orbitTables(combo: Combo): number | undefined {
  return combo.untouched ? ORBIT_TABLE_STATES : undefined;
}

// Shortest answers of untouched steps by allowed moves + relabeled start: a relabeled BLD case (a 3-cycle, a flip, a parity) doesn't depend on the rest of the cube,
// so the same case in a later step or scramble is answered at once (kept while the page is open, oldest dropped past the limit)
const knownAnswers = new Map<string, string>();
const MAX_KNOWN_ANSWERS = 5_000;

// Key of an untouched combo's answer: the allowed moves and its relabeled start
function answerKey(combo: Combo, moves: string[]): string {
  return `${moves.join(" ")}/${cellsKey(cellsOf(combo.start))}`;
}

// What's known of an untouched combo's shortest answer without searching: "" when it's at the goal already, a remembered answer, or undefined
export function knownAnswer(combo: Combo, moves: string[]): string | undefined {
  if (!combo.untouched) return undefined;
  if (combo.targets.some((target) => target.isIdentical(combo.start))) return "";
  return knownAnswers.get(answerKey(combo, moves));
}

// One combo's shortest answer within maxDepth moves (Infinity = no limit): known already, or searched by the worker (which only finds answers shorter than
// the maxDepth it gets, hence + 1); throws "No solution found!" when there's none
export async function searchCombo(combo: Combo, options: StepOptions, maxDepth: number): Promise<string> {
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  const known = knownAnswer(combo, generatorMoves);
  if (known !== undefined) {
    if (countMoves(known) > maxDepth) throw new Error("No solution found!");
    return known;
  }
  const reply = await askWorker(
    {
      kind: "search",
      start: combo.start,
      targets: combo.targets,
      moves: generatorMoves,
      solvableWith: options.solvableWith,
      orbitTables: orbitTables(combo),
      ...(Number.isFinite(maxDepth) ? { maxDepth: maxDepth + 1 } : {}),
    },
    options.onProgress,
  );
  const moves = reply.moves ?? "";
  // An untouched combo's answer is its shortest one (the search deepens one move at a time): remember it
  if (combo.untouched) {
    if (knownAnswers.size >= MAX_KNOWN_ANSWERS) knownAnswers.delete(knownAnswers.keys().next().value!);
    knownAnswers.set(answerKey(combo, generatorMoves), moves);
  }
  return moves;
}
