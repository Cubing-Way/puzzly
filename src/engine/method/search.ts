// Method search: the run of a whole method with the fewest moves in total, by branch and bound over its steps' answers

// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Move text helpers
import { FACE_MOVES, countMoves, joinMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern, noteHeld } from "../core/puzzle";
// Roles, goal text and goal masks
import { goalToText } from "../goal/goal";
// Error messages
import { NOTHING_NEW } from "../messages";
// One alternative × grip of a step
import { type Combo, type Answer, orbitTables } from "../step/combo";
// Step solvers
import { stepResult, searchCombos } from "../step/step";
// Builds and measures a step's combos
import { stepCombos } from "../step/step-combos";
// Engine data shapes
import type { MethodResult, TableProgress, StepOptions, Goal, Method } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// Lower bounds from later steps' goals
import { type LaterGoal, laterGoals, laterBound } from "./later-goals";
// Runs a method
import { runMethod, methodStepOptions, methodRow, methodTotals, piecesAfter, MAX_REPEATS } from "./run";

// Default time budget of a method search: it stops then with the best run found so far
export const METHOD_SEARCH_MS = 30_000;
// Answers per list page in a method search (each page's next steps are measured in one batch, which the worker answers back to back)
const SEARCH_PAGE = 100;
// Longest step answer a method search lists (the Rust search's own limit)
const MAX_SEARCH_LENGTH = 40;
// Most step starts a method search remembers (with the fewest moves that reached each), so one reached again with no fewer moves is skipped
const MAX_VISITED = 1_000_000;

// Options for a method search: where it starts, how long it may take, a way to stop it early, and who hears about its progress
export interface MethodSearchOptions {
  done?: string; // moves already done after the scramble, before the first step
  budgetMs?: number; // stop after this long with the best run found so far (default METHOD_SEARCH_MS)
  stop?: () => boolean; // asked between worker requests: true stops the search (e.g. a Stop button)
  onBetter?: (result: MethodResult) => void; // hears each run with fewer moves than every one before it (the plain run first; a found run's ms = time since the search started, its steps' ms 0)
  onBound?: (moves: number) => void; // hears the fewest moves any run can have (see MethodSearchResult.bound) once it's known, right after the plain run
  onProgress?: (progress: TableProgress) => void; // hears when the search worker builds or loads a table
}

// What a method search found
export interface MethodSearchResult {
  best: MethodResult | null; // the run with the fewest moves (null = no run of the method gets through every step)
  seed: number | null; // moves of the plain run the search started from (each step with its own lookahead; null when that run failed)
  optimal: boolean; // no run of the method is shorter (by its rules): the search finished, or the best run has as few moves as the bound
  bound: number | null; // fewest moves any run needs (a lower bound: the first step's closest combo, or a later step's closest goal; null = no run can start)
  states: number; // step starts the search measured (each answer it took up leads to one, unless that start was reached before with no more moves)
  ms: number; // whole search time, the plain run included
}

// One step's place in a method search: which step and round, and its combos at that start, measured and closest first (end = past the last step)
interface SearchLevel {
  index: number;
  round: number;
  end: boolean;
  queue: Combo[];
  lastError: unknown;
  options: StepOptions;
}

// One step taken on the way to a step start: which step and round, the moves before it, and its answer (made into a step result only for a run worth keeping)
interface SearchRow {
  index: number;
  round: number;
  done: string;
  answer: Answer;
  searches: number;
  solvableWith?: string[];
}

// One step start in a method search: its step's combos, the moves so far (after the scramble), the earlier pieces (and their id), the moves used, the steps that led here,
// and the fewest moves the rest needs (its step's closest combo, or a later step's closest goal)
interface SearchNode {
  level: SearchLevel;
  done: string;
  earlier: Goal;
  earlierId: number;
  used: number;
  rows: SearchRow[];
  bound: number;
}

