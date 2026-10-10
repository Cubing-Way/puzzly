// Cells: a pattern as one number per spot, for quick lookups and breadth-first walks over many patterns

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Loaded cube definition and held cubes
import { kpuzzle } from "./puzzle";

// A pattern as one number per spot (piece types in the puzzle's order): piece × 256 + orientation mod × 16 + twist, for quick "solvable with" checks
export function cellsOf(pattern: KPattern): Uint16Array {
  const cells: number[] = [];
  for (const { orbitName, numOrientations } of kpuzzle.definition.orbits) {
    const { pieces, orientation, orientationMod } = pattern.patternData[orbitName];
    pieces.forEach((piece, spot) => {
      const mod = orientationMod?.[spot] ?? 0;
      cells.push(piece * 256 + mod * 16 + (orientation[spot] % (mod || numOrientations)));
    });
  }
  return Uint16Array.from(cells);
}

// One move as cell lookups: spot i takes the cell on spot from[i] and gains twist[i], wrapping at count[i] (its piece type's orientations) unless the piece's own mod is smaller
export interface CellMove {
  from: number[];
  twist: number[];
  count: number[];
}

// "Solvable with" moves as cell lookups
export function cellMoves(moves: string[]): CellMove[] {
  return moves.map((move) => {
    const data = kpuzzle.moveToTransformation(move).transformationData;
    const cellMove: CellMove = { from: [], twist: [], count: [] };
    // First cell of each piece type
    let offset = 0;
    for (const { orbitName, numPieces, numOrientations } of kpuzzle.definition.orbits) {
      const { permutation, orientationDelta } = data[orbitName];
      for (let spot = 0; spot < numPieces; spot++) {
        cellMove.from.push(offset + permutation[spot]);
        cellMove.twist.push(orientationDelta[spot]);
        cellMove.count.push(numOrientations);
      }
      offset += numPieces;
    }
    return cellMove;
  });
}

// Cells after one move (orientation mods travel with their pieces; a twist wraps at the piece's mod, or at its type's orientations when it has none)
export function moveCells(cells: Uint16Array, move: CellMove): Uint16Array {
  const out = new Uint16Array(cells.length);
  for (let spot = 0; spot < cells.length; spot++) {
    const cell = cells[move.from[spot]];
    const mod = (cell >> 4) & 15;
    out[spot] = (cell & ~15) | (((cell & 15) + move.twist[spot]) % (mod || move.count[spot]));
  }
  return out;
}

// Lookup key of some cells
export function cellsKey(cells: Uint16Array): string {
  return String.fromCharCode(...cells);
}
