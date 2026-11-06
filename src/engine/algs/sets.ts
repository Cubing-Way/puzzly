// Alg sets: steps that aren't searched but recognised, like a solver does the last layer: the cube shows one case of a known set, and its alg is made.
// The sets are plain data (oll.ts, pll.ts, zbll.ts), so they can be corrected and added to

// The 57 cases that orient the last layer, the 21 that permute it, and the 472 that solve it once its edges are oriented
import { OLL_CASES } from "./oll";
import { PLL_CASES } from "./pll";
import { ZBLL_CASES } from "./zbll";
// The active puzzle (a set answers only its own puzzle's steps)
import { puzzle } from "../puzzle/active";

// One case: its name and its algs as solvers write them (r, M, x … x'), the default first; each alg ends with the cube held as it started
export interface AlgCase {
  name: string;
  algs: string[];
}

// A set of cases for one kind of step, with the turns that line a case up: tried before an alg (the case seen from another side) and, when the goal
// needs it, after it
export interface AlgSet {
  name: string;
  puzzle: string; // the puzzle it's for, by id (OLL is a 3x3x3 set): it never answers another puzzle's steps
  adjust: string[];
  cases: AlgCase[];
}

// Turns of the top layer, which line up a last-layer case
const TOP = ["U", "U'", "U2"];

// Every set, whatever its puzzle (a step can name its own puzzle's: StepOptions.algs, a method step's "algs"; see PuzzleSpec.algSets)
export const ALG_SETS: Record<string, AlgSet> = {
  OLL: { name: "OLL", puzzle: "3x3x3", adjust: TOP, cases: OLL_CASES },
  PLL: { name: "PLL", puzzle: "3x3x3", adjust: TOP, cases: PLL_CASES },
  // ZBLL holds the PLL cases too (corners already oriented), so one ZBLL step finishes any last layer with its edges oriented
  ZBLL: { name: "ZBLL", puzzle: "3x3x3", adjust: TOP, cases: [...ZBLL_CASES, ...PLL_CASES] },
};

// The active puzzle's set of this name, whatever its letters' case (undefined = it has none: no such set, or one that's another puzzle's)
export function algSet(name: string): AlgSet | undefined {
  const set = Object.hasOwn(ALG_SETS, name.trim().toUpperCase()) ? ALG_SETS[name.trim().toUpperCase()] : undefined;
  return set && set.puzzle === puzzle.id && puzzle.algSets.includes(set.name) ? set : undefined;
}
