// The 21 cases of permuting the last layer (PLL), each with its usual alg first: the default the engine makes when it recognises the case, then other
// common algs for it (another angle, a writing without the cube turn). Every alg ends with the cube held as it started (an x … x' pair, a y … y').
// A list from memory of the usual alg sheets, to correct and add to; `node bench/out/alg-sets.js` checks it

// One case of an alg set: its name and its algs, the default first
import type { AlgCase } from "./sets";

// A case by its letter
const pll = (name: string, ...algs: string[]): AlgCase => ({ name: `${name} perm`, algs });

export const PLL_CASES: AlgCase[] = [
  // Corners only
  pll("Aa", "x R' U R' D2 R U' R' D2 R2 x'", "x' R2 D2 R' U' R D2 R' U R' x"),
  pll("Ab", "x R2 D2 R U R' D2 R U' R x'", "x' R U' R D2 R' U R D2 R2 x"),
  pll("E", "x' R U' R' D R U R' D' R U R' D R U' R' D' x"),
  // Edges only
  pll("H", "M2 U M2 U2 M2 U M2"),
  pll("Ua", "M2 U M U2 M' U M2", "R U' R U R U R U' R' U' R2", "R2 U' R' U' R U R U R U' R"),
  pll("Ub", "M2 U' M U2 M' U' M2", "R2 U R U R' U' R' U' R' U R'", "R' U R' U' R' U' R' U R U R2"),
  pll("Z", "M' U M2 U M2 U M' U2 M2", "M2 U M2 U M' U2 M2 U2 M'"),
  // Two corners and two edges swapped
  pll("T", "R U R' U' R' F R2 U' R' U' R U R' F'"),
  pll("Ja", "x R2 F R F' R U2 r' U r U2 x'", "L' U' L F L' U' L U L F' L2 U L", "R' U L' U2 R U' R' U2 R L"),
  pll("Jb", "R U R' F' R U R' U' R' F R2 U' R'"),
  pll("F", "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"),
  pll("Ra", "R U' R' U' R U R D R' U' R D' R' U2 R'", "R U R' F' R U2 R' U2 R' F R U R U2 R'"),
  pll("Rb", "R2 F R U R U' R' F' R U2 R' U2 R", "R' U2 R U2 R' F R U R' U' R' F' R2"),
  pll("Y", "F R U' R' U' R U R' F' R U R' U' R' F R F'"),
  pll("V", "R' U R' U' y R' F' R2 U' R' U R' F R F y'", "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2"),
  pll("Na", "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"),
  pll("Nb", "R' U R U' R' F' U' F R U R' F R' F' R U' R"),
  // Cycles of corners and edges
  pll("Ga", "R2 U R' U R' U' R U' R2 D U' R' U R D'"),
  pll("Gb", "R' U' R U D' R2 U R' U R U' R U' R2 D"),
  pll("Gc", "R2 U' R U' R U R' U R2 D' U R U' R' D"),
  pll("Gd", "R U R' U' D R2 U' R U' R' U R' U R2 D'"),
];
