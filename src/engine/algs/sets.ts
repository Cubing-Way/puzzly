// Alg sets: steps that aren't searched but recognised, like a solver does the last layer: the cube shows one case of a known set, and its alg is made.
// The sets are plain data (oll.ts, pll.ts), so they can be corrected and added to

// The 57 cases that orient the last layer, and the 21 that permute it
import { OLL_CASES } from "./oll";
import { PLL_CASES } from "./pll";

// One case: its name and its algs as solvers write them (r, M, x … x'), the default first; each alg ends with the cube held as it started
export interface AlgCase {
  name: string;
  algs: string[];
}

// A set of cases for one kind of step, with the turns that line a case up: tried before an alg (the case seen from another side) and, when the goal
// needs it, after it
export interface AlgSet {
  name: string;
  adjust: string[];
  cases: AlgCase[];
}

// Turns of the top layer, which line up a last-layer case
const TOP = ["U", "U'", "U2"];

// The sets a step can name (StepOptions.algs, a method step's "algs")
export const ALG_SETS: Record<string, AlgSet> = {
  OLL: { name: "OLL", adjust: TOP, cases: OLL_CASES },
  PLL: { name: "PLL", adjust: TOP, cases: PLL_CASES },
};

// The set of this name, whatever its letters' case (undefined = there's none)
export function algSet(name: string): AlgSet | undefined {
  return ALG_SETS[name.trim().toUpperCase()];
}
