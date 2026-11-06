// The active puzzle's pieces and grips under the names the engine had when it only knew the 3x3x3 (live: they follow loadEngine's puzzle), for the test
// bench and apps; the engine itself reads puzzle/active.ts

// The active puzzle
import { puzzle, pieceNames, orbitByLength, bottomTurns, frontTurns, grips } from "../puzzle/active";
// Move text helpers
import { joinMoves } from "./moves";

// Piece names per type, in the definition's order: the position in each list is the piece number
export { pieceNames as PIECE_NAMES };
// Piece type for each name length (on the 3x3x3: 1 letter = center, 2 = edge, 3 = corner)
export { orbitByLength as ORBIT_BY_LENGTH };
// Rotation that puts each face (as held now) on the bottom
export { bottomTurns as BOTTOM_TURNS };
// Rotations that pick a new front face while keeping the bottom (y turns on the 3x3x3)
export { frontTurns as FRONT_TURNS };
// Every grip (24 rotations on the 3x3x3, "as held" first)
export { grips as ALL_GRIPS };

// A typed piece name as it's looked up (on the 3x3x3 its letters sorted, so "UR", "RU" and "ur" all mean the same piece)
export function normalizeName(name: string): string {
  return puzzle.pieceKey(name);
}

// Grips to try: each allowed bottom face, with all the fronts or just the current one
export function gripRotations(bottoms: string[], anyFront: boolean): string[] {
  return bottoms.flatMap((face) => (anyFront ? frontTurns : [""]).map((front) => joinMoves(bottomTurns[face], front)));
}
