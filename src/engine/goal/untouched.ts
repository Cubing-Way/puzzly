// Untouched goals: every piece the goal doesn't list stays as it is. What such a goal asks of the cube held now, the end states it allows, and relabeling so the end state is the solved cube

// Cube patterns
import { KPattern } from "cubing/kpuzzle";
// Piece names and grips
import { PIECE_NAMES } from "../core/cube";
// Loaded cube definition and held cubes
import { kpuzzle } from "../core/puzzle";
// Error messages
import { UNTOUCHED_ROLES } from "../messages";
// Engine data shapes
import type { Goal, Role } from "../types";
// A goal's targets
import { arrangements } from "./targets";

// The pattern with every piece renamed after the spot it has in `by` (its twist counted from its twist there), so `by` itself becomes the solved cube.
// Moves act on spots, not on names, so the moves from `pattern` to `by` are the same as from the renamed pattern to solved: every untouched step (a BLD
// 3-cycle, a parity) becomes "solve the whole cube" from a cube that's solved but for a few pieces, and they all share one set of tables
export function relabel(pattern: KPattern, by: KPattern): KPattern {
  const data = structuredClone(pattern.patternData);
  for (const { orbitName, numOrientations } of kpuzzle.definition.orbits) {
    const want = by.patternData[orbitName];
    // Each piece's new name (its spot in `by`) and the twist it has there
    const name: number[] = [];
    const twist: number[] = [];
    want.pieces.forEach((piece, spot) => {
      name[piece] = spot;
      twist[piece] = want.orientation[spot];
    });
    // Rename every piece, counting its twist from the one it should end with
    const orbit = data[orbitName];
    orbit.pieces.forEach((piece, spot) => {
      const mod = orbit.orientationMod?.[spot] || numOrientations;
      orbit.orientation[spot] = (((orbit.orientation[spot] - twist[piece]) % mod) + mod) % mod;
      orbit.pieces[spot] = name[piece];
    });
  }
  return new KPattern(kpuzzle, data);
}

// Twist values that count in a piece type: none when the puzzle ignores them (the 3x3x3's centers), else all of them
export function countedTwists(orbitName: string, numOrientations: number): number {
  const mods = kpuzzle.defaultPattern().patternData[orbitName].orientationMod;
  return mods?.every((mod) => mod === 1) ? 1 : numOrientations;
}

// What no move sequence can hide about going from one pattern to another: per piece type, the parity of how the pieces were permuted
// and the sum of the twists they gained (one number each, in the puzzle's orbit order)
function changeOf(from: KPattern, to: KPattern): number[] {
  const orbits = kpuzzle.definition.orbits;
  const parities = orbits.map(({ orbitName }) => {
    const before = from.patternData[orbitName].pieces;
    const after = to.patternData[orbitName].pieces;
    // Spot each piece came from, then the permutation's parity from its cycles (parity = pieces − cycles, mod 2)
    const cameFrom = after.map((piece) => before.indexOf(piece));
    const seen = new Set<number>();
    let cycles = 0;
    for (let spot = 0; spot < cameFrom.length; spot++) {
      if (seen.has(spot)) continue;
      cycles++;
      for (let at = spot; !seen.has(at); at = cameFrom[at]) seen.add(at);
    }
    return (cameFrom.length - cycles) % 2;
  });
  const twists = orbits.map(({ orbitName, numOrientations }) => {
    const count = countedTwists(orbitName, numOrientations);
    const sum = (pattern: KPattern) => pattern.patternData[orbitName].orientation.reduce((total, twist) => total + twist, 0);
    return (((sum(to) - sum(from)) % count) + count) % count;
  });
  return [...parities, ...twists];
}

