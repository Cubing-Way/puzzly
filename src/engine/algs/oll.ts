// The 57 cases of orienting the last layer (OLL), each with its usual alg first: the default the engine makes when it recognises the case, then other
// common algs for it (another angle, the left-handed mirror). A list from memory of the usual alg sheets, to correct and add to;
// `node bench/out/alg-sets.js` checks that every alg keeps the first two layers and that the set covers every case

// One case of an alg set: its name and its algs, the default first
import type { AlgCase } from "./sets";

// A case by its number and shape
const oll = (name: string, ...algs: string[]): AlgCase => ({ name: `OLL ${name}`, algs });

export const OLL_CASES: AlgCase[] = [
  // No edge turned right (dots)
  oll("1", "R U2 R2 F R F' U2 R' F R F'"),
  oll("2", "F R U R' U' F' f R U R' U' f'", "r U r' U2 R U2 R' U2 r U' r'"),
  oll("3", "r' R2 U R' U r U2 r' U M'", "f R U R' U' f' U' F R U R' U' F'"),
  oll("4", "M U' r U2 r' U' R U' R' M'", "f R U R' U' f' U F R U R' U' F'"),
  oll("17", "F R' F' R2 r' U R U' R' U' M'", "R U R' U R' F R F' U2 R' F R F'"),
  oll("18", "r U R' U R U2 r2 U' R U' R' U2 r"),
  oll("19", "r' R U R U R' U' M' R' F R F'"),
  oll("20", "r U R' U' M2 U R U' R' U' M'"),
  // Squares and small lightning bolts
  oll("5", "r' U2 R U R' U r", "l' U2 L U L' U l"),
  oll("6", "r U2 R' U' R U' r'"),
  oll("7", "r U R' U R U2 r'"),
  oll("8", "r' U' R U' R' U2 r", "l' U' L U' L' U2 l"),
  oll("11", "r U R' U R' F R F' R U2 r'", "r' R2 U R' U R U2 R' U M'"),
  oll("12", "M' R' U' R U' R' U2 R U' R r'", "F R U R' U' F' U F R U R' U' F'"),
  // Fish
  oll("9", "R U R' U' R' F R2 U R' U' F'"),
  oll("10", "R U R' U R' F R F' R U2 R'"),
  oll("35", "R U2 R2 F R F' R U2 R'"),
  oll("37", "F R' F' R U R U' R'", "F R U' R' U' R U R' F'"),
  // Knight moves
  oll("13", "F U R U' R2 F' R U R U' R'", "r U' r' U' r U r' F' U F"),
  oll("14", "R' F R U R' F' R F U' F'"),
  oll("15", "r' U' r R' U' R U r' U r", "l' U' l L' U' L U l' U l"),
  oll("16", "r U r' R U R' U' r U' r'"),
  // Awkward shapes
  oll("29", "R U R' U' R U' R' F' U' F R U R'", "r2 D' r U r' D r2 U' r' U' r"),
  oll("30", "F R' F R2 U' R' U' R U R' F2", "F U R U2 R' U' R U2 R' U' F'"),
  oll("41", "R U R' U R U2 R' F R U R' U' F'"),
  oll("42", "R' U' R U' R' U2 R F R U R' U' F'"),
  // P shapes
  oll("31", "R' U' F U R U' R' F' R"),
  oll("32", "L U F' U' L' U L F L'", "S R U R' U' R' F R f'"),
  oll("43", "f' L' U' L U f", "R' U' F' U F R"),
  oll("44", "f R U R' U' f'", "F U R U' R' F'"),
  // W shapes
  oll("36", "L' U' L U' L' U L U L F' L' F", "R' U' R U' R' U R U R B' R' B", "R' F' U' F2 U R U' R' F' R"),
  oll("38", "R U R' U R U' R' U' R' F R F'"),
  // T, C and L shapes, lines and big lightning bolts
  oll("33", "R U R' U' R' F R F'"),
  oll("45", "F R U R' U' F'"),
  oll("34", "R U R2 U' R' F R U R U' F'", "R U R' U' B' R' F R F' B"),
  oll("46", "R' U' R' F R F' U R"),
  oll("47", "R' U' R' F R F' R' F R F' U R", "F' L' U' L U L' U' L U F"),
  oll("48", "F R U R' U' R U R' U' F'"),
  oll("49", "r U' r2 U r2 U r2 U' r"),
  oll("50", "r' U r2 U' r2 U' r2 U r'"),
  oll("53", "r' U' R U' R' U R U' R' U2 r", "l' U' L U' L' U L U' L' U2 l"),
  oll("54", "r U R' U R U' R' U R U2 r'"),
  oll("51", "f R U R' U' R U R' U' f'", "F U R U' R' U R U' R' F'"),
  oll("52", "R U R' U R U' B U' B' R'", "R' F' U' F U' R U R' U R"),
  oll("55", "R U2 R2 U' R U' R' U2 F R F'", "R' F R U R U' R2 F' R2 U' R' U R U R'"),
  oll("56", "r U r' U R U' R' U R U' R' r U' r'", "r' U' r U' R' U R U' R' U R r' U r"),
  oll("39", "L F' L' U' L U F U' L'"),
  oll("40", "R' F R U R' U' F' U R"),
  // Every edge turned right: the corners only
  oll("21", "R U2 R' U' R U R' U' R U' R'", "R U R' U R U' R' U R U2 R'"),
  oll("22", "R U2 R2 U' R2 U' R2 U2 R"),
  oll("23", "R2 D R' U2 R D' R' U2 R'", "R2 D' R U2 R' D R U2 R"),
  oll("24", "r U R' U' r' F R F'"),
  oll("25", "F' r U R' U' r' F R", "R' F R B' R' F' R B"),
  oll("26", "R U2 R' U' R U' R'", "R' U' R U' R' U2 R", "L' U' L U' L' U2 L"),
  oll("27", "R U R' U R U2 R'", "L' U2 L U L' U L"),
  // Every corner turned right: the edges only
  oll("28", "r U R' U' r' R U R U' R'", "r U R' U' M U R U' R'"),
  oll("57", "R U R' U' M' U R U' r'"),
];
