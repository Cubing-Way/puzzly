// Targets: the patterns a step aims for (one per offset, and per placement of its relative groups), and which of them the allowed moves can reach

// Cube patterns
import { KPattern } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Piece names and grips
import { ALL_GRIPS } from "../core/cube";
// Loaded cube definition and held cubes
import { centerLayout, solvedAfter, kpuzzle } from "../core/puzzle";
// Engine data shapes
import type { Goal } from "../types";
// Roles, goal text and goal masks
import { maskPattern, relativeGroup } from "./goal";

// True when the allowed moves can bring the start's goal centers to where the target has them (few center layouts, so a quick breadth-first walk)
export function centersReachable(start: KPattern, target: KPattern, moves: string[]): boolean {
  const goalLayout = centerLayout(target);
  // Center layouts seen so far, and the patterns still to expand
  const seen = new Set([centerLayout(start)]);
  const queue = [start];
  for (const pattern of queue) {
    if (centerLayout(pattern) === goalLayout) return true;
    // Try every allowed move from here, keeping new layouts only
    for (const move of moves) {
      const next = pattern.applyMove(move);
      if (seen.has(centerLayout(next))) continue;
      seen.add(centerLayout(next));
      queue.push(next);
    }
  }
  return false;
}

// What a step aims for: the solved cube turned by an offset ("" = none), with the pieces the goal doesn't check hidden
export function maskedTarget(goal: Goal, offset = ""): KPattern {
  return maskPattern(solvedAfter(offset), goal);
}

// Most targets a goal's relative groups may give per offset (every mix of the groups' placements; the worker gets them all in one request)
const MAX_RELATIVE_TARGETS = 10_000;

// One relative group's pieces moved as a whole: each piece's type, number, and the spot and twist it lands on
type Placement = { orbit: string; piece: number; spot: number; twist: number }[];

// Every order of some items, where items of one class are interchangeable (each distinct order of classes once)
export function arrangements<T>(items: T[], classOf: (item: T) => string): T[][] {
  if (items.length <= 1) return [items];
  const orders: T[][] = [];
  const tried = new Set<string>();
  items.forEach((item, index) => {
    // Each class once in front, followed by every order of the rest
    if (tried.has(classOf(item))) return;
    tried.add(classOf(item));
    for (const rest of arrangements(items.filter((_, other) => other !== index), classOf)) orders.push([item, ...rest]);
  });
  return orders;
}

// The solved cube with some goal pieces moved (placement): the pieces they push off their spots (ignored ones, or :o / :s group pieces) fill the spots
// the moved pieces left, in every distinct way; none when they'd push off a piece that must stay home (solved or :p)
function placedPatterns(goal: Goal, placement: Placement): KPattern[] {
  // Each piece type's ways to fill the spots left free (null = a piece that must stay home is in the way)
  const fills = kpuzzle.definition.orbits.map(({ orbitName }) => {
    const moved = placement.filter((entry) => entry.orbit === orbitName);
    const roles = goal[orbitName] ?? {};
    const movedPieces = new Set(moved.map((entry) => entry.piece));
    const taken = new Set(moved.map((entry) => entry.spot));
    // Pieces pushed off their home spot (the solved cube holds piece n on spot n), and the spots the moved pieces left
    const pushed = moved.map((entry) => entry.spot).filter((spot) => !movedPieces.has(spot));
    const free = moved.map((entry) => entry.piece).filter((home) => !taken.has(home));
    if (pushed.some((piece) => roles[piece] === "solve" || roles[piece] === "place")) return null;
    return { orbitName, moved, free, orders: arrangements(pushed, (piece) => roles[piece] ?? "ignored") };
  });
  if (fills.includes(null)) return [];
  // Every mix of the piece types' orders
  let patterns = [structuredClone(kpuzzle.defaultPattern().patternData)];
  for (const fill of fills) {
    if (!fill?.moved.length) continue;
    patterns = patterns.flatMap((data) =>
      fill.orders.map((order) => {
        const copy = structuredClone(data);
        const { pieces, orientation } = copy[fill.orbitName];
        // Moved pieces on their new spots, pushed pieces on the free spots (twist 0: turned right there, which is what :o asks)
        for (const { piece, spot, twist } of fill.moved) [pieces[spot], orientation[spot]] = [piece, twist];
        order.forEach((piece, index) => ([pieces[fill.free[index]], orientation[fill.free[index]]] = [piece, 0]));
        return copy;
      }),
    );
  }
  return patterns.map((data) => new KPattern(kpuzzle, data));
}