// Every change (as changeOf numbers) the allowed moves can make: a small group, found from each move's own change (for face turns: edge and corner parities
// flip together, twists always sum to 0). A wanted end state whose change isn't in it can't be reached by any sequence of those moves
export function reachableChanges(moves: string[]): Set<string> {
  const solved = kpuzzle.defaultPattern();
  const orbits = kpuzzle.definition.orbits;
  // Each move's change, and how each number wraps (parities at 2, twist sums at the counted twists)
  const steps = moves.map((move) => changeOf(solved, solved.applyMove(move)));
  const wraps = [...orbits.map(() => 2), ...orbits.map(({ orbitName, numOrientations }) => countedTwists(orbitName, numOrientations))];
  // Breadth-first from "no change", adding one move's change at a time
  const zero = wraps.map(() => 0);
  const seen = new Set([zero.join()]);
  const queue = [zero];
  for (const change of queue) {
    for (const step of steps) {
      const next = change.map((value, index) => (value + step[index]) % wraps[index]);
      if (seen.has(next.join())) continue;
      seen.add(next.join());
      queue.push(next);
    }
  }
  return seen;
}

// What an untouched step asks for, per piece type: spots that must end holding a given piece (twist null = any twist), spots that may end holding
// any of the pieces left over (any twist), and spots whose pieces may swap among themselves, each keeping its twist (a BLD parity); every other spot keeps what it holds now
export interface Wanted {
  set: Record<string, Map<number, { piece: number; twist: number | null }>>;
  free: Record<string, Set<number>>;
  swap?: Record<string, Set<number>>;
}

// Throws unless every role of an untouched goal is solved, :p or :x
export function checkUntouchedRoles(goal: Goal): void {
  for (const roles of Object.values(goal)) {
    if (Object.values(roles).some((role) => role !== "solve" && role !== "place" && role !== "free")) throw new Error(UNTOUCHED_ROLES);
  }
}

// An untouched goal on the cube held now: each listed piece goes home (turned right, or any way for :p), the pieces in its way and the :x spots
// make up the spots that may change (the pieces pushed out fill the spots the listed ones leave); every other piece stays
export function untouchedWanted(held: KPattern, goal: Goal): Wanted {
  checkUntouchedRoles(goal);
  const wanted: Wanted = { set: {}, free: {} };
  for (const { orbitName } of kpuzzle.definition.orbits) {
    const roles = goal[orbitName] ?? {};
    const set = (wanted.set[orbitName] = new Map());
    const free = (wanted.free[orbitName] = new Set<number>());
    // Listed pieces go home (the solved cube holds piece n on spot n)
    for (const [piece, role] of Object.entries(roles)) {
      if (role !== "free") set.set(Number(piece), { piece: Number(piece), twist: role === "solve" ? 0 : null });
    }
    // Spots a listed piece leaves, and :x spots, may take any piece left over
    held.patternData[orbitName].pieces.forEach((piece, spot) => {
      if (set.has(spot)) return;
      if (set.has(piece) || roles[spot] === "free") free.add(spot);
    });
  }
  return wanted;
}

// Most ways an untouched step's spots that may change can be filled (each one is searched as its own goal)
const MAX_UNTOUCHED_TARGETS = 5_000;

