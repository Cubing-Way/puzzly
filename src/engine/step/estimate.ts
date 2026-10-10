// Estimates: how far each goal piece is on its own under the allowed moves, to rank a step's combos before the worker measures them

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Lookup caches
import { remember, lookupCache } from "../core/cache";
// Loaded cube definition and held cubes
import { kpuzzle } from "../core/puzzle";
// Engine data shapes
import type { Goal } from "../types";

// How one piece type moves on its own: a piece state is spot × twists + twist, and each allowed move (R, R2, R' count apart) maps every state to the next
interface PieceMoves {
  twists: number; // twist values a piece of this type can have
  next: number[][]; // one lookup per allowed move: state before → state after
}

// Lookups for each piece type under the allowed moves, so a single piece's distance can be found without touching the rest of the cube
export function pieceMoves(moves: string[]): Record<string, PieceMoves> {
  return remember(pieceMovesMade, moves.join(" "), () => makePieceMoves(moves));
}

// Piece lookups already made, by allowed moves
const pieceMovesMade = lookupCache<Record<string, PieceMoves>>();

// Make pieceMoves' lookups
function makePieceMoves(moves: string[]): Record<string, PieceMoves> {
  const solved = kpuzzle.defaultPattern();
  const tables: Record<string, PieceMoves> = {};
  for (const orbit of kpuzzle.definition.orbits) tables[orbit.orbitName] = { twists: orbit.numOrientations, next: [] };
  for (const move of moves) {
    // Every power of the move (R, R2, R'), until it comes back to solved
    for (let turned = solved.applyMove(move); !turned.isIdentical(solved); turned = turned.applyMove(move)) {
      for (const [orbitName, table] of Object.entries(tables)) {
        const { pieces, orientation } = turned.patternData[orbitName];
        const next: number[] = [];
        // The piece that was on spot `from` lands on spot `to`, twisted by that spot's change
        pieces.forEach((from, to) => {
          for (let twist = 0; twist < table.twists; twist++) {
            next[from * table.twists + twist] = to * table.twists + ((twist + orientation[to]) % table.twists);
          }
        });
        table.next.push(next);
      }
    }
  }
  return tables;
}

// Fewest allowed moves that take one piece from `state` to a state the goal accepts (Infinity if the moves can't get it there)
function pieceDistance(table: PieceMoves, state: number, accepts: (state: number) => boolean): number {
  const seen = new Set([state]);
  // Breadth-first: every state reachable in `depth` moves, one layer at a time (a piece has only ~24 states)
  for (let layer = [state], depth = 0; layer.length; depth++) {
    if (layer.some(accepts)) return depth;
    const nextLayer: number[] = [];
    for (const from of layer) {
      for (const move of table.next) {
        if (seen.has(move[from])) continue;
        seen.add(move[from]);
        nextLayer.push(move[from]);
      }
    }
    layer = nextLayer;
  }
  return Infinity;
}

// How easy a grip × offset looks: each goal piece's own fewest moves to a spot the goal accepts (in any of the offset's targets: one, or one per placement of the relative groups).
// The largest is a sure lower bound on the answer (bound); the sum ranks how far off the goal looks overall (total)
export function estimate(held: KPattern, start: KPattern, targets: KPattern[], goal: Goal, tables: Record<string, PieceMoves>): { bound: number; total: number } {
  let bound = 0;
  let total = 0;
  for (const [orbitName, table] of Object.entries(tables)) {
    const roles = goal[orbitName] ?? {};
    const now = held.patternData[orbitName];
    const masked = start.patternData[orbitName];
    const wants = targets.map((target) => target.patternData[orbitName]);
    now.pieces.forEach((piece, spot) => {
      // Pieces the goal ignores don't count
      if (!roles[piece]) return;
      // A state is accepted when its spot wants this piece's (shared) id in some target, with the right twist unless the twist is ignored there
      const id = masked.pieces[spot];
      const accepts = (state: number) => {
        const at = Math.floor(state / table.twists);
        for (const want of wants) {
          const mod = want.orientationMod?.[at] || table.twists;
          if (want.pieces[at] === id && (state % table.twists) % mod === want.orientation[at] % mod) return true;
        }
        return false;
      };
      const moves = pieceDistance(table, spot * table.twists + now.orientation[spot], accepts);
      bound = Math.max(bound, moves);
      total += moves;
    });
  }
  return { bound, total };
}
