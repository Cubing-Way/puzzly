// The loaded puzzle definition, and the puzzle as it's held after a scramble and some moves (grips: by the frame, or by rotation moves alone without one, hand turns aside); cached

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Puzzle patterns
import type { KPuzzle, KPattern } from "cubing/kpuzzle";
// Lookup caches
import { lookupCache, remember, clearLookupCaches } from "./cache";
// Move text helpers
import { joinMoves, rotationsIn, invertMoves, withoutHandTurns } from "./moves";
// The active puzzle and its grips
import { puzzle, grips, usePuzzle } from "../puzzle/active";
// A puzzle's description
import type { PuzzleSpec } from "../puzzle/spec";
// The 3x3x3's description
import { CUBE3 } from "../puzzle/cube3";

// Puzzle definition, filled in by loadEngine()
export let kpuzzle: KPuzzle;
// The description whose definition is loaded (null before the first load)
let loaded: PuzzleSpec | null = null;
// Grip for each layout of the pieces that tell it (see gripLayout: the 3x3x3's centers in "U,L,F,R,B,D" order; every piece on a puzzle without a frame)
const gripByFrame = new Map<string, string>();

// The solved puzzle after some moves (grips, offsets, a scramble), by move text
const turnedSolved = lookupCache<KPattern>();
// The puzzle held in a grip after a scramble, by grip and scramble (a step start then only applies the moves after the scramble)
const scrambledInGrip = lookupCache<KPattern>();
// The puzzle held after a scramble and some moves, by both
const heldAfter = lookupCache<KPattern>();

// The solved puzzle after these moves (kept, since grips and offsets come back again and again)
export function solvedAfter(moves: string): KPattern {
  return remember(turnedSolved, moves, () => kpuzzle.defaultPattern().applyAlg(moves));
}

// Make a puzzle the active one and load its definition (the 3x3x3 when none is given); loadEngine awaits this before the engine is used. Every lookup cache
// is emptied (their entries belong to the old definition); true when another puzzle was active
export async function loadPuzzle(spec: PuzzleSpec = CUBE3): Promise<boolean> {
  const definition = await spec.kpuzzle();
  const changed = usePuzzle(spec);
  kpuzzle = definition;
  loaded = spec;
  // Cached patterns and lookups belong to the old definition
  clearLookupCaches();
  // Remember where the pieces that tell the grip end up for each grip
  gripByFrame.clear();
  for (const grip of grips) gripByFrame.set(gripLayout(kpuzzle.defaultPattern().applyAlg(grip)), grip);
  return changed;
}

// Load a puzzle unless it's the one loaded already (workers and the server are sent the puzzle with each message); true when another puzzle was active
export async function loadPuzzleOnce(spec: PuzzleSpec): Promise<boolean> {
  return spec === loaded ? false : loadPuzzle(spec);
}

// Frame piece numbers in spot order (the 3x3x3's centers), as a lookup key ("" when the puzzle has no frame)
export function centerLayout(pattern: KPattern): string {
  return puzzle.frame ? pattern.patternData[puzzle.frame].pieces.join() : "";
}

// Where the pieces that tell the grip are, as a lookup key: the frame's, or on a puzzle without a frame every piece's place and twist
function gripLayout(pattern: KPattern): string {
  if (puzzle.frame) return centerLayout(pattern);
  return Object.values(pattern.patternData).map(({ pieces, orientation }) => `${pieces.join()}/${orientation.join()}`).join(";");
}

// The rotations of some moves that change the grip: all with a frame; without one, all but hand turns ("(x2)" keeps the names, as R L' does on a 2x2x2; see homeTurn)
function gripTurnsIn(moves: string): string {
  return rotationsIn(puzzle.frame ? moves : withoutHandTurns(moves));
}

// The grip rule: with a frame, a move sequence's grip is where its frame pieces end up (slices and wide moves count); without one, only its rotation moves count, hand turns left out
export function netRotation(moves: string): string {
  return gripByFrame.get(gripLayout(solvedAfter(puzzle.frame ? moves : gripTurnsIn(moves)))) ?? "";
}

// The whole puzzle solved in some grip (every piece home and untwisted as one of the grips holds it): the check when a description has no isSolved
export function solvedInSomeGrip(pattern: KPattern): boolean {
  return grips.some((grip) => pattern.isIdentical(solvedAfter(grip)));
}

// Grip after `scramble` then `done`: the scramble by the grip rule, then only rotations change it (slice and wide moves turn centers, not the hand; on a 2x2x2 R L' and "(x)" move the pieces as x does but keep the grip)
export function gripAfter(scramble: string, done = ""): string {
  return joinMoves(netRotation(scramble), gripTurnsIn(done));
}

// The puzzle after `scramble` then `done`, renumbered so piece numbers mean "home spot in the grip it's held in now"
// (kept, as is the scramble held in each grip, so a method search's step starts mostly apply nothing, or only the moves after the scramble)
export function heldPattern(scramble: string, done = ""): KPattern {
  return remember(heldAfter, `${scramble}\n${done}`, () => {
    const grip = gripAfter(scramble, done);
    const scrambled = remember(scrambledInGrip, `${grip}\n${scramble}`, () => kpuzzle.defaultPattern().applyAlg(new Alg(grip).invert()).applyAlg(joinMoves(scramble)));
    return done.trim() ? scrambled.applyAlg(joinMoves(done)) : scrambled;
  });
}

// Note a held puzzle worked out another way (e.g. a step's held puzzle plus its answer's moves), so heldPattern needn't apply every move again
export function noteHeld(scramble: string, done: string, held: KPattern): void {
  remember(heldAfter, `${scramble}\n${done}`, () => held);
}

// The puzzle after `scramble` then `done`, held in another grip (a rotation from the grip it's held in): heldPattern(scramble, done + rotation),
// made by turning the held puzzle instead of applying every move again
export function heldInGrip(scramble: string, done: string, rotation: string): KPattern {
  if (!rotation) return heldPattern(scramble, done);
  return remember(heldAfter, `${scramble}\n${joinMoves(done, rotation)}`, () => {
    // Held puzzle as a transformation of the solved one, done between the rotation's inverse and the rotation
    const held = heldPattern(scramble, done).experimentalToTransformation();
    return held ? solvedAfter(invertMoves(rotation)).applyTransformation(held).applyAlg(rotation) : heldPattern(scramble, joinMoves(done, rotation));
  });
}

// Read move text; throws a clear error on moves the active puzzle doesn't have, returns the cleaned-up moves
export function parseMoves(text: string): string {
  const alg = new Alg(text.trim());
  kpuzzle.defaultPattern().applyAlg(alg);
  return alg.toString();
}

// New random-state scramble of the active puzzle
export async function randomScramble(): Promise<string> {
  return puzzle.scramble();
}