// Every end state an untouched goal allows: settled spots as asked, the pieces left over in every order on the spots that may change, every twist where it's free,
// swap spots' pieces in every order with their own twists; only the ones the allowed moves could reach (same permutation parities and twist sums as some mix of the moves) are kept
export function completions(held: KPattern, wanted: Wanted, reachable: Set<string>): KPattern[] {
  // Each piece type's ways to end, as its pieces and twists per spot
  const perOrbit = kpuzzle.definition.orbits.map(({ orbitName, numPieces, numOrientations }) => {
    const now = held.patternData[orbitName];
    const set = wanted.set[orbitName] ?? new Map();
    const free = [...(wanted.free[orbitName] ?? [])].filter((spot) => !set.has(spot)).sort((a, b) => a - b);
    const swap = [...(wanted.swap?.[orbitName] ?? [])].filter((spot) => !set.has(spot) && !free.includes(spot)).sort((a, b) => a - b);
    const twists = countedTwists(orbitName, numOrientations);
    // Pieces with a spot already (settled, staying where they are, or swapping among the swap spots), and the ones left for the free spots
    const placed = new Set([...set.values()].map((entry) => entry.piece));
    now.pieces.forEach((piece, spot) => {
      if (!set.has(spot) && !free.includes(spot)) placed.add(piece);
    });
    const left = Array.from({ length: numPieces }, (_, piece) => piece).filter((piece) => !placed.has(piece));
    // Swap spots' pieces, each with the twist it has now
    const swapping = swap.map((spot) => ({ piece: now.pieces[spot], twist: now.orientation[spot] }));
    // Spots whose twist is free: settled ones without a twist, and every free spot
    const open = [...[...set].filter(([, entry]) => entry.twist === null).map(([spot]) => spot), ...free];
    const ways: { pieces: number[]; orientation: number[] }[] = [];
    for (const order of arrangements(left, String)) {
      for (const swapped of arrangements(swapping, (entry) => String(entry.piece))) {
        const pieces = [...now.pieces];
        const orientation = [...now.orientation];
        for (const [spot, entry] of set) [pieces[spot], orientation[spot]] = [entry.piece, entry.twist ?? 0];
        order.forEach((piece, index) => (pieces[free[index]] = piece));
        swapped.forEach((entry, index) => ([pieces[swap[index]], orientation[swap[index]]] = [entry.piece, entry.twist]));
        // Every twist of the open spots (counted like a number in base `twists`)
        for (let code = 0; code < twists ** open.length; code++) {
          const turned = [...orientation];
          open.forEach((spot, index) => (turned[spot] = Math.floor(code / twists ** index) % twists));
          ways.push({ pieces, orientation: turned });
        }
      }
    }
    return { orbitName, ways };
  });
  const total = perOrbit.reduce((product, { ways }) => product * ways.length, 1);
  if (total > MAX_UNTOUCHED_TARGETS) {
    throw new Error(`More than ${MAX_UNTOUCHED_TARGETS.toLocaleString("en")} ways to fill the spots that may change: mark fewer pieces :x (or give fewer parity pieces).`);
  }
  // Every mix of the piece types' ways, keeping the reachable ones
  let patterns = [structuredClone(held.patternData)];
  for (const { orbitName, ways } of perOrbit) {
    patterns = patterns.flatMap((data) =>
      ways.map((way) => {
        const copy = structuredClone(data);
        copy[orbitName].pieces = way.pieces;
        copy[orbitName].orientation = way.orientation;
        return copy;
      }),
    );
  }
  return patterns.map((data) => new KPattern(kpuzzle, data)).filter((want) => reachable.has(changeOf(held, want).join()));
}

// The goal pieces a wanted end state solves (home, turned right), and every spot it may change, as goals named like the held cube's spots
export function untouchedPieces(wanted: Wanted): { solved: Goal; changed: Goal } {
  const solved: Goal = {};
  const changed: Goal = {};
  for (const [orbit, set] of Object.entries(wanted.set)) {
    for (const [spot, { piece, twist }] of set) {
      (changed[orbit] ??= {})[spot] = "solve";
      if (piece === spot && twist === 0) (solved[orbit] ??= {})[spot] = "solve";
    }
  }
  for (const spots of [wanted.free, wanted.swap ?? {}]) {
    for (const [orbit, list] of Object.entries(spots)) for (const spot of list) (changed[orbit] ??= {})[spot] = "solve";
  }
  return { solved, changed };
}

// Every piece solved, centers included: what an untouched step aims for once relabeled (see relabel)
export function wholeGoal(): Goal {
  return Object.fromEntries(Object.entries(PIECE_NAMES).map(([orbit, names]) => [orbit, Object.fromEntries(names.map((_, index) => [index, "solve" as Role]))]));
}

// True when every spot but the changed ones holds the same piece, turned the same way (where twists count), in both patterns
export function keptOthers(before: KPattern, after: KPattern, changed: Goal): boolean {
  return kpuzzle.definition.orbits.every(({ orbitName, numOrientations }) => {
    const [was, now] = [before.patternData[orbitName], after.patternData[orbitName]];
    const twists = countedTwists(orbitName, numOrientations);
    return was.pieces.every(
      (piece, spot) => changed[orbitName]?.[spot] !== undefined || (now.pieces[spot] === piece && now.orientation[spot] % twists === was.orientation[spot] % twists),
    );
  });
}
