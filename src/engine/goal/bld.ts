// Blindfolded steps: the buffer's next targets as an untouched goal, the parity pieces, and reading both from text

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Piece names and grips
import { PIECE_NAMES } from "../core/cube";
// Loaded cube definition and held cubes
import { kpuzzle } from "../core/puzzle";
// Engine data shapes
import type { GoalPiece } from "../types";
// Roles, goal text and goal masks
import { parseGoalText } from "./goal";
// Goals that keep every other piece untouched
import { type Wanted, countedTwists } from "./untouched";

// A BLD step's goal: follow the cycle from the buffer for `count` targets: each target sends the buffer's piece home (solved) and brings the piece there to the buffer;
// when the buffer holds its own piece (a cycle closed), a new cycle starts at any unsolved spot (each choice is its own goal: the shortest wins), its piece taking
// the buffer's place. The buffer then holds whatever piece is left, with any twist (the others fix it). Nothing to trace = an empty goal (the cube as it is).
// A step starting with the buffer home may instead fix two pieces that are only twisted in place (flipped edges, twisted corners), like a BLD flip alg
export function traceWanted(held: KPattern, buffer: GoalPiece, count: number): Wanted[] {
  const { orbit, index: home } = buffer;
  const now = held.patternData[orbit];
  const wanted: Wanted[] = [];
  // Twist values that count for this piece type, and each spot's twist now
  const twistCount = countedTwists(orbit, kpuzzle.definition.orbits.find((info) => info.orbitName === orbit)!.numOrientations);
  const twistsNow = now.orientation.map((twist) => twist % twistCount);
  // Pieces home but twisted (not the buffer): with the buffer home and room for two targets, each pair of them is a goal of its own
  const twisted = now.pieces.flatMap((piece, spot) => (spot !== home && piece === spot && twistsNow[spot] !== 0 ? [spot] : []));
  if (now.pieces[home] === home && count >= 2) {
    twisted.forEach((first, index) => {
      for (const second of twisted.slice(index + 1)) {
        wanted.push({ set: { [orbit]: new Map([first, second].map((spot) => [spot, { piece: spot, twist: 0 }])) }, free: {} });
      }
    });
  }
  // pieces / twists: what each spot of the buffer's type holds as the step goes (twist null = not known yet), set: the spots the step has settled so far
  const walk = (pieces: number[], twists: (number | null)[], set: Map<number, { piece: number; twist: number | null }>, left: number): void => {
    if (left > 0) {
      const piece = pieces[home];
      // The buffer holds another piece: it goes home solved, and the piece there comes to the buffer
      if (piece !== home) {
        const next = [...pieces];
        const turned = [...twists];
        [next[home], turned[home], next[piece], turned[piece]] = [pieces[piece], null, piece, 0];
        walk(next, turned, new Map(set).set(piece, { piece, twist: 0 }), left - 1);
        return;
      }
      // Cycle closed: start a new one at any spot that isn't solved yet (the buffer's piece parks there for now)
      const unsolved = pieces.flatMap((holds, spot) => (spot !== home && (holds !== spot || twists[spot] !== 0) ? [spot] : []));
      if (unsolved.length) {
        for (const spot of unsolved) {
          const next = [...pieces];
          const turned = [...twists];
          [next[home], turned[home], next[spot], turned[spot]] = [pieces[spot], null, home, null];
          walk(next, turned, new Map(set).set(spot, { piece: home, twist: null }), left - 1);
        }
        return;
      }
    }
    // Done: the buffer ends holding the piece left there, any twist
    const final = new Map(set);
    if (final.size) final.set(home, { piece: pieces[home], twist: null });
    wanted.push({ set: { [orbit]: final }, free: {} });
  };
  walk([...now.pieces], twistsNow, new Map(), count);
  return wanted;
}

// The same goal where a BLD step's parity pieces may change too: swapping among themselves, each keeping its twist (like a parity alg's clean swap),
// or with `anyTwist` ending any way (spots the goal already settles are left out)
export function withParity(wanted: Wanted, pieces: GoalPiece[], anyTwist: boolean): Wanted {
  const spots: Record<string, Set<number>> = {};
  for (const [orbit, free] of Object.entries(anyTwist ? wanted.free : {})) spots[orbit] = new Set(free);
  for (const { orbit, index } of pieces) if (!wanted.set[orbit]?.has(index) && !wanted.free[orbit]?.has(index)) (spots[orbit] ??= new Set()).add(index);
  return anyTwist ? { set: wanted.set, free: spots } : { set: wanted.set, free: wanted.free, swap: spots };
}

// Read a BLD buffer ("UF", "ufr"…; "" = none) into its piece name; throws a clear error unless it's one edge or corner
export function bufferFromText(text: string): string {
  const pieces = parseGoalText(text);
  if (!pieces.length) return "";
  const [piece] = pieces;
  if (pieces.length > 1 || piece.orbit === "CENTERS" || piece.role !== "solve") throw new Error('The buffer is one edge or corner, e.g. "UF" or "UFR".');
  return PIECE_NAMES[piece.orbit][piece.index];
}

// Read BLD parity pieces ("UFR UBR"; "" = none) into piece names; throws a clear error on a typo or a role suffix
export function parityFromText(text: string): string {
  const pieces = parseGoalText(text);
  if (pieces.some((piece) => piece.role !== "solve")) throw new Error("Parity pieces are plain piece names, e.g. UFR UBR.");
  return pieces.map((piece) => PIECE_NAMES[piece.orbit][piece.index]).join(" ");
}
