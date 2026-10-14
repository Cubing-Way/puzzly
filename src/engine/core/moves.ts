// Move text: face turns and whole-cube rotations, joining, inverting and counting moves

// Parses alg text into moves
import { Alg } from "cubing/alg";

// Face turns used when a step search isn't given its own moves
export const FACE_MOVES = ["U", "R", "F", "D", "L", "B"];

// Whole-cube rotations: they change the grip and don't count as moves
const ROTATIONS = ["x", "y", "z"];

// Join move texts with spaces, skipping empty ones
export function joinMoves(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

// One move as its layer (a face, a slice, a wide turn or a rotation), a count and a prime
const TURN = /^([A-Za-z]w?)(\d*)('?)$/;
// What follows a layer's letter, by its quarter turns clockwise (1 = plain, 2 = half, 3 = prime)
const SUFFIXES = ["", "", "2", "'"];

// A read move's quarter turns clockwise (0–3)
function quartersOf(turn: RegExpExecArray): number {
  return ((((turn[2] ? Number(turn[2]) : 1) * (turn[3] ? -1 : 1)) % 4) + 4) % 4;
}

// Steps' moves joined into one sequence, where a step that starts by turning the layer the moves before it ended on is joined with that turn:
// R then R' is nothing, U then U is U2, and whatever a cancelled pair brings together is joined in turn (… U R' then R U' … loses all four).
// Turns inside a step stay as they are
export function joinSteps(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) {
    const moves = part.split(/\s+/).filter(Boolean);
    let at = 0;
    // The step's first moves, as long as each turns the layer the sequence so far ends on
    for (; at < moves.length && out.length; at++) {
      const [last, next] = [TURN.exec(out[out.length - 1]), TURN.exec(moves[at])];
      if (!last || !next || last[1] !== next[1]) break;
      // Both turns as one: nothing left (the moves around them meet), or one turn that ends the joining
      const quarters = (quartersOf(last) + quartersOf(next)) % 4;
      out.pop();
      if (quarters) {
        out.push(last[1] + SUFFIXES[quarters]);
        at++;
        break;
      }
    }
    out.push(...moves.slice(at));
  }
  return out.join(" ");
}

// Only the x, y, z rotations of a move sequence, in order
export function rotationsIn(moves: string): string {
  // No x, y or z anywhere: nothing to parse (no other move has those letters)
  if (!/[xyz]/.test(moves)) return "";
  return Array.from(new Alg(moves).expand().experimentalLeafMoves())
    .filter((move) => ROTATIONS.includes(move.family))
    .join(" ");
}

// Moves that undo a move sequence (e.g. to take an offset back out)
export function invertMoves(moves: string): string {
  return new Alg(moves).invert().toString();
}

// Plain move text: moves and spaces only (no brackets, commas or comments), which needs no parsing to count
const PLAIN_MOVES = /^[A-Za-z0-9' ]*$/;

// Number of moves in an alg (R2 counts as one, whole-cube rotations don't count)
export function countMoves(alg: string): number {
  // Plain move text (every answer a search lists): one move per word that isn't a rotation
  if (PLAIN_MOVES.test(alg)) {
    let count = 0;
    for (const move of alg.split(" ")) if (move && !ROTATIONS.includes(move[0])) count++;
    return count;
  }
  return Array.from(new Alg(alg).experimentalLeafMoves()).filter((move) => !ROTATIONS.includes(move.family)).length;
}
