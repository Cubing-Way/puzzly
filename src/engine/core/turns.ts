// Turns: allowed moves as the cube itself turns, so grips can be compared and a move can be named the way another grip sees it

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Lookup caches
import { remember, lookupCache } from "./cache";
// Move text helpers
import { joinMoves, invertMoves } from "./moves";
// Loaded cube definition and held cubes
import { solvedAfter } from "./puzzle";

// Allowed moves as turns of the cube itself in this grip (rotation, move, rotation back), so grips only merge when they allow the same turns
export function movesKey(rotation: string, moves: string[]): string {
  return remember(movesKeys, `${rotation}/${moves.join(" ")}`, () => {
    const back = new Alg(rotation).invert().toString();
    return moves
      .map((move) => JSON.stringify(solvedAfter(joinMoves(rotation, move, back)).patternData))
      .sort()
      .join("|");
  });
}

// Moves keys already worked out, by rotation and moves
const movesKeys = lookupCache<string>();

// Turn families a step's moves may use (face, slice and wide turns), to name a turn the way another grip sees it
const TURN_FAMILIES = ["U", "R", "F", "D", "L", "B", "M", "E", "S", "Uw", "Rw", "Fw", "Dw", "Lw", "Bw"];
// Moves renamed for another grip, by both grips and the move (null = no single move is that turn)
const movesRenamed = lookupCache<string | null>();

// A move as the turns it allows: a quarter turn by its family alone (its powers are the same moves either way round), any other with its amount (e.g. "R2")
function turnName(move: string): string {
  const leaf = Array.from(new Alg(move).experimentalLeafMoves())[0];
  if (!leaf) return move;
  const amount = Math.abs(leaf.amount);
  return amount === 1 ? leaf.family : `${leaf.family}${amount}`;
}

// A move named in one grip, named the way another grip sees the same turn (both grips as rotations from one hold), e.g. R in grip y is B as held;
// quarter turns come without the prime (see turnName), null when no single move is that turn
export function moveInGrip(move: string, from: string, to: string): string | null {
  if (from === to) return turnName(move);
  return remember(movesRenamed, `${from}/${move}/${to}`, () => {
    // The turn as the cube itself turns it in a grip (rotation, move, rotation back)
    const turn = (rotation: string, name: string) => JSON.stringify(solvedAfter(joinMoves(rotation, name, invertMoves(rotation))).patternData);
    const wanted = turn(from, move);
    // The move that turns the cube the same way in the other grip
    for (const family of TURN_FAMILIES) {
      for (const amount of ["", "2", "'"]) if (turn(to, family + amount) === wanted) return turnName(family + amount);
    }
    return null;
  });
}

// Moves with each turn once (see turnName); a half turn whose quarter turn is there too is left out, as one of its powers
export function distinctTurns(moves: string[]): string[] {
  const names = [...new Set(moves.map(turnName))];
  return names.filter((name) => !(name.endsWith("2") && names.includes(name.slice(0, -1))));
}

// Moves named as the cube is held (see turnName), named for a grip; a list from `prefer` instead when it allows the same turns
// (a step's own list, so a measure shares its tables); null when one has no single-move name there
export function movesForGrip(turns: string[], rotation: string, prefer: string[][]): string[] | null {
  const named: string[] = [];
  for (const turn of turns) {
    const name = moveInGrip(turn, "", rotation);
    if (name === null) return null;
    named.push(name);
  }
  const allowed = distinctTurns(named);
  // Same turns: the same names once each list is tidied the same way
  const same = (list: string[]) => {
    const other = distinctTurns(list);
    return other.length === allowed.length && other.every((name) => allowed.includes(name));
  };
  return prefer.find(same) ?? allowed;
}
