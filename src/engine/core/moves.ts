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

// Where each center ends up after some rotations, as one text (the centers in the order of "UDRLFB"): rotations that turn the cube the same way give
// the same text
function heldAfter(rotations: string[]): string {
  let sides = "UDRLFB";
  for (const rotation of rotations) {
    const read = TURN.exec(rotation)!;
    const cycle = CYCLES[read[1]];
    for (let quarter = quartersOf(read); quarter > 0; quarter--) sides = sides.replace(/./g, (side) => (cycle.includes(side) ? cycle[(cycle.indexOf(side) + 1) % 4] : side));
  }
  return sides;
}

// The fewest rotations for each way the cube can be turned (24): none, one, or a bottom turn (x or z) and a y turn, as grips are named (see BOTTOM_TURNS
// and FRONT_TURNS in cube.ts), so no axis comes twice
const SHORTEST = new Map<string, string[]>();
for (const run of [
  [],
  ...["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"].map((rotation) => [rotation]),
  ...["x2", "x'", "x", "z", "z'"].flatMap((bottom) => ["y", "y2", "y'"].map((front) => [bottom, front])),
]) {
  const held = heldAfter(run);
  if (!SHORTEST.has(held)) SHORTEST.set(held, run);
}

// Rotations in a row written the short way when they turn about an axis twice or are more than two (z y z is x y2, x' y x is z'); null when they're
// short already
function shortRun(run: string[]): string[] | null {
  if (run.length < 2 || (run.length === 2 && run[0][0] !== run[1][0])) return null;
  return SHORTEST.get(heldAfter(run))!;
}

// Moves with every run of rotations in a row written the short way (see shortRun). The cube ends up turned the same way, so the moves after them are
// named the same: a grip rotation and the rotation that makes up for a wide turn (z y then z) become one grip
export function shortRotations(moves: string): string {
  // Two rotations in a row at least, or there's nothing to shorten
  if (!/(?:^|\s)[xyz]\S*\s+[xyz]/.test(moves)) return moves;
  const tokens = moves.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let at = 0; at < tokens.length; ) {
    let end = at;
    while (end < tokens.length && ROTATIONS.includes(tokens[end][0])) end++;
    if (end === at) {
      out.push(tokens[at++]);
      continue;
    }
    const run = tokens.slice(at, end);
    out.push(...(shortRun(run) ?? run));
    at = end;
  }
  return out.join(" ");
}

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

// Moves without the rotations they end with: what the hands make when the solve is over at their last turn (x' R U' R' D … D' x is made without the x)
export function withoutEndRotations(moves: string): string {
  const tokens = moves.split(/\s+/).filter(Boolean);
  return tokens.slice(0, turnsEnd(tokens)).join(" ");
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
// with a rotation about its axis the moves before end with (x' then x is nothing), or goes after them, and the rotations they then end with are
// written the short way (see shortRun: x' then y x is z'). A turn, named as the cube was held before the
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
    // A rotation: as one with a rotation about its axis right before it, otherwise after the moves before; then the rotations they end with the short way
    if (ROTATIONS.includes(next[1])) {
      const last = out.length ? TURN.exec(out[out.length - 1]) : null;
      if (last && last[1] === next[1]) {
        out.pop();
        kept = Math.min(kept, out.length);
        const both = (quartersOf(last) + quarters) % 4;
        if (both) out.push(next[1] + SUFFIXES[both]);
      } else out.push(moves[at]);
      const end = turnsEnd(out);
      const short = shortRun(out.slice(end));
      if (short) {
        out.splice(end, out.length - end, ...short);
        kept = Math.min(kept, end);
      }
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

// Where a step's pieces are looked for: on the cube as the moves so far leave it, before the step's grip `rotation`. When that rotation is made as one
// with rotations the moves so far end with (a step that only turned the cube y2, then y2 is nothing; y then y is y2), the hands never hold the cube
// between them, so it's the cube before those, with them and the grip rotation as one rotation (else a y2 the next step undoes would show a back pair
// in plain sight for free)
export function lookedFrom(done: string, rotation: string): { done: string; rotation: string } {
  const tokens = done.split(/\s+/).filter(Boolean);
  const end = turnsEnd(tokens);
  if (!rotation.trim() || end === tokens.length) return { done, rotation };
  const trailing = tokens.slice(end).join(" ");
  const joined = joinSteps(trailing, rotation);
  return joined === joinMoves(trailing, rotation) ? { done, rotation } : { done: tokens.slice(0, end).join(" "), rotation: joined };
}

// Steps' moves joined into one sequence, each step's first moves joined with the moves before it (see joinOnto)
export function joinSteps(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts) joinOnto(out, part.split(/\s+/).filter(Boolean));
  return out.join(" ");
}

// Steps' moves joined as joinSteps joins them, with where each step starts among the joined moves (a step whose first turn was made as one with the
// moves before it starts at that turn), so a speed cost can start each step's own counts over there (see speed/fingering.ts)
export interface JoinedSteps {
  moves: string;
  starts: number[];
}

// No steps joined yet
export const NO_STEPS: JoinedSteps = { moves: "", starts: [] };

// One more step's moves joined onto the steps joined so far (an earlier step whose moves its first turns cancelled away now starts where it does)
export function joinStep(joined: JoinedSteps, moves: string): JoinedSteps {
  const out = joined.moves.split(/\s+/).filter(Boolean);
  const start = joinOnto(out, moves.split(/\s+/).filter(Boolean));
  return { moves: out.join(" "), starts: [...joined.starts.map((at) => Math.min(at, start)), start] };
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
  return (moves) => {
    const tokens = moves.split(/\s+/).filter(Boolean);
    // The rotations the moves start with, and their first turn
    let first = 0;
    while (first < tokens.length && ROTATIONS.includes(tokens[first][0])) first++;
    // A first rotation joins the rotations the moves before end with (as one with the last, or written short with them); otherwise the first turn has
    // to meet one of their last turns (with two rotations or more first, which may join each other, the whole joining is made)
    if (first === 0 || (first === 1 && !trailing.length)) {
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
