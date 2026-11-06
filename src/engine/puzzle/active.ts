// The active puzzle: the one the engine works on (one at a time, the 3x3x3 until loadEngine is given another), and what the engine reads of it, worked
// out once per puzzle. Its values are live: a module that imports them sees the new puzzle's after a switch. No engine imports here, so any module may read it

// A puzzle's description
import type { PuzzleSpec } from "./spec";
// The 3x3x3's description
import { CUBE3 } from "./cube3";

// The active puzzle's description
export let puzzle: PuzzleSpec = CUBE3;
// Its piece names per piece type (the description's), its faces' bottom rotations and its front rotations, as the engine named them before (see core/cube.ts)
export let pieceNames: Record<string, string[]> = CUBE3.pieces;
export let bottomTurns: Record<string, string> = CUBE3.bottoms;
export let frontTurns: string[] = CUBE3.fronts;
// Its default moves (the face turns), and the turn families its moves come in, all kinds in one list (face, slice, wide)
export let defaultMoves: string[] = CUBE3.defaultMoves;
export let turnFamilies: string[] = [];
// Every grip, as rotations from how the puzzle is held: each bottom face's rotation followed by each front's, "as held" first
export let grips: string[] = [];
// Piece type for each name length, where every name of a type has one length and no other type's has it (the 3x3x3's: 1 = center, 2 = edge, 3 = corner)
export let orbitByLength: Record<number, string> = {};
// Each piece by its lookup key (see PuzzleSpec.pieceKey): its type and number
let pieceByKey = new Map<string, { orbit: string; index: number }>();
// The rotation moves' names, and their first letters (a move is a rotation when its first letter is one: x2, y'), also as a pattern that finds one in text
let rotationNames = new Set<string>();
let rotationLetters = new Set<string>();
let rotationLetterPattern = /$^/;

// Make a puzzle the active one and work out what the engine reads of it; true when another puzzle was active
export function usePuzzle(spec: PuzzleSpec): boolean {
  const changed = spec !== puzzle;
  puzzle = spec;
  pieceNames = spec.pieces;
  bottomTurns = spec.bottoms;
  frontTurns = spec.fronts;
  defaultMoves = spec.defaultMoves;
  turnFamilies = [...spec.turnFamilies.face, ...spec.turnFamilies.slice, ...spec.turnFamilies.wide];
  grips = Object.values(spec.bottoms).flatMap((bottom) => spec.fronts.map((front) => [bottom, front].filter(Boolean).join(" ")));
  // A length belongs to one type when all of that type's names have it and no other type's names do
  const lengths = Object.entries(spec.pieces).map(([orbit, names]) => ({ orbit, lengths: new Set(names.map((name) => name.length)) }));
  orbitByLength = {};
  for (const { orbit, lengths: own } of lengths) {
    const [length] = own;
    if (own.size === 1 && lengths.every((other) => other.orbit === orbit || !other.lengths.has(length))) orbitByLength[length] = orbit;
  }
  pieceByKey = new Map(Object.entries(spec.pieces).flatMap(([orbit, names]) => names.map((name, index) => [spec.pieceKey(name), { orbit, index }] as const)));
  rotationNames = new Set(spec.rotations);
  rotationLetters = new Set(spec.rotations.map((rotation) => rotation[0]));
  rotationLetterPattern = rotationLetters.size ? new RegExp(`[${[...rotationLetters].map((letter) => letter.replace(/[\]\\^-]/g, "\\$&")).join("")}]`) : /$^/;
  return changed;
}
usePuzzle(CUBE3);

// The piece a typed name stands for (any piece type), or undefined when it's none of the active puzzle's
export function pieceByName(name: string): { orbit: string; index: number } | undefined {
  return pieceByKey.get(puzzle.pieceKey(name));
}

// True when a move (one word of move text) is a whole-puzzle rotation
export function isRotation(move: string): boolean {
  return rotationLetters.has(move[0]);
}

// True when a move family (a move's name without its amount: x, R, Rw) is a whole-puzzle rotation
export function isRotationFamily(family: string): boolean {
  return rotationNames.has(family);
}

// True when text holds a rotation's first letter somewhere (no such letter: no rotation in it, nothing to parse)
export function mayHoldRotation(text: string): boolean {
  return rotationLetterPattern.test(text);
}
