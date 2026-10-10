// "Solvable with" moves: a goal also counts when these moves alone can finish it later. Reading their text, which target they reach, and which pieces they can't disturb

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf, cellMoves, moveCells, type CellMove } from "../core/cells";
// Move text helpers
import { rotationsIn } from "../core/moves";
// Loaded cube definition and held cubes
import { parseMoves, kpuzzle } from "../core/puzzle";
// Engine data shapes
import type { Goal } from "../types";
// A goal's targets
import { maskedTarget } from "./targets";

// Read "solvable with" text into its moves ("R U" → ["R", "U"]; spaces or commas between them, "" = none); throws a clear error on a bad move or a whole-cube turn
export function solvableFromText(text: string): string[] {
  const moves: string[] = [];
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    // Clean up the move (throws on moves the 3x3x3 doesn't have)
    const move = parseMoves(word);
    // Whole-cube turns are grips, not moves that finish a goal
    if (rotationsIn(move)) throw new Error(`Solvable with "${move}" turns the whole cube: list face or slice moves (e.g. R U).`);
    // Keep each move once
    if (!moves.includes(move)) moves.push(move);
  }
  return moves;
}

// Most patterns a "solvable with" check walks through (the search worker refuses goals with more end states than this too)
const MAX_SOLVABLE_STATES = 100_000;

// Which target the start reaches with only these moves (the earliest in the list when several do, so no offset wins when it can; -1 when none does):
// breadth-first from the start through every pattern those moves reach
export function solvableIndex(start: KPattern, targets: KPattern[], moves: string[]): number {
  // Each target's key (a repeated target keeps its first index)
  const wanted = new Map<string, number>();
  targets.forEach((target, index) => {
    const key = cellsKey(cellsOf(target));
    if (!wanted.has(key)) wanted.set(key, index);
  });
  const turns = cellMoves(moves);
  const first = cellsOf(start);
  const seen = new Set([cellsKey(first)]);
  const queue = [first];
  // Earliest target found so far (the first one can't be beaten)
  let best = -1;
  for (let next = 0; next < queue.length; next++) {
    const found = wanted.get(cellsKey(queue[next]));
    if (found !== undefined && (best === -1 || found < best)) best = found;
    if (best === 0) return best;
    // Every move from here, keeping new patterns only (up to the cap)
    for (const turn of turns) {
      const moved = moveCells(queue[next], turn);
      const key = cellsKey(moved);
      if (seen.has(key) || seen.size >= MAX_SOLVABLE_STATES) continue;
      seen.add(key);
      queue.push(moved);
    }
  }
  return best;
}

// True when every mix of the moves leaves spot `at` holding what it holds now: follows where the spot's content could come from, and the twist it gains on the way
function keepsCell(cells: Uint16Array, at: number, turns: CellMove[]): boolean {
  const seen = new Set([`${at}/0`]);
  const queue: [number, number][] = [[at, 0]];
  for (const [spot, twist] of queue) {
    // The content of `spot`, brought to `at` with `twist` gained, must be what `at` holds (same piece and mod, same twist where it counts)
    const cell = cells[spot];
    const mod = (cell >> 4) & 15;
    if ((cell & ~15) !== (cells[at] & ~15) || ((cell & 15) + twist) % (mod || turns[0].count[at]) !== (cells[at] & 15)) return false;
    // One more move before the others: the content comes from where that move takes it from
    for (const turn of turns) {
      const step: [number, number] = [turn.from[spot], (twist + turn.twist[spot]) % turn.count[spot]];
      const key = `${step[0]}/${step[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(step);
    }
  }
  return true;
}

// The goal's pieces that the "solvable with" moves can't disturb, so later steps may keep them: every mix of those moves leaves the same piece on their spot, turned the same way
// where that counts (under R U: the left D-layer pieces, and the edges' orientation; not the R- and U-layer corners)
export function settledGoal(goal: Goal, moves: string[]): Goal {
  if (!moves.length) return goal;
  const turns = cellMoves(moves);
  const target = cellsOf(maskedTarget(goal));
  const settled: Goal = {};
  // First cell of each piece type
  let offset = 0;
  for (const { orbitName, numPieces } of kpuzzle.definition.orbits) {
    for (const [spot, role] of Object.entries(goal[orbitName] ?? {})) {
      if (keepsCell(target, offset + Number(spot), turns)) (settled[orbitName] ??= {})[Number(spot)] = role;
    }
    offset += numPieces;
  }
  return settled;
}
