// Alg-set steps: a step answered by recognising its case and making that case's alg (the last layer, as solvers do it), with no search at all

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// The sets of cases a step can name
import { algSet, type AlgSet } from "../algs/sets";
// Algs as plain face turns
import { toFaces } from "../core/faces";
// Move text helpers
import { countMoves, joinMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Roles, goal text and goal masks
import { maskPattern, goalToText } from "../goal/goal";
// A goal's targets
import { goalTargets } from "../goal/targets";
// Speed cost of a move sequence after the moves before it
import { speedCostAfter } from "../speed/fingering";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// A step's goal in each grip
import { gripGoals } from "./grip-goals";

// One alg of a set, ready to try: its case, its place among the case's algs (0 = the default), as the hands make it (wide turns written Rw) and as
// the face turns it makes on the cube
interface ReadyAlg {
  name: string;
  place: number;
  hands: string;
  faces: string;
  turns: Alg;
}

// Sets made ready so far
const readied = new WeakMap<AlgSet, ReadyAlg[]>();

// An alg as the engine writes it: a wide turn as Rw where solvers write r
function engineText(alg: string): string {
  return alg.replace(/\b([rludfb])(?=[2']?(\s|$))/g, (letter) => `${letter.toUpperCase()}w`);
}

// A set's algs ready to try, in the set's order (an alg that leaves the cube held another way can't be a step's answer, so it's left out)
function readyAlgs(set: AlgSet): ReadyAlg[] {
  let ready = readied.get(set);
  if (!ready) {
    ready = set.cases.flatMap((item) =>
      item.algs.flatMap((alg, place): ReadyAlg[] => {
        const { faces, home } = toFaces(engineText(alg));
        return home ? [{ name: item.name, place, hands: engineText(alg), faces, turns: new Alg(faces) }] : [];
      }),
    );
    readied.set(set, ready);
  }
  return ready;
}

// The answers a step with an alg set (options.algs) has for the cube as it is: every alg of the set that reaches the step's goal after one of the set's
// lining-up turns (and one more after it when the goal needs it: U2 x R2 D2 R U R' D2 R U' R x' U'), best first: by speed the fastest to turn, by
// moves the shortest, the case's default alg before its others on a tie. Each has two writings, like an answer with wide turns: `wide` as the hands
// make it, `solution` as the face turns it makes on the cube (the one to check and go on from), and `alg` names its case.
// A cube that only needs a lining-up turn gets that turn as its answer (no `alg`).
// Empty when no alg fits (a case the set doesn't hold, a step already done, or options an alg set can't serve): the step is searched then
export function algCandidates(scramble: string, pieces: string, options: StepOptions & { maxCandidates?: number } = {}): StepResult[] {
  const set = options.algs ? algSet(options.algs) : undefined;
  // Steps that keep every other piece untouched, or that may be finished later, have goals of their own
  if (!set || options.untouched || options.buffer || options.solvableWith?.length) return [];
  const held = heldPattern(scramble, options.done ?? "");
  const offsets = options.offsets?.length ? options.offsets : [""];
  const bySpeed = options.rank === "speed";
  // Nothing was turned before the step: a regrip before its first turn costs less
  const fresh = !options.done?.trim();
  // The moves before the step as the hands make them: an alg whose lining-up turn cancels into them is scored by what's left of it
  const previous = options.previous ?? "";
  // Where each of their steps starts
  const previousStarts = options.previousStarts ?? [];
  // Goals in the grip the cube is held in (an alg set never turns the cube first); a step with nothing new to do has none
  let goals: ReturnType<typeof gripGoals>;
  try {
    goals = gripGoals(pieces, [""], options.keep, options.earlier);
  } catch {
    return [];
  }
  // The cube after each lining-up turn before the alg ("" = none)
  const starts = ["", ...set.adjust].map((before) => ({ before, cube: before ? held.applyAlg(before) : held }));
  const found: { result: StepResult; cost: number; place: number; adjusts: number }[] = [];
  for (const { alternative, goal } of goals) {
    // The goal's targets, one per offset, and the offset the cube has reached (undefined = none of them)
    const targets = offsets.flatMap((offset) => goalTargets(goal, offset).map((target) => ({ offset, target })));
    const reached = (cube: KPattern): string | undefined => {
      const masked = maskPattern(cube, goal);
      return targets.find(({ target }) => masked.isIdentical(target))?.offset;
    };
    // Already there: nothing to recognise
    if (reached(held) !== undefined) return [];
    const text = goalToText(goal);
    for (const { before, cube } of starts) {
      // Only a lining-up turn away: that turn is the answer, and no alg is tried after it
      const turned = before ? reached(cube) : undefined;
      if (turned !== undefined) {
        found.push({ result: { solution: new Alg(before), rotation: "", offset: turned, pieces: text, settled: text, alternative, searches: 0 }, cost: bySpeed ? speedCostAfter(before, previous, undefined, fresh, previousStarts) : 1, place: 0, adjusts: 1 });
        continue;
      }
      for (const alg of readyAlgs(set)) {
        const after = cube.applyAlg(alg.turns);
        // The goal as it is after the alg, or after one more lining-up turn
        for (const last of ["", ...set.adjust]) {
          const offset = reached(last ? after.applyAlg(last) : after);
          if (offset === undefined) continue;
          const [hands, solution] = [joinMoves(before, alg.hands, last), joinMoves(before, alg.faces, last)];
          found.push({
            result: { solution: new Alg(solution), ...(hands === solution ? {} : { wide: hands }), rotation: "", offset, pieces: text, settled: text, alternative, searches: 0, alg: alg.name },
            cost: bySpeed ? speedCostAfter(hands, previous, undefined, fresh, previousStarts) : countMoves(solution),
            place: alg.place,
            adjusts: (before ? 1 : 0) + (last ? 1 : 0),
          });
          break;
        }
      }
    }
  }
  // Best first; on a tie the case's default alg, then the one that needs fewer lining-up turns
  found.sort((a, b) => a.cost - b.cost || a.place - b.place || a.adjusts - b.adjusts);
  return found.slice(0, Math.max(1, options.maxCandidates ?? found.length)).map((entry) => entry.result);
}