// Search a method's runs for the fewest moves in total: a depth-first branch and bound over its steps, starting from the plain run (each step with its own lookahead)
// and looking only for runs with fewer moves. Each step lists its answers shortest first, a page at a time, and every answer's next step is measured before going on,
// so a start whose rest can't get under the best total is skipped, and so is a start reached before with no more moves. The rest's bound is the next step's closest
// combo, or, when larger, a later step's closest goal (laterGoals: e.g. after a CFOP cross, F2L from there). The last step takes its shortest answer within the moves left.
// Stops at the time budget (or when asked) with the best run so far; optimal = it looked at everything, or the best run is as short as the start's bound.
// Method rules: a step's answers never pass through its goal on the way (as with lookahead), a step's maxDepth still limits it, firstFound is ignored,
// a repeated step is searched round by round, and the offset the last step leaves isn't counted (a fix step, like ADF, is a step)
export async function searchMethod(scramble: string, method: Method, options: MethodSearchOptions = {}): Promise<MethodSearchResult> {
  const started = performance.now();
  const deadline = started + (options.budgetMs ?? METHOD_SEARCH_MS);
  const steps = method.steps;
  // Best run so far and its moves; whether the search stopped early, and whether some step's answers couldn't all be listed (either way it proves nothing)
  let best: MethodResult | null = null;
  let bestMoves = Infinity;
  let halted = false;
  let complete = true;
  let states = 0;
  // Fewest moves any run needs (the first step start's bound), and whether the best run has that few (then nothing shorter exists)
  let rootBound: number | null = null;
  let proven = false;
  // Seed: the plain run (if it fails, any run the search finds is the best)
  let seed: number | null = null;
  try {
    best = await runMethod(scramble, method, { done: options.done, onProgress: options.onProgress });
    seed = bestMoves = best.moves;
    options.onBetter?.(best);
  } catch {
    // No plain run: the search looks for any run
  }
  // True once the search must stop: the best run is as short as any can be, out of time, or asked to (only the last two leave it unfinished)
  const stopped = (): boolean => proven || (halted ||= performance.now() > deadline || Boolean(options.stop?.()));

  // Step starts seen so far with the fewest moves that reached them, and an id for each earlier-pieces text (keeps the keys short)
  const visited = new Map<string, number>();
  const pieceSets = new Map<string, number>();
  // Id of some earlier pieces (equal pieces, equal id)
  const piecesId = (earlier: Goal): number => {
    const text = goalToText(earlier);
    let id = pieceSets.get(text);
    if (id === undefined) pieceSets.set(text, (id = pieceSets.size));
    return id;
  };
  // Key of a step start: step, round, earlier pieces' id, cube held in its grip
  const startKey = (index: number, round: number, earlierId: number, done: string): string => `${index}/${round}/${earlierId}/${cellsKey(cellsOf(heldPattern(scramble, done)))}`;
  // True when this start was reached before with no more moves; otherwise it's noted with these moves
  const seenBefore = (key: string, used: number): boolean => {
    const before = visited.get(key);
    if (before !== undefined && before <= used) return true;
    if (before !== undefined || visited.size < MAX_VISITED) visited.set(key, used);
    return false;
  };

  // Later steps' goals by step and earlier pieces' id (the walk needs no cube, so it's done once for each), and each start's later bound by its key
  const laterFound = new Map<string, LaterGoal[][]>();
  const laterBounds = new Map<string, number>();
  // Fewest moves the rest needs from a start, from the later steps' goals (0 when there are none)
  const restBound = async (node: SearchNode, key: string): Promise<number> => {
    if (node.level.end) return 0;
    const walk = `${node.level.index}/${node.earlierId}`;
    let goals = laterFound.get(walk);
    if (!goals) laterFound.set(walk, (goals = laterGoals(steps, node.level.index, node.earlier)));
    if (!goals.length) return 0;
    let bound = laterBounds.get(key);
    if (bound === undefined) {
      bound = await laterBound(scramble, node.done, goals, options.onProgress);
      if (laterBounds.size < MAX_VISITED) laterBounds.set(key, bound);
    }
    return bound;
  };

  // A step's combos at a start, moving on past a repeated step whose round has nothing new left; null when the step can't go on from there
  const levelAt = async (index: number, round: number, done: string, earlier: Goal): Promise<SearchLevel | null> => {
    for (;;) {
      if (index >= steps.length) return { index, round, end: true, queue: [], lastError: null, options: {} };
      const stepOptions = { ...methodStepOptions(steps[index], done, earlier, options.onProgress), firstFound: false };
      try {
        const { queue, lastError } = await stepCombos(scramble, steps[index].pieces, stepOptions);
        return queue.length ? { index, round, end: false, queue, lastError, options: stepOptions } : null;
      } catch (error) {
        // A repeated step with nothing new left is finished: the next step starts here
        if (round > 1 && (error as Error).message === NOTHING_NEW) {
          [index, round] = [index + 1, 1];
          continue;
        }
        return null;
      }
    }
  };
  // Fewest moves a step start still needs: its closest combo's distance (0 past the last step)
  const needs = (level: SearchLevel): number => (level.end ? 0 : level.queue[0].bound);

  // A whole run with fewer moves than the best: keep it (each step checked on its goal) and tell the listener
  const record = (rows: SearchRow[], used: number, earlier: Goal): void => {
    if (used >= bestMoves) return;
    const found = rows.map(({ index, round, done, answer, searches, solvableWith }) => methodRow(scramble, method, index, round, done, stepResult(answer, searches, solvableWith), 0, null));
    best = { ...methodTotals(found, earlier), ms: performance.now() - started };
    bestMoves = used;
    // As few moves as the start's bound: no run is shorter, so the search can stop
    proven = rootBound !== null && bestMoves <= rootBound;
    options.onBetter?.(best);
  };

  // One page of a combo's answers of exactly `length` moves, coming after the answer `after` (none = the first page; [] when there are none);
  // twips gives only its one shortest answer
  const listPage = async (combo: Combo, level: SearchLevel, length: number, after?: string): Promise<string[]> => {
    try {
      const reply = await askWorker(
        {
          kind: "list",
          start: combo.start,
          targets: combo.targets,
          moves: level.options.generatorMoves ?? FACE_MOVES,
          solvableWith: level.options.solvableWith,
          orbitTables: orbitTables(combo),
          maxDepth: length + 1,
          minDepth: length,
          maxAnswers: SEARCH_PAGE,
          after,
        },
        options.onProgress,
      );
      // Worker answers are plain moves one space apart, so counting words counts moves
      return (reply.answers ?? []).filter((moves) => (moves ? moves.split(" ").length : 0) === length);
    } catch {
      // No answer of that length
      return [];
    }
  };

  // Search below one step start for runs with fewer moves than the best
  const visit = async (node: SearchNode): Promise<void> => {
    const { level, done, earlier, used, rows } = node;
    if (stopped() || used + node.bound >= bestMoves) return;
    // Past the last step: a whole run
    if (level.end) return record(rows, used, earlier);
    const step = steps[level.index];
    // The last step takes its shortest answer within the moves left (no list needed)
    if (level.index === steps.length - 1 && !step.repeat) {
      try {
        const limit = Math.min(step.maxDepth ?? Infinity, bestMoves - used - 1);
        const { answer, searches } = await searchCombos(level.queue, { ...level.options, maxDepth: limit }, level.lastError);
        const { solvableWith } = level.options;
        const after = piecesAfter(earlier, stepResult(answer, searches, solvableWith));
        record([...rows, { index: level.index, round: level.round, done, answer, searches, solvableWith }], used + countMoves(answer.moves), after);
      } catch {
        // Nothing within the moves left
      }
      return;
    }
    // Other steps: every answer, shortest first, each followed by the steps after it (a step already at its goal only takes its 0-move answer)
    const longest = Math.min(step.maxDepth ?? Infinity, MAX_SEARCH_LENGTH);
    let length = needs(level);
    for (; length <= longest && used + length < bestMoves; length++) {
      let atGoal = false;
      // Combos close enough for this length (the queue is closest first), each page by page
      for (const combo of level.queue) {
        if (combo.bound > length) break;
        for (let after: string | undefined; ; ) {
          if (stopped() || used + length >= bestMoves) return;
          const page = await listPage(combo, level, length, after);
          // Twips can't list every answer, so the search can't prove anything past it
          if (combo.twips) complete = false;
          atGoal ||= length === 0 && page.length > 0;
          await branch(node, combo, page, length);
          if (halted || proven || combo.twips || page.length < SEARCH_PAGE) break;
          after = page.at(-1);
        }
      }
      if (atGoal) break;
    }
    // Answers longer than the search's own limit were never listed
    if (length > MAX_SEARCH_LENGTH && longest === MAX_SEARCH_LENGTH && used + length < bestMoves) complete = false;
  };

  // The step starts a page of answers leads to: each answer's next step (or round) measured, all at once, then searched closest first
  const branch = async (node: SearchNode, combo: Combo, page: string[], length: number): Promise<void> => {
    const { level, done, earlier, used, rows } = node;
    const step = steps[level.index];
    const { solvableWith } = level.options;
    // Next: the step's next round while a repeated step finds something to do, else the next step (a later round with nothing to do adds no row)
    const again = Boolean(step.repeat) && length > 0;
    if ((again && level.round >= MAX_REPEATS) || !page.length) return;
    const row = length > 0 || level.round === 1;
    const [index, round] = again ? [level.index, level.round + 1] : [level.index + 1, 1];
    // Every answer of one combo leaves the same pieces solved, in the same grip, so the earlier pieces after it are worked out once
    const nextEarlier = row ? piecesAfter(earlier, stepResult({ combo, moves: page[0] }, 0, solvableWith)) : earlier;
    const earlierId = piecesId(nextEarlier);
    const children = await Promise.all(
      page.map(async (moves): Promise<SearchNode | null> => {
        const nextDone = row ? joinMoves(done, combo.rotation, moves) : done;
        // The cube there is the combo's held cube (as it really is) plus the answer, which spares replaying every move so far
        if (row) noteHeld(scramble, nextDone, (combo.cube ?? combo.held).applyAlg(moves));
        // Skip a start reached before with no more moves, else measure its step
        const key = startKey(index, round, earlierId, nextDone);
        if (seenBefore(key, used + length)) return null;
        states++;
        const next = await levelAt(index, round, nextDone, nextEarlier);
        if (!next) return null;
        const taken = row ? [...rows, { index: level.index, round: level.round, done, answer: { combo, moves }, searches: 0, solvableWith }] : rows;
        const child: SearchNode = { level: next, done: nextDone, earlier: nextEarlier, earlierId, used: used + length, rows: taken, bound: needs(next) };
        // Later steps' goals bound the rest too: measured only when the next step's own bound doesn't rule the start out already
        if (child.used + child.bound < bestMoves) child.bound = Math.max(child.bound, await restBound(child, key));
        return child;
      }),
    );
    // Closest next steps first, then the closest rests (the sort keeps the list's order on ties: ordering by the rest's bound alone found worse runs in time);
    // a start whose rest can't beat the best is skipped
    const alive = children.filter((child): child is SearchNode => child !== null).sort((a, b) => needs(a.level) - needs(b.level) || a.bound - b.bound);
    for (const child of alive) {
      if (child.used + child.bound >= bestMoves) continue;
      await visit(child);
      if (halted || proven) return;
    }
  };

  // Start at the first step, from the scramble and the moves already done: its bound is the fewest moves any run needs (reported, and a run that short is the fewest)
  const done = options.done ?? "";
  const root = await levelAt(0, 1, done, {});
  states++;
  const rootKey = startKey(0, 1, piecesId({}), done);
  if (root && !seenBefore(rootKey, 0)) {
    const node: SearchNode = { level: root, done, earlier: {}, earlierId: piecesId({}), used: 0, rows: [], bound: needs(root) };
    node.bound = Math.max(node.bound, await restBound(node, rootKey));
    if (Number.isFinite(node.bound)) {
      rootBound = node.bound;
      proven = bestMoves <= rootBound;
      options.onBound?.(rootBound);
    }
    await visit(node);
  }
  return { best, seed, optimal: proven || (!halted && complete), bound: rootBound, states, ms: performance.now() - started };
}
