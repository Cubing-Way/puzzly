// The 2x2x2's description: the 3x3x3's corners and grips, no frame (nothing on it says how it's held), every face turn by default

// Puzzle model
import { cube2x2x2 } from "cubing/puzzles";
// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Full 2x2x2 solver
import { experimentalSolve2x2x2 } from "cubing/search";
// A puzzle's description
import type { PuzzleSpec } from "./spec";

// The 2x2x2
export const CUBE2: PuzzleSpec = {
  id: "2x2x2",
  name: "2x2x2 cube",
  kpuzzle: () => cube2x2x2.kpuzzle(),
  // Corner names in cubing.js's order, the same as the 3x3x3's (a 3x3x3's corners after outer turns are the 2x2x2's, same numbers)
  pieces: { CORNERS: ["UFR", "UBR", "UBL", "UFL", "DFR", "DFL", "DBL", "DBR"] },
  // A name's letters sorted, any case: "UFR", "RFU" and "ufr" are the same corner
  pieceKey: (name) => name.toUpperCase().split("").sort().join(""),
  // No frame: R L' moves every piece as x does, so only rotation moves change the grip
  frame: null,
  // Faces in opposite pairs, as on the 3x3x3
  faces: ["U", "D", "F", "B", "R", "L"],
  // Held like a 3x3x3: U and F face the solver, R and L at a slant, B and D not at all
  sight: { U: 1, F: 1, R: 1, L: 1, B: 0, D: 0 },
  // Every face: R U F alone reach every state, but a step ranked by speed should choose when a D, L or B turn is faster
  defaultMoves: ["U", "R", "F", "D", "L", "B"],
  // Nothing beyond the faces (no slices on a 2x2x2)
  extraMoves: [],
  // Face turns only: a 2x2x2 has no slices, and its wide turns are rotations
  turnFamilies: { face: ["U", "R", "F", "D", "L", "B"], slice: [], wide: [] },
  rotations: ["x", "y", "z"],
  // The 3x3x3's 24 grips in the same order: the rotation that puts each face on the bottom, D (none) first
  bottoms: { D: "", U: "x2", F: "x'", B: "x", R: "z", L: "z'" },
  // y turns pick the front
  fronts: ["", "y", "y2", "y'"],
  scramble: async () => (await randomScrambleForEvent("222")).toString(),
  // No isSolved: the engine's own check (solved in one of the grips) does
  solveFull: (pattern) => experimentalSolve2x2x2(pattern),
  // No alg sets of its own yet (OLL, PLL and ZBLL are the 3x3x3's)
  algSets: [],
  viewer: { puzzle: "2x2x2" },
};
