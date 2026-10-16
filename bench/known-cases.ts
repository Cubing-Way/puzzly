// Algs solvers agree on, by step, for bench/known-algs.ts: the first alg of a case sets it up (undone on a solved cube), the rest are other common algs
// for the same case or writings of the first. A list from memory of the usual alg sheets, to be corrected and added to

// One case: its name, its step and its algs
export interface Case {
  name: string;
  group: "f2l" | "oll" | "pll";
  algs: string[];
}

// A case of each step
const f2l = (name: string, ...algs: string[]): Case => ({ name, group: "f2l", algs });
const oll = (name: string, ...algs: string[]): Case => ({ name, group: "oll", algs });
const pll = (name: string, ...algs: string[]): Case => ({ name, group: "pll", algs });

// Every case, step by step
export const CASES: Case[] = [
  // First two layers, front-right slot, the other slots solved
  f2l("F2L insert", "R U R'"),
  f2l("F2L insert U", "U R U' R'"),
  f2l("F2L front insert", "F' U' F", "y' R' U' R", "y L' U' L"),
  f2l("F2L front insert U'", "U' F' U F", "y' U' R' U R", "y U' L' U L", "d' L' U L"),
  f2l("F2L 3-move split", "U' R U R' U2 R U' R'"),
  f2l("F2L split U2", "U' R U2 R' U2 R U' R'"),
  f2l("F2L U R U2", "U R U2 R' U R U' R'"),
  f2l("F2L U2 R U R'", "U2 R U R' U R U' R'"),
  f2l("F2L R U2 R'", "R U2 R' U' R U R'"),
  f2l("F2L U' R U' R'", "U' R U' R' U R U R'"),
  f2l("F2L U' R U R' U R U R'", "U' R U R' U R U R'"),
  f2l("F2L back pull", "R' U2 R2 U R2 U R"),
  f2l("F2L pair out-in", "R U' R' U R U' R'"),
  f2l("F2L corner in slot", "R U' R' U R U2 R' U R U' R'"),
  f2l("F2L corner in slot 2", "R U R' U' R U2 R' U' R U R'"),
  f2l("F2L triple sexy", "R U R' U' R U R' U' R U R'"),
  f2l("F2L sledge", "U' R' F R F' R U' R'"),
  f2l("F2L hedge", "U R U' R' F R' F' R"),
  f2l("F2L edge in slot", "U R U' R' U' R U' R' U R U' R'", "R U' R' U F' U' F U' F' U' F"),
  // Orienting the last layer
  oll("OLL 27 Sune", "R U R' U R U2 R'"),
  oll("OLL 26 Antisune", "R U2 R' U' R U' R'", "R' U' R U' R' U2 R", "L' U' L U' L' U2 L"),
  oll("OLL 21 H", "R U2 R' U' R U R' U' R U' R'", "R U R' U R U' R' U R U2 R'"),
  oll("OLL 22 Pi", "R U2 R2 U' R2 U' R2 U2 R"),
  oll("OLL 23 Headlights", "R2 D R' U2 R D' R' U2 R'", "R2 D' R U2 R' D R U2 R"),
  oll("OLL 24 Chameleon", "r U R' U' r' F R F'"),
  oll("OLL 25 Bowtie", "F' r U R' U' r' F R", "R' F R B' R' F' R B"),
  oll("OLL 45 T", "F R U R' U' F'"),
  oll("OLL 44 P", "f R U R' U' f'"),
  oll("OLL 43 P", "f' L' U' L U f", "R' U' F' U F R"),
  oll("OLL 33 T", "R U R' U' R' F R F'"),
  oll("OLL 37 Fish", "F R' F' R U R U' R'", "F R U' R' U' R U R' F'"),
  oll("OLL 48", "F R U R' U' R U R' U' F'"),
  oll("OLL 51", "f R U R' U' R U R' U' f'", "F U R U' R' U R U' R' F'"),
  oll("OLL 7", "r U R' U R U2 r'"),
  oll("OLL 8", "r' U' R U' R' U2 r", "l' U' L U' L' U2 l"),
  oll("OLL 5", "r' U2 R U R' U r", "l' U2 L U L' U l"),
  oll("OLL 6", "r U2 R' U' R U' r'"),
  oll("OLL 28", "r U R' U' r' R U R U' R'", "r U R' U' M U R U' R'"),
  oll("OLL 57", "R U R' U' M' U R U' r'"),
  oll("OLL 31", "R' U' F U R U' R' F' R"),
  oll("OLL 32", "L U F' U' L' U L F L'", "S R U R' U' R' F R f'"),
  oll("OLL 35", "R U2 R2 F R F' R U2 R'"),
  oll("OLL 46", "R' U' R' F R F' U R"),
  oll("OLL 40", "R' F R U R' U' F' U R"),
  oll("OLL 39", "L F' L' U' L U F U' L'"),
  oll("OLL 38", "R U R' U R U' R' U' R' F R F'"),
  oll("OLL 36", "L' U' L U' L' U L U L F' L' F", "R' U' R U' R' U R U R B' R' B", "R' F' U' F2 U R U' R' F' R"),
  oll("OLL 13", "F U R U' R2 F' R U R U' R'", "r U' r' U' r U r' F' U F"),
  oll("OLL 14", "R' F R U R' F' R F U' F'"),
  oll("OLL 9", "R U R' U' R' F R2 U R' U' F'"),
  oll("OLL 10", "R U R' U R' F R F' R U2 R'"),
  oll("OLL 34", "R U R2 U' R' F R U R U' F'", "R U R' U' B' R' F R F' B"),
  oll("OLL 49", "r U' r2 U r2 U r2 U' r"),
  oll("OLL 50", "r' U r2 U' r2 U' r2 U r'"),
  oll("OLL 53", "r' U' R U' R' U R U' R' U2 r", "l' U' L U' L' U L U' L' U2 l"),
  oll("OLL 54", "r U R' U R U' R' U R U2 r'"),
  oll("OLL 15", "r' U' r R' U' R U r' U r", "l' U' l L' U' L U l' U l"),
  oll("OLL 16", "r U r' R U R' U' r U' r'"),
  oll("OLL 2", "F R U R' U' F' f R U R' U' f'"),
  oll("OLL 41", "R U R' U R U2 R' F R U R' U' F'"),
  oll("OLL 42", "R' U' R U' R' U2 R F R U R' U' F'"),
  oll("OLL 55", "R U2 R2 U' R U' R' U2 F R F'", "R' F R U R U' R2 F' R2 U' R' U R U R'"),
  oll("OLL 52", "R U R' U R U' B U' B' R'", "R' F' U' F U' R U R' U R"),
  oll("OLL 1", "R U2 R2 F R F' U2 R' F R F'"),
  oll("OLL 20", "r U R' U' M2 U R U' R' U' M'"),
  // Permuting the last layer
  pll("PLL T", "R U R' U' R' F R2 U' R' U' R U R' F'"),
  pll("PLL Jb", "R U R' F' R U R' U' R' F R2 U' R'"),
  pll("PLL Ja", "x R2 F R F' R U2 r' U r U2 x'", "R' U L' U2 R U' R' U2 R L"),
  pll("PLL Y", "F R U' R' U' R U R' F' R U R' U' R' F R F'"),
  pll("PLL Ua", "M2 U M U2 M' U M2", "R U' R U R U R U' R' U' R2", "R2 U' R' U' R U R U R U' R"),
  pll("PLL Ub", "M2 U' M U2 M' U' M2", "R2 U R U R' U' R' U' R' U R'", "R' U R' U' R' U' R' U R U R2"),
  pll("PLL H", "M2 U M2 U2 M2 U M2"),
  pll("PLL Z", "M' U M2 U M2 U M' U2 M2", "M2 U M2 U M' U2 M2 U2 M'"),
  pll("PLL Aa", "x R' U R' D2 R U' R' D2 R2 x'", "l' U R' D2 R U' R' D2 R2 x'"),
  pll("PLL Ab", "x R2 D2 R U R' D2 R U' R x'", "x R2 D2 R U R' D2 R U' l"),
  pll("PLL E", "x' R U' R' D R U R' D' R U R' D R U' R' D' x"),
  pll("PLL F", "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"),
  pll("PLL V", "R' U R' U' y R' F' R2 U' R' U R' F R F", "R' U R' U' R D' R' D R' U D' R2 U' R2 D R2"),
  pll("PLL Ra", "R U' R' U' R U R D R' U' R D' R' U2 R'", "R U R' F' R U2 R' U2 R' F R U R U2 R'"),
  pll("PLL Rb", "R2 F R U R U' R' F' R U2 R' U2 R", "R' U2 R U2 R' F R U R' U' R' F' R2"),
  pll("PLL Ga", "R2 U R' U R' U' R U' R2 D U' R' U R D'"),
  pll("PLL Gb", "R' U' R U D' R2 U R' U R U' R U' R2 D"),
  pll("PLL Gc", "R2 U' R U' R U R' U R2 D' U R U' R' D"),
  pll("PLL Gd", "R U R' U' D R2 U' R U' R' U R' U R2 D'"),
  pll("PLL Na", "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"),
  pll("PLL Nb", "R' U R U' R' F' U' F R U R' F R' F' R U' R"),
];
