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

// The axis each layer turns about, by its letter (wide and lowercase turns too): turns about one axis in a row can be made in any order
const AXES: Record<string, string> = { R: "x", L: "x", M: "x", U: "y", D: "y", E: "y", F: "z", B: "z", S: "z" };
// Faces each rotation moves, each to the next one's place (x turns like R, y like U, z like F)
const CYCLES: Record<string, string> = { x: "FUBD", y: "FLBR", z: "URDL" };

// A turn's layer as the cube was named before some rotations (R after y is B before it), for a face turn, a wide one (Rw) or a lowercase one (r);
// null for a slice turn after a rotation
function layerBefore(layer: string, rotations: string[]): string | null {
  if (!rotations.length) return layer;
  let face = layer[0].toUpperCase();
  if (!"UDRLFB".includes(face)) return null;
  // Rotations undone last first: after a quarter turn, a side holds the face that was on the side before it in the cycle
  for (const rotation of [...rotations].reverse()) {
    const read = TURN.exec(rotation)!;
    const cycle = CYCLES[read[1]];
    for (let quarter = quartersOf(read); quarter > 0; quarter--) if (cycle.includes(face)) face = cycle[(cycle.indexOf(face) + 3) % 4];
  }
  return layer === layer.toLowerCase() ? face.toLowerCase() : face + layer.slice(1);
}

// Where the turns of some moves end: the rotations they end with come after
function turnsEnd(out: string[]): number {
  let end = out.length;
  while (end > 0 && ROTATIONS.includes(out[end - 1][0])) end--;
  return end;
}

// The last of some moves' turns (up to `end`) on a layer, past turns on other layers about its axis (they can be made in any order); -1 = none
function meetAt(out: string[], end: number, layer: string): number {
  const axis = AXES[layer[0].toUpperCase()];
  for (let meet = end - 1; meet >= 0; meet--) {
    const turn = TURN.exec(out[meet]);
    if (turn && turn[1] === layer) return meet;
    if (!turn || !axis || AXES[turn[1][0].toUpperCase()] !== axis) return -1;
  }
  return -1;
}

// One step's moves joined onto the moves before it (`out`, changed in place); gives how many of those moves stay as they were. A rotation is made as one
// with a rotation about its axis the moves before end with (x' then x is nothing), or goes after them. A turn, named as the cube was held before the
// rotations they end with, is made as one with their last turn on its layer, past turns about its axis (those can be made in any order): R then R' is
// nothing, U then U is U2, R then y F' is y, R L then R' is L. Whatever a cancelled pair brings together is joined in turn (… U R' then R U' … loses
// all four); a turn that stays ends the joining, and turns inside the step stay as they are
function joinOnto(out: string[], moves: string[]): number {
  let kept = out.length;
  let at = 0;
  for (; at < moves.length; at++) {
    const next = TURN.exec(moves[at]);
    if (!next) break;
    const quarters = quartersOf(next);
    // A rotation: as one with a rotation about its axis right before it, otherwise after the moves before
    if (ROTATIONS.includes(next[1])) {
      const last = out.length ? TURN.exec(out[out.length - 1]) : null;
      if (!last || last[1] !== next[1]) {
        out.push(moves[at]);
        continue;
      }
      out.pop();
      kept = Math.min(kept, out.length);
      const both = (quartersOf(last) + quarters) % 4;
      if (both) out.push(next[1] + SUFFIXES[both]);
      continue;
    }
    // A turn: its layer as named before the rotations the moves before end with, and their last turn on it (none: the joining ends)
    const end = turnsEnd(out);
    const layer = layerBefore(next[1], out.slice(end));
    const meet = layer === null ? -1 : meetAt(out, end, layer);
    if (meet < 0) break;
    const met = TURN.exec(out[meet])!;
    // Both turns as one: nothing left (the moves around them meet), or one turn that ends the joining
    const both = (quartersOf(met) + quarters) % 4;
    out.splice(meet, 1, ...(both ? [met[1] + SUFFIXES[both]] : []));
    kept = Math.min(kept, meet);
    if (both) {
      at++;
      break;
    }
  }
  out.push(...moves.slice(at));
  return kept;
}

// Steps' moves joined into one sequence, each step's first moves joined with the moves before it (see joinOnto)
export function joinSteps(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) joinOnto(out, part.split(/\s+/).filter(Boolean));
  return out.join(" ");
}

// A step's moves after the moves before it, joined as joinSteps joins them: the part of the moves before that stays as it was (`kept`), and everything
// after it (`rest`: what's left of the step, with the turn it was made as one with); null when nothing is joined
export function cancelInto(before: string, moves: string): { kept: string; rest: string } | null {
  const out = before.split(/\s+/).filter(Boolean);
  const length = out.length;
  const kept = joinOnto(out, moves.split(/\s+/).filter(Boolean));
  return kept === length ? null : { kept: out.slice(0, kept).join(" "), rest: out.slice(kept).join(" ") };
}

// cancelInto for many steps' moves after the same moves (a step scoring thousands of answers): those are read once, and moves whose start can't join
// them are told so at once, without copying them
export function cancelsInto(before: string): (moves: string) => { kept: string; rest: string } | null {
  const out = before.split(/\s+/).filter(Boolean);
  const end = turnsEnd(out);
  const trailing = out.slice(end);
  const last = out.length ? TURN.exec(out[out.length - 1]) : null;
  return (moves) => {
    const tokens = moves.split(/\s+/).filter(Boolean);
    // The rotations the moves start with, and their first turn
    let first = 0;
    while (first < tokens.length && ROTATIONS.includes(tokens[first][0])) first++;
    // A first rotation joins a rotation about its axis the moves before end with; otherwise the first turn has to meet one of their last turns (with
    // two rotations or more first, which may join each other, the whole joining is made)
    if (first < 2 && !(first > 0 && last && TURN.exec(tokens[0])?.[1] === last[1])) {
      const next = first < tokens.length ? TURN.exec(tokens[first]) : null;
      const layer = next && layerBefore(next[1], [...trailing, ...tokens.slice(0, first)]);
      if (!layer || meetAt(out, end, layer) < 0) return null;
    }
    const joined = [...out];
    const kept = joinOnto(joined, tokens);
    return kept === out.length ? null : { kept: joined.slice(0, kept).join(" "), rest: joined.slice(kept).join(" ") };
  };
}

// How many moves a step adds after the moves before it, joined as joinSteps joins them (fewer than its own where its first turns cancel into theirs)
export function movesAfter(moves: string, before: string): number {
  const cut = cancelInto(before, moves);
  return cut ? countMoves(cut.rest) - countMoves(before) + countMoves(cut.kept) : countMoves(moves);
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