// What a step aims for, turned by an offset: maskedTarget, or with relative groups (:r, :r2…) one target per way to place them: each group turned as a whole
// by any of the 24 grips, landing only on spots of pieces that may move (see placedPatterns), every mix of the groups' placements;
// all groups at home comes first, so it wins a tie. The offset turns the cube after the groups are placed (the goal met, then off by that move)
export function goalTargets(goal: Goal, offset = ""): KPattern[] {
  // Each relative group's pieces as [type, number]
  const groups = new Map<number, [string, number][]>();
  for (const [orbit, roles] of Object.entries(goal)) {
    for (const [piece, role] of Object.entries(roles)) {
      const group = relativeGroup(role);
      if (group) groups.set(group, [...(groups.get(group) ?? []), [orbit, Number(piece)]]);
    }
  }
  if (!groups.size) return [maskedTarget(goal, offset)];
  // Where each grip takes every piece ("as held" first)
  const turned = ALL_GRIPS.map((grip) => solvedAfter(grip).patternData);
  // Each group's placements: its pieces' spots and twists after each grip (each placement once)
  const placements = [...groups.values()].map((pieces) => {
    const seen = new Set<string>();
    return turned.flatMap((data) => {
      const placement = pieces.map(([orbit, piece]) => {
        const spot = data[orbit].pieces.indexOf(piece);
        return { orbit, piece, spot, twist: data[orbit].orientation[spot] };
      });
      const key = JSON.stringify(placement);
      if (seen.has(key)) return [];
      seen.add(key);
      return [placement];
    });
  });
  const targets: KPattern[] = [];
  const keys = new Set<string>();
  // Every mix of the groups' placements, skipping mixes where two groups want one spot
  const place = (group: number, chosen: Placement, taken: Set<string>): void => {
    if (group === placements.length) {
      for (const pattern of placedPatterns(goal, chosen)) {
        const target = maskPattern(pattern.applyAlg(offset), goal);
        const key = cellsKey(cellsOf(target));
        if (keys.has(key)) continue;
        keys.add(key);
        targets.push(target);
        if (targets.length > MAX_RELATIVE_TARGETS) {
          throw new Error(`Relative groups: more than ${MAX_RELATIVE_TARGETS.toLocaleString("en")} ways to place them; use fewer :r groups.`);
        }
      }
      return;
    }
    for (const placement of placements[group]) {
      const spots = placement.map(({ orbit, spot }) => `${orbit}/${spot}`);
      if (spots.some((spot) => taken.has(spot))) continue;
      place(group + 1, [...chosen, ...placement], new Set([...taken, ...spots]));
    }
  };
  place(0, [], new Set());
  return targets;
}

// The targets the allowed moves could reach, as the search worker judges it: same as the first target on every spot no allowed move changes, and in a
// piece type no allowed move twists (edges under U R L) the same twist per piece. The worker refuses target lists that differ there, so goalTargets'
// other placements (e.g. a relative pair in a slot R U never touch) are dropped
export function reachableTargets(targets: KPattern[], moves: string[]): KPattern[] {
  if (targets.length < 2) return targets;
  const turns = moves.map((move) => kpuzzle.moveToTransformation(move).transformationData);
  const first = targets[0].patternData;
  // Per piece type, from the first target: spots no move changes (with what's there), and each piece's twist when no move twists that type
  const checks = kpuzzle.definition.orbits.map(({ orbitName, numPieces, numOrientations }) => {
    const { pieces, orientation, orientationMod } = first[orbitName];
    // Twist values that count on a spot
    const factor = (spot: number) => orientationMod?.[spot] || numOrientations;
    const moving = Array.from({ length: numPieces }, (_, spot) =>
      turns.some((turn) => turn[orbitName].permutation[spot] !== spot || turn[orbitName].orientationDelta[spot] % factor(spot) !== 0),
    );
    const fixed = moving.flatMap((moves, spot) => (moves ? [] : [{ spot, piece: pieces[spot], factor: factor(spot), twist: orientation[spot] % factor(spot) }]));
    // Frozen twists: no allowed move twists a moving spot of this type, so each piece keeps its twist wherever it goes
    const frozen = new Map<number, number>();
    if (numOrientations > 1 && turns.every((turn) => moving.every((moves, spot) => !moves || turn[orbitName].orientationDelta[spot] % numOrientations === 0))) {
      moving.forEach((moves, spot) => {
        if (moves && factor(spot) > 1 && !frozen.has(pieces[spot])) frozen.set(pieces[spot], orientation[spot] % numOrientations);
      });
    }
    return { orbitName, numOrientations, moving, fixed, frozen };
  });
  return targets.filter((target) =>
    checks.every(({ orbitName, numOrientations, moving, fixed, frozen }) => {
      const { pieces, orientation, orientationMod } = target.patternData[orbitName];
      // Untouched spots hold the same piece, turned the same way
      if (fixed.some(({ spot, piece, factor, twist }) => pieces[spot] !== piece || orientation[spot] % factor !== twist)) return false;
      // Pieces whose twist no move changes keep the first target's twist
      return moving.every((moves, spot) => {
        const twisted = (orientationMod?.[spot] || numOrientations) > 1;
        return !moves || !twisted || !frozen.has(pieces[spot]) || orientation[spot] % numOrientations === frozen.get(pieces[spot]);
      });
    }),
  );
}
