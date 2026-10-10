// Method files: read plain method data (parsed JSON) into a checked method with every field filled in

// Piece names and grips
import { BOTTOM_TURNS } from "../core/cube";
// Move text helpers
import { FACE_MOVES, rotationsIn } from "../core/moves";
// Loaded cube definition and held cubes
import { parseMoves } from "../core/puzzle";
// BLD buffers and parity
import { bufferFromText, parityFromText } from "../goal/bld";
// Roles, goal text and goal masks
import { readAlternatives, splitAlternatives, goalFromText } from "../goal/goal";
// Offsets a goal counts up to
import { offsetsFromText } from "../goal/offsets";
// Solvable-with moves
import { solvableFromText } from "../goal/solvable";
// Goals that keep every other piece untouched
import { checkUntouchedRoles } from "../goal/untouched";
// Error messages
import { UNTOUCHED_MIX } from "../messages";
// Engine data shapes
import type { Method, StepConfig } from "../types";

// Read method data (e.g. parsed JSON) into a Method with every field filled in, in a fixed order; throws a clear error on a bad field
export function readMethod(data: unknown): Method {
  const method = (data ?? {}) as Partial<Method>;
  if (!Array.isArray(method.steps)) throw new Error("A method needs a list of steps.");
  return { name: String(method.name ?? "").trim() || "Untitled method", steps: method.steps.map(readStep) };
}

// Read one step's data, filling defaults (D bottom, face turns, no offsets or solvable-with moves, nothing untouched, no buffer, no limit, no lookahead, no repeat)
// and checking pieces, grips, offsets, solvable-with moves, the BLD fields, moves and lookahead
function readStep(data: unknown, index: number): StepConfig {
  const step = (data ?? {}) as Partial<StepConfig>;
  const typed = String(step.name ?? "").trim();
  const name = typed || `Step ${index + 1}`;
  try {
    // BLD buffer (a buffer step traces its own pieces, so its pieces text stays empty)
    const buffer = bufferFromText(String(step.buffer ?? ""));
    // Goal pieces: alternatives written with " | " (a JSON list counts as alternatives too), no typos, and at least one piece unless the step keeps earlier ones or has a buffer
    const keep = Boolean(step.keep);
    const given: unknown = step.pieces;
    const pieces = readAlternatives(Array.isArray(given) ? given.join("|") : String(given ?? ""), !keep && !buffer).join(" | ");
    if (buffer && pieces) throw new Error("A step with a buffer picks its own pieces (the next targets of the buffer's cycle): leave its pieces empty.");
    // Grips: faces that may go on the bottom
    const bottom = (step.grips?.bottom ?? ["D"]).map((face) => String(face).toUpperCase());
    if (!bottom.length || !bottom.every((face) => Object.hasOwn(BOTTOM_TURNS, face))) throw new Error("Bottom faces must be some of U D F B R L.");
    // Offsets text (checked by reading it)
    const offsets = String(step.offsets ?? "").trim();
    offsetsFromText(offsets);
    // Solvable-with moves (checked by reading them, written back one space apart)
    const solvableWith = solvableFromText(String(step.solvableWith ?? "")).join(" ");
    // Untouched (always with a buffer): no offsets or solvable-with moves, and only solved / :p / :x pieces
    const untouched = Boolean(step.untouched) || Boolean(buffer);
    if (untouched && (offsets || solvableWith)) throw new Error(UNTOUCHED_MIX);
    if (untouched) for (const alternative of splitAlternatives(pieces)) checkUntouchedRoles(goalFromText(alternative));
    // BLD targets per step (a whole number from 1) and parity pieces
    const targetsPerStep = Number(step.targetsPerStep ?? 2);
    if (!(Number.isInteger(targetsPerStep) && targetsPerStep >= 1)) throw new Error("Targets per step must be a whole number from 1 (2 = 3-cycles).");
    const parity = parityFromText(String(step.parity ?? ""));
    // Allowed moves: one real move per entry, no whole-cube turns
    const moves = (step.moves ?? FACE_MOVES).map((move) => parseMoves(String(move)));
    if (!moves.length || moves.some((move) => !move || /\s/.test(move) || rotationsIn(move))) {
      throw new Error("Allowed moves must be a list of single moves without x, y, z.");
    }
    // Depth limit: a whole number, or null for none
    const maxDepth = step.maxDepth == null ? null : Number(step.maxDepth);
    if (maxDepth !== null && !(Number.isInteger(maxDepth) && maxDepth >= 0)) throw new Error("Max depth must be a whole number (or null for no limit).");
    // Lookahead: later steps that judge this step's answers, and how many moves longer than the shortest a candidate may be (0 = none)
    const lookahead = Number(step.lookahead ?? 0);
    const extraMoves = Number(step.extraMoves ?? 0);
    if (![lookahead, extraMoves].every((value) => Number.isInteger(value) && value >= 0)) throw new Error("Lookahead and extra moves must be whole numbers (0 = none).");
    return {
      name,
      pieces,
      keep,
      grips: { bottom, anyFront: Boolean(step.grips?.anyFront) },
      offsets,
      solvableWith,
      untouched,
      buffer,
      targetsPerStep,
      parity,
      moves,
      maxDepth,
      firstFound: Boolean(step.firstFound),
      lookahead,
      extraMoves,
      repeat: Boolean(step.repeat),
    };
  } catch (error) {
    // Say which step is wrong (by number, plus its name when it has one)
    throw new Error(`Step ${index + 1}${typed ? ` (${typed})` : ""}: ${(error as Error).message}`);
  }
}
