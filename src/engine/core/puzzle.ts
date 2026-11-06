// The loaded puzzle definition, and the puzzle as it's held after a scramble and some moves (grips are judged by the frame, the 3x3x3's centers); cached,
// since they come back again and again

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Puzzle patterns
import type { KPuzzle, KPattern } from "cubing/kpuzzle";
// Lookup caches
import { lookupCache, remember, clearLookupCaches } from "./cache";
// Move text helpers
import { joinMoves, rotationsIn, invertMoves } from "./moves";
// The active puzzle and its grips
import { puzzle, grips, usePuzzle } from "../puzzle/active";
// A puzzle's description
import type { PuzzleSpec } from "../puzzle/spec";
// The 3x3x3's description
import { CUBE3 } from "../puzzle/cube3";

// Puzzle definition, filled in by loadEngine()
export let kpuzzle: KPuzzle;
// Grip for each frame layout (the frame pieces' numbers in spot order → rotation; on the 3x3x3 "U,L,F,R,B,D" order of center numbers)
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
  const loaded = await spec.kpuzzle();
  const changed = usePuzzle(spec);
  kpuzzle = loaded;
  // Cached patterns and lookups belong to the old definition
  clearLookupCaches();
  // Remember where the frame pieces end up for each grip
  gripByFrame.clear();
  for (const grip of grips) gripByFrame.set(centerLayout(kpuzzle.defaultPattern().applyAlg(grip)), grip);
  return changed;
}

// Frame piece numbers in spot order (the 3x3x3's centers), as a lookup key ("" when the puzzle has no frame)
export function centerLayout(pattern: KPattern): string {
  return puzzle.frame ? pattern.patternData[puzzle.frame].pieces.join() : "";
}

// Whole-puzzle rotation hidden in a move sequence (rotations, slices or wide moves), found from where the frame pieces ended up
export function netRotation(moves: string): string {
  return gripByFrame.get(centerLayout(solvedAfter(moves))) ?? "";
}

// Grip after `scramble` then `done`: the scramble is judged by where its frame pieces ended up,
// after that only rotations (x, y, z) change the grip (slice and wide moves turn centers, not the hand)
export function gripAfter(scramble: string, done = ""): string {
  return joinMoves(netRotation(scramble), rotationsIn(done));
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
