// The built-in puzzles by id, which scoring workers, batch engines and the solve server load when a message names its puzzle (a description holds functions, so it can't be sent)

// A puzzle's description
import type { PuzzleSpec } from "./spec";
// The 3x3x3's description
import { CUBE3 } from "./cube3";

// The puzzle a call without one is for: the 3x3x3 (cubisz and the solve server deployed before puzzles were data send none)
export const DEFAULT_PUZZLE: PuzzleSpec = CUBE3;

// Every built-in puzzle, by its id
export const PUZZLES: Record<string, PuzzleSpec> = { [CUBE3.id]: CUBE3 };

// The puzzle a message or call names by its id (left out: the 3x3x3); throws on an id no built-in puzzle has
export function puzzleById(id?: string | null): PuzzleSpec {
  if (id === undefined || id === null) return DEFAULT_PUZZLE;
  const spec = Object.hasOwn(PUZZLES, id) ? PUZZLES[id] : undefined;
  if (!spec) throw new Error(`Unknown puzzle "${id}": it must be one of ${Object.keys(PUZZLES).join(", ")}.`);
  return spec;
}
