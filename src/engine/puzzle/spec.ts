// A puzzle as the engine knows it: everything that makes one puzzle differ from another, as data the engine reads (it never asks a puzzle's name)

// Move sequences
import type { Alg } from "cubing/alg";
// Puzzle definitions and patterns
import type { KPuzzle, KPattern } from "cubing/kpuzzle";

// The turn families a puzzle's moves come in, by kind (what the speed model and its writings may use)
export interface TurnFamilies {
  face: string[]; // outer layers, e.g. U R F D L B
  slice: string[]; // inner layers turned on their own, e.g. M E S (none on a 2x2x2)
  wide: string[]; // an outer layer with the layers next to it, e.g. Uw Rw (none on a 2x2x2)
}

// What the 3D viewer needs to show the puzzle
export interface ViewerSpec {
  puzzle: string; // cubing.js's puzzle id for TwistyPlayer, e.g. "3x3x3"
}

// One puzzle's description
export interface PuzzleSpec {
  id: string; // short id, e.g. "3x3x3" (a method file's `puzzle`, from Part 3 of plan-puzzles.md)
  name: string; // name to show, e.g. "3x3x3 cube"
  kpuzzle: () => Promise<KPuzzle>; // loads the puzzle definition (pieces, moves, the solved pattern)
  pieces: Record<string, string[]>; // piece names per piece type, in the definition's order: the position in each list is the piece number
  pieceKey: (name: string) => string; // a typed piece name as it's looked up (on the 3x3x3 its letters sorted, so "UR", "RU" and "ur" are one piece)
  frame: string | null; // the grip rule: the piece type whose place says how the puzzle is held (the 3x3x3's centers), or null = held as it was, only rotation moves change the grip
  faces: string[]; // the faces, as the messages list them
  sight: Record<string, number>; // how much of a sticker on each face the solver sees with the puzzle held as it is (the look model's faces, see speed/look.ts)
  defaultMoves: string[]; // moves a step may use when it's given none (the 3x3x3's six face turns, the 2x2x2's R U F)
  extraMoves: string[]; // moves a step may be given beyond those (the page's move boxes offer them), e.g. M E S, or the 2x2x2's D L B
  turnFamilies: TurnFamilies; // the turn families its moves come in, by kind
  rotations: string[]; // whole-puzzle rotations: they change the grip and don't count as moves
  bottoms: Record<string, string>; // the rotation that puts each face (as held now) on the bottom, in the order grips are tried ("as held" first)
  fronts: string[]; // the rotations that pick a front while keeping the bottom ("as held" first); every grip = a bottom's rotation, then a front's
  scramble: () => Promise<string>; // a new random-state scramble
  isSolved?: (pattern: KPattern) => boolean; // the whole puzzle solved, in whatever grip it's held (none: every piece home in one of the grips, see solvedInSomeGrip)
  solveFull?: (pattern: KPattern) => Promise<Alg>; // solves the whole puzzle (none: the engine has no full solver for it)
  algSets: string[]; // names of the alg sets that belong to it (see algs/sets.ts)
  viewer: ViewerSpec; // what the 3D viewer needs
}
