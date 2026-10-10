// A step's combos: every alternative × grip worth searching, with its targets, measured by the worker and sorted closest first

// Cube patterns
import type { KPattern } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Move text helpers
import { FACE_MOVES, joinMoves, countMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Moves as other grips see them
import { movesKey } from "../core/turns";
// BLD buffers and parity
import { bufferFromText, parityFromText, traceWanted, withParity } from "../goal/bld";
// Roles, goal text and goal masks
import { maskPattern, parseGoalText, readAlternatives, goalFromText, goalToText } from "../goal/goal";
// Goals named for another grip
import { goalOnCube } from "../goal/grips";
// Offsets a goal counts up to
import { offsetGroups } from "../goal/offsets";
// A goal's targets
import { reachableTargets, goalTargets, centersReachable, maskedTarget } from "../goal/targets";
// Goals that keep every other piece untouched
import { reachableChanges, wholeGoal, untouchedWanted, completions, untouchedPieces, relabel } from "../goal/untouched";
// Error messages
import { NOTHING_NEW, CENTERS_OUT, UNTOUCHED_MIX, PARITY_NEEDED, UNTOUCHED_OUT } from "../messages";
// Engine data shapes
import type { StepOptions } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// One alternative × grip of a step
import { type Combo, knownAnswer, orbitTables } from "./combo";
// How far each piece is on its own
import { pieceMoves, estimate } from "./estimate";
// A step's goal in each grip
import { gripGoals } from "./grip-goals";

// Every alternative × grip combo of a step worth searching (each with all its offsets at once), measured by the worker and sorted closest first,
// plus the error to throw if none of them finds anything
export async function stepCombos(scramble: string, pieces: string, options: StepOptions): Promise<{ queue: Combo[]; lastError: unknown }> {
  // Steps that keep every other piece untouched (BLD steps) have their own goals
  if (options.untouched || options.buffer) return untouchedCombos(scramble, pieces, options);
  const keep = options.keep;
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  // Moves that may finish the goal later ([] = none)
  const solvableWith = options.solvableWith ?? [];
  // Offsets the goal may be reached up to (an empty list means no offset), in groups that share one table
  const groups = offsetGroups(options.offsets?.length ? options.offsets : [""], generatorMoves);
  // Last error seen (shown if no combo finds anything)
  let lastError: unknown = null;
  // What each combo asks for: two combos asking for the same thing give the same answers
  const asked = new Set<string>();
  // How each piece moves under the allowed moves, for the easy-looking scores
  const tables = pieceMoves(generatorMoves);
  // Each alternative's goal in the grips worth trying (where earlier steps cover the fewest of its pieces), each grip with every offset group
  const combos = gripGoals(pieces, options.rotations ?? [""], keep, options.earlier).flatMap(({ alternative, rotation, goal, gripMatters, fresh }) => {
    // Earlier steps then the grip's rotation, and the cube held that way
    const done = joinMoves(options.done ?? "", rotation);
    const held = heldPattern(scramble, done);
    // Start = cube held in this grip, with the goal's hidden pieces masked
    const start = maskPattern(held, goal);
    // Targets already used in this grip (an offset the goal can't see repeats one, so it's dropped)
    const seen = new Set<string>();
    return groups.flatMap((group) => {
      // Each offset's targets = solved cube turned by the offset, with the same pieces hidden (offsets are named in the grip, like the goal's spots);
      // with relative groups, one per placement the allowed moves could reach
      const offsets: string[] = [];
      const targets: KPattern[] = [];
      for (const offset of group) {
        for (const target of reachableTargets(goalTargets(goal, offset), generatorMoves)) {
          const key = cellsKey(cellsOf(target));
          if (seen.has(key)) continue;
          seen.add(key);
          offsets.push(offset);
          targets.push(target);
        }
      }
      if (!targets.length) return [];
      // The easiest-looking offset's scores: its hardest piece alone is a sure lower bound (bound), the sum ranks how far off the goal looks (total);
      // with solvable-with moves a piece may end on other spots too, so no score (the worker's measure ranks the combos)
      const scores = solvableWith.length
        ? [{ bound: 0, total: 0 }]
        : [...new Set(offsets)].map((offset) => estimate(held, start, targets.filter((_, index) => offsets[index] === offset), goal, tables));
      const bound = Math.min(...scores.map((score) => score.bound));
      const total = Math.min(...scores.map((score) => score.total));
      return [{ alternative, rotation, done, goal, gripMatters, fresh, held, start, offsets, targets, bound, total }];
    });
  });
  if (!combos.length) throw new Error(NOTHING_NEW);
  // Easiest-looking first (ties keep alternative and grip order), keeping only combos worth measuring
  const candidates: typeof combos = [];
  for (const combo of combos.sort((a, b) => a.total - b.total || a.bound - b.bound)) {
    const { rotation, done, goal, gripMatters, start } = combo;
    // Same grip and same hidden targets (offsets the goal can't see), or the same pieces, turns and offsets as the cube itself turns them
    const keys = [
      `target/${rotation}/${combo.targets.map((target) => JSON.stringify(target.patternData)).join("|")}`,
      [
        "cube",
        JSON.stringify(goalOnCube(goal, scramble, done)),
        movesKey(rotation, generatorMoves),
        gripMatters ? rotation : "",
        [...new Set(combo.offsets)].map((offset) => movesKey(rotation, [offset])).join("&"),
        solvableWith.length ? movesKey(rotation, solvableWith) : "",
      ].join("/"),
    ];
    // Skip a combo that asks for the same thing as an earlier one (still noting its keys, so later repeats are caught too)
    const repeat = keys.some((key) => asked.has(key));
    for (const key of keys) asked.add(key);
    if (repeat) continue;
    // Skip a combo whose hardest piece alone needs more moves than the user's limit
    if (combo.bound > (options.maxDepth ?? Infinity)) continue;
    // Keep only the targets whose centers the allowed moves can bring home (a search for the others would never end)
    const reachable = combo.targets.map((target) => centersReachable(start, target, generatorMoves));
    if (!reachable.includes(true)) {
      lastError ??= new Error(CENTERS_OUT);
      continue;
    }
    candidates.push({ ...combo, offsets: combo.offsets.filter((_, index) => reachable[index]), targets: combo.targets.filter((_, index) => reachable[index]) });
  }
  return measureCombos(candidates, options, lastError);
}

// Ask the worker how far each combo is (it builds or loads the tables first): exact from one table, a lower bound from split tables,
// unknown with twips (then the hardest piece's moves stand in); then sort them closest first, leaving out the ones no allowed moves can solve
async function measureCombos(candidates: Combo[], options: StepOptions, lastError: unknown): Promise<{ queue: Combo[]; lastError: unknown }> {
  const measured = await Promise.all(
    candidates.map(async (combo) => {
      // An untouched combo at its goal already, or answered before, needs no tables: its distance is known
      const known = knownAnswer(combo, options.generatorMoves ?? FACE_MOVES);
      if (known !== undefined) return { ...combo, bound: countMoves(known) };
      try {
        const { bound, exact } = await askWorker(
          { kind: "measure", start: combo.start, targets: combo.targets, moves: options.generatorMoves ?? FACE_MOVES, solvableWith: options.solvableWith, orbitTables: orbitTables(combo) },
          options.onProgress,
        );
        return { ...combo, bound: exact ? (bound ?? Infinity) : Math.max(bound ?? 0, combo.bound), twips: bound === null };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        return { ...combo, bound: Infinity };
      }
    }),
  );
  // Combos no allowed moves can solve are left out
  if (measured.some((combo) => combo.bound === Infinity)) lastError ??= new Error("No solution found!");
  // Closest first; on a tie the one adding more new pieces, then the easiest-looking (the sort keeps the order above)
  const queue = measured.filter((combo) => combo.bound !== Infinity).sort((a, b) => a.bound - b.bound || b.fresh - a.fresh);
  return { queue, lastError };
}

// Every combo of a step that keeps every other piece untouched (with a buffer, a BLD step): per grip and alternative, each end state the goal allows
// (every cycle-break choice and free twist, the parity pieces too when the goal can't be reached without them), relabeled so it's the solved cube.
// So every such step searches "solve the whole cube" from a cube solved but for a few pieces, with one shared set of tables; measured and sorted closest first
async function untouchedCombos(scramble: string, pieces: string, options: StepOptions): Promise<{ queue: Combo[]; lastError: unknown }> {
  if ((options.offsets ?? []).some(Boolean) || options.solvableWith?.length) throw new Error(UNTOUCHED_MIX);
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  // Changes the allowed moves can make, the whole-cube goal and its target, and how each piece moves (for the easy-looking scores)
  const reachable = reachableChanges(generatorMoves);
  const whole = wholeGoal();
  const target = maskedTarget(whole);
  const tables = pieceMoves(generatorMoves);
  // Buffer and parity pieces (BLD), each as a piece
  const buffer = options.buffer ? parseGoalText(bufferFromText(options.buffer))[0] : null;
  const parity = parseGoalText(parityFromText(options.parity ?? ""));
  // A buffer step traces its own goal, so it has one alternative
  const alternatives = buffer ? [""] : readAlternatives(pieces);
  // Combos with their easy-looking total (for the order before measuring)
  const combos: (Combo & { total: number })[] = [];
  // Relabeled starts already queued (two end states giving the same one ask for the same thing)
  const asked = new Set<string>();
  let lastError: unknown = null;
  for (const rotation of options.rotations ?? [""]) {
    // The cube held in this grip, as it really is
    const cube = heldPattern(scramble, joinMoves(options.done ?? "", rotation));
    alternatives.forEach((text, alternative) => {
      // What the step asks for: the buffer's next targets (one goal per cycle-break choice), or the alternative's pieces
      const goals = buffer ? traceWanted(cube, buffer, Math.max(1, options.targetsPerStep ?? 2)) : [untouchedWanted(cube, goalFromText(text))];
      for (const goal of goals) {
        // End states the moves can reach; with none (an odd trace), let the parity pieces swap too (keeping their twists, else any way)
        let wanted = goal;
        let wants = completions(cube, wanted, reachable);
        for (const anyTwist of [false, true]) {
          if (wants.length || !buffer || !parity.length) break;
          wanted = withParity(goal, parity, anyTwist);
          wants = completions(cube, wanted, reachable);
        }
        if (!wants.length) {
          lastError ??= new Error(buffer && !parity.length ? PARITY_NEEDED : UNTOUCHED_OUT);
          continue;
        }
        const { solved, changed } = untouchedPieces(wanted);
        for (const want of wants) {
          // The cube renamed so this end state is the solved cube, with nothing hidden
          const held = relabel(cube, want);
          const start = maskPattern(held, whole);
          const key = `${rotation}/${cellsKey(cellsOf(start))}`;
          if (asked.has(key)) continue;
          asked.add(key);
          const { bound, total } = estimate(held, start, [target], whole, tables);
          const fresh = Object.values(solved).reduce((count, roles) => count + Object.keys(roles).length, 0);
          combos.push({
            alternative,
            rotation,
            goal: whole,
            fresh,
            held,
            start,
            offsets: [""],
            targets: [target],
            bound,
            total,
            cube,
            untouched: { pieces: goalToText(solved), changed: goalToText(changed) },
          });
        }
      }
    });
  }
  if (!combos.length) throw lastError ?? new Error(UNTOUCHED_OUT);
  // Easiest-looking first (ties keep grip and alternative order), skipping the ones whose hardest piece alone needs more than the user's limit
  const candidates = combos.sort((a, b) => a.total - b.total || a.bound - b.bound).filter((combo) => combo.bound <= (options.maxDepth ?? Infinity));
  return measureCombos(candidates, options, lastError);
}
