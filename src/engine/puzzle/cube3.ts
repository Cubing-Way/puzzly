// The 3x3x3's description: exactly the values the engine had written in before puzzles were data

// Puzzle model
import { cube3x3x3 } from "cubing/puzzles";
// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Full 3x3x3 solver
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
// A puzzle's description
import type { PuzzleSpec } from "./spec";

// The 3x3x3
export const CUBE3: PuzzleSpec = {
  id: "3x3x3",
  name: "3x3x3 cube",
  kpuzzle: () => cube3x3x3.kpuzzle(),
  // Piece names in cubing.js's order
  pieces: {
    EDGES: ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"],
    CORNERS: ["UFR", "UBR", "UBL", "UFL", "DFR", "DFL", "DBL", "DBR"],
    CENTERS: ["U", "L", "F", "R", "B", "D"],
  },
  // A name's letters sorted, any case: "UR", "RU" and "ur" are the same piece (names of different types never share letters and length)
  pieceKey: (name) => name.toUpperCase().split("").sort().join(""),
  // The centers never move against each other: where they are says how the cube is held
  frame: "CENTERS",
  // Faces in opposite pairs
  faces: ["U", "D", "F", "B", "R", "L"],
  // U and F face the solver, R and L are seen at a slant, B and D not at all
  sight: { U: 1, F: 1, R: 1, L: 1, B: 0, D: 0 },
  defaultMoves: ["U", "R", "F", "D", "L", "B"],
  extraMoves: ["M", "E", "S"],
  turnFamilies: { face: ["U", "R", "F", "D", "L", "B"], slice: ["M", "E", "S"], wide: ["Uw", "Rw", "Fw", "Dw", "Lw", "Bw"] },
  rotations: ["x", "y", "z"],
  // The rotation that puts each face on the bottom, D (none) first
  bottoms: { D: "", U: "x2", F: "x'", B: "x", R: "z", L: "z'" },
  // y turns pick the front
  fronts: ["", "y", "y2", "y'"],
  scramble: async () => (await randomScrambleForEvent("333")).toString(),
  // Solved in any grip, centers turned any way
  isSolved: (pattern) => pattern.experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true }),
  solveFull: (pattern) => experimentalSolve3x3x3IgnoringCenters(pattern),
  algSets: ["OLL", "PLL", "ZBLL"],
  viewer: { puzzle: "3x3x3" },
};
