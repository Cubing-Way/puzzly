// The loaded cube definition, and the cube as it's held after a scramble and some moves (grips are judged by the centers); cached, since they come back again and again

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Cube patterns
import type { KPuzzle, KPattern } from "cubing/kpuzzle";
// Puzzle model
import { cube3x3x3 } from "cubing/puzzles";
// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Lookup caches
import { lookupCache, remember, clearLookupCaches } from "./cache";
// Piece names and grips
import { ALL_GRIPS } from "./cube";
// Move text helpers
import { joinMoves, rotationsIn, invertMoves } from "./moves";

// Cube definition, filled in by loadEngine()
export let kpuzzle: KPuzzle;
// Grip for each center layout ("U,L,F,R,B,D" order of center numbers → rotation)
const gripByCenters = new Map<string, string>();

// The solved cube after some moves (grips, offsets, a scramble), by move text
const turnedSolved = lookupCache<KPattern>();
// The cube held in a grip after a scramble, by grip and scramble (a step start then only applies the moves after the scramble)
const scrambledInGrip = lookupCache<KPattern>();
// The cube held after a scramble and some moves, by both
const heldAfter = lookupCache<KPattern>();

// The solved cube after these moves (kept, since grips and offsets come back again and again)
export function solvedAfter(moves: string): KPattern {
  return remember(turnedSolved, moves, () => kpuzzle.defaultPattern().applyAlg(moves));
}

// Load the cube definition; loadEngine awaits this once before the engine is used
export async function loadPuzzle(): Promise<void> {
  kpuzzle = await cube3x3x3.kpuzzle();
  // Cached cubes and lookups belong to the old definition
  clearLookupCaches();
  // Remember where the centers end up for each of the 24 grips
  for (const grip of ALL_GRIPS) gripByCenters.set(centerLayout(kpuzzle.defaultPattern().applyAlg(grip)), grip);
}

// Center numbers in spot order, as a lookup key
export function centerLayout(pattern: KPattern): string {
  return pattern.patternData["CENTERS"].pieces.join();
}

// Whole-cube rotation hidden in a move sequence (rotations, slices or wide moves), found from where the centers ended up
export function netRotation(moves: string): string {
  return gripByCenters.get(centerLayout(solvedAfter(moves))) ?? "";
}

// Grip after `scramble` then `done`: the scramble is judged by where its centers ended up,
// after that only x, y, z change the grip (slice and wide moves turn centers, not the hand)
export function gripAfter(scramble: string, done = ""): string {
  return joinMoves(netRotation(scramble), rotationsIn(done));
}

// The cube after `scramble` then `done`, renumbered so piece numbers mean "home spot in the grip it's held in now"
// (kept, as is the scramble held in each grip, so a method search's step starts mostly apply nothing, or only the moves after the scramble)
export function heldPattern(scramble: string, done = ""): KPattern {
  return remember(heldAfter, `${scramble}\n${done}`, () => {
    const grip = gripAfter(scramble, done);
    const scrambled = remember(scrambledInGrip, `${grip}\n${scramble}`, () => kpuzzle.defaultPattern().applyAlg(new Alg(grip).invert()).applyAlg(joinMoves(scramble)));
    return done.trim() ? scrambled.applyAlg(joinMoves(done)) : scrambled;
  });
}

// Note a held cube worked out another way (e.g. a step's held cube plus its answer's moves), so heldPattern needn't apply every move again
export function noteHeld(scramble: string, done: string, held: KPattern): void {
  remember(heldAfter, `${scramble}\n${done}`, () => held);
}

// The cube after `scramble` then `done`, held in another grip (a rotation from the grip it's held in): heldPattern(scramble, done + rotation),
// made by turning the held cube instead of applying every move again
export function heldInGrip(scramble: string, done: string, rotation: string): KPattern {
  if (!rotation) return heldPattern(scramble, done);
  return remember(heldAfter, `${scramble}\n${joinMoves(done, rotation)}`, () => {
    // Held cube as a transformation of the solved cube, done between the rotation's inverse and the rotation
    const held = heldPattern(scramble, done).experimentalToTransformation();
    return held ? solvedAfter(invertMoves(rotation)).applyTransformation(held).applyAlg(rotation) : heldPattern(scramble, joinMoves(done, rotation));
  });
}

// Read move text; throws a clear error on moves the 3x3x3 doesn't have, returns the cleaned-up moves
export function parseMoves(text: string): string {
  const alg = new Alg(text.trim());
  kpuzzle.defaultPattern().applyAlg(alg);
  return alg.toString();
}

// New random-state 3x3x3 scramble
export async function randomScramble(): Promise<string> {
  return (await randomScrambleForEvent("333")).toString();
}
