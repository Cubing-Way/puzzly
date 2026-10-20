// Step solvers: the shortest answer over a step's combos, every answer up to some extra moves (for lookahead), and the full-cube solver

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Full 3x3x3 solver
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
// Move text helpers
import { FACE_MOVES, countMoves, joinMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Goal text
import { goalToText } from "../goal/goal";
// Solvable-with moves
import { settledGoal } from "../goal/solvable";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// What a list that used up its node budget fails with
import { NODE_LIMIT } from "../worker/protocol";
// A step's scoring by speed: in the scoring worker, or on the page
import { scoringSession } from "../worker/scoring-client";
// Steps answered from an alg set
import { algCandidates } from "./alg-step";
// One alternative × grip of a step
import { type Combo, type Answer, knownAnswer, searchCombo, orbitTables } from "./combo";
// Scoring answers by speed, and what ranking by moves shares with it (order, tiers, offsets reached)
import { type Listed, byMoves, byTier, leaves, reachedOffset, scoringOptions, setTiers, undoing } from "./scoring";
// Builds and measures a step's combos
import { stepCombos } from "./step-combos";

// Search the measured combos in turn for the shortest answer (on a tie, the alternative adding more new pieces), skipping combos that can't beat the best so far
export async function searchCombos(queue: Combo[], options: StepOptions, lastError: unknown): Promise<{ answer: Answer; searches: number }> {
  // Best answer so far, its length and how many new pieces it adds
  let best: Answer | null = null;
  let bestLength = Infinity;
  let bestFresh = -1;
  let searches = 0;
  // Untouched combos whose answer is known already go first: they cost nothing and bound the searches after them (other steps keep their order)
  const known = queue.filter((combo) => knownAnswer(combo, options.generatorMoves ?? FACE_MOVES) !== undefined);
  for (const combo of [...known, ...queue.filter((combo) => !known.includes(combo))]) {
    const { fresh, bound } = combo;
    // Only look for answers shorter than the best so far, or as short when this alternative adds more new pieces (and within the user's limit)
    const maxDepth = Math.min(options.maxDepth ?? Infinity, fresh > bestFresh ? bestLength : bestLength - 1);
    // Skip a combo whose distance (or lower bound) is already too long: no search there can beat the best so far
    if (bound > maxDepth) continue;
    searches++;
    try {
      const moves = await searchCombo(combo, options, maxDepth);
      // Keep it if it's shorter than the best so far, or as short with more new pieces
      const length = countMoves(moves);
      if (length < bestLength || (length === bestLength && fresh > bestFresh)) {
        bestLength = length;
        bestFresh = fresh;
        best = { combo, moves };
      }
      // First-answer mode: any answer within the limit will do, so skip the remaining combos
      if (options.firstFound) break;
    } catch (error) {
      // No answer within the limit for this combo: remember why (twips throws a plain string) and try the next one
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  // No combo found an answer
  if (!best) throw lastError ?? new Error("No solution found.");
  return { answer: best, searches };
}

// A step's result for one answer: the grip rotation and moves, the offset it reached, and the pieces it left for good;
// with `undo` the moves go on to undo that offset, so none is left
export function stepResult(answer: Answer, searches: number, solvableWith: string[] = [], undo = false): StepResult {
  const { combo, moves } = answer;
  const reached = reachedOffset(answer, solvableWith);
  const offset = undo ? "" : reached;
  // Pieces it solved (an untouched step: the ones it sent home, not the whole cube it was relabeled to), and the ones later steps may keep (the solvable-with moves may still move the others)
  const pieces = combo.untouched?.pieces ?? goalToText(combo.goal);
  const settled = solvableWith.length ? goalToText(settledGoal(combo.goal, solvableWith)) : pieces;
  return {
    solution: new Alg(joinMoves(combo.rotation, moves, undo ? undoing(reached) : "")),
    rotation: combo.rotation,
    offset,
    pieces,
    settled,
    alternative: combo.alternative,
    searches,
    ...(combo.untouched ? { changed: combo.untouched.changed } : {}),
  };
}

// Solve only the goal pieces (a step like the cross), trying each alternative × grip (each with all its offsets at once) and keeping the shortest answer
// (on a tie, the alternative adding more new pieces wins, so "cross | XCross" takes the XCross when it costs no extra move).
// The worker first measures every combo (exact distance from one table, or a lower bound from split tables), so only combos that can still win are searched.
// With rank "speed" the answer is the fastest to turn among the shortest answers and those up to extraMoves longer;
// with undoOffset it ends with the moves that undo its offset, and is the shortest (or fastest) counting them; with faces to avoid it's the best that
// turns none of them, if the answers compared hold one; with an alg set (options.algs) nothing is searched while one of the set's algs fits
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  // A step with an alg set: the case is recognised and its alg made; only a cube that fits none of the set's algs is searched
  const [known] = options.algs ? algCandidates(scramble, pieces, { ...options, maxCandidates: 1 }) : [];
  if (known) return known;
  // By speed, with the offset undone, or with faces to avoid: the first of the step's candidates, which come best first
  if (options.rank === "speed" || options.undoOffset || options.avoid?.length) return (await stepCandidates(scramble, pieces, { ...options, maxCandidates: 1 }))[0];
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  return stepResult(answer, searches, options.solvableWith);
}

// Most answers stepCandidates gives by default (each one costs a run of the next steps when a method looks ahead)
export const MAX_CANDIDATES = 64;

// Most answers of one combo that get a speed score when a step ranks by speed (all of them are scored before the fastest are kept)
export const MAX_RANKED = 1000;

// Search nodes a step may spend on listing answers (about 3 µs a node, so a few seconds): by speed on all of them, by moves on those longer than it has to
// list (the extra moves). Answers are listed one move longer at a time, and once this is used up the still longer ones are left out, so a step far from its
// goal (a long last-layer case) compares fewer extra moves than it was given, or only its shortest answer, instead of searching for minutes
export const LIST_NODES = 1_000_000;

// Options for listing a step's answers: solveStep's (extraMoves = how much longer than the shortest an answer may be), plus how many to give
export interface CandidateOptions extends StepOptions {
  maxCandidates?: number; // most answers given (default MAX_CANDIDATES), best first
  perAlternative?: number; // places of its own for each alternative's best answers instead (all of them: this many × the alternatives; a method's beam search)
}

// The first `most` of some ranked entries, each group's best first getting an equal share of the places and the best of the rest filling the others
// (in their ranked order): answers of an XCross next to a cross's, which their own cost alone would never let in
function shareOut<T>(ranked: T[], most: number, group: (entry: T) => number): T[] {
  const share = Math.max(1, Math.floor(most / new Set(ranked.map(group)).size));
  // Each group's best, up to its share
  const taken = new Map<number, number>();
  const chosen = new Set<T>();
  for (const entry of ranked) {
    const count = taken.get(group(entry)) ?? 0;
    if (count >= share) continue;
    taken.set(group(entry), count + 1);
    chosen.add(entry);
  }
  // The places left, to the best of the rest
  for (const entry of ranked) {
    if (chosen.size >= most) break;
    chosen.add(entry);
  }
  return ranked.filter((entry) => chosen.has(entry)).slice(0, most);
}

// Answers a step could take, for looking ahead: solveStep's answer first, then every other answer of every alternative × grip × offset up to extraMoves longer
// (shortest first, then the ones adding more new pieces, then the closest combos). Answers leaving the cube the same way count once, and an answer never
// passes through the goal on its way (that would be a shorter answer plus moves that keep the goal, which the next steps can always make themselves).
// With rank "speed" they come fastest first instead: up to MAX_RANKED answers per combo get a speed cost (grip rotation included, free on a solve's first step) before the list is cut,
// and of answers leaving the cube the same way the fastest stays. Each answer is also tried in the other grips that ask for the same thing (a cross with any
// front: the same turns with each front), as an answer of its own, since the hands turn it differently there; with wideAxes and rotationAxes on one axis,
// also with one turn made as the opposite wide turn and a rotation at the start or the end to make up for it, which leaves the cube as the plain answer
// does, and with wideAxes or sliceAxes, with any number of wide and slice turns whose cube turns cancel out (written as the hands make it:
// `r U R' U' r' F R F'` for `L F R' F' L' F R F'`).
// With undoOffset every answer goes on to undo the offset it reached, and is measured with those moves: by moves the shortest with them comes first.
// With faces to avoid, the answers come by tier first (see StepResult.tier): on those faces' account an answer only loses outright to one held the same way.
// By speed each answer is scored in the fastest order of its moves (see moveOrders in scoring.ts), and with "x" among the rotation axes, after a solve's first step, also
// with the cube tilted for it (see tiltForms in scoring.ts). Longer answers are listed one move longer at a time while the node budget lasts (see LIST_NODES).
// When several answers are given and the alternatives add different numbers of new pieces (cross | XCross), each size gets its own extra moves and a
// share of the places (see bySize). By speed with options.look, an answer's score also has what finding pieces costs (see speed/look.ts)
export async function stepCandidates(scramble: string, pieces: string, options: CandidateOptions = {}): Promise<StepResult[]> {
  // A step with an alg set lists the algs that fit, best first (see algCandidates); only a cube that fits none is searched
  const known = options.algs ? algCandidates(scramble, pieces, { ...options, maxCandidates: options.maxCandidates ?? MAX_CANDIDATES }) : [];
  if (known.length) return known;
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  const shortest = countMoves(answer.moves);
  // Places of its own for each alternative (perAlternative), or the most answers given. Twin grips count with their own alternatives: a placement that's
  // a rotation of another (XCross at FL, at FR…) is searched once, and its answers are scored in each twin's grip as that twin's alternative
  const apart = Math.max(0, Math.floor(options.perAlternative ?? 0));
  const alternatives = new Set(queue.flatMap((combo) => [combo.alternative, ...(combo.twins ?? []).map((twin) => twin.alternative)])).size;
  const most = apart ? apart * alternatives : Math.max(1, options.maxCandidates ?? MAX_CANDIDATES);
  const bySpeed = options.rank === "speed";
  // Faces the answer avoids when it can (none = nothing to avoid)
  const avoid = options.avoid ?? [];
  // With undoOffset an answer ends with the moves that undo the offset it reached ("" = it reached none, or the offset is left in)
  const undo = Boolean(options.undoOffset);
  const ending = (candidate: Answer) => (undo ? undoing(reachedOffset(candidate, options.solvableWith)) : "");
  // Longest answer that still counts: the shortest plus the extra moves (at least as many as its own ending takes, so an answer that needs no ending
  // and is no longer in all isn't missed), within the user's limit
  const longest = Math.min(shortest + Math.max(0, options.extraMoves ?? 0, countMoves(ending(answer))), options.maxDepth ?? Infinity);
  // Alternatives that add more new pieces (an XCross next to a cross) give longer answers, slower on their own, so when several answers are given each size
  // (new pieces) is listed and ranked apart: up to its own shortest plus the extra moves (at most twice the extra moves past the step's shortest), each
  // with its own bar and a share of the places (see shareOut). A lookahead then judges both kinds, over the same pieces (see runMethod)
  const bySize = most > 1 && new Set(queue.map((combo) => combo.fresh)).size > 1;
  const span = longest - shortest;
  const deepest = bySize ? Math.min(shortest + 2 * span, options.maxDepth ?? Infinity) : longest;
  // Each size's shortest answer listed so far (the step's shortest for its own size)
  const sizeShortest = new Map([[answer.combo.fresh, shortest]]);
  // Longest answer a combo may list: its size's shortest plus the extra moves, or while its size has none yet, as long as any
  const limitOf = (combo: Combo): number => {
    const own = sizeShortest.get(combo.fresh);
    return own === undefined ? deepest : Math.min(own + span, deepest);
  };
  // An answer's length, its ending counted
  const lengthOf = (candidate: Answer) => countMoves(candidate.moves) + countMoves(ending(candidate));
  const first: Listed = { answer, length: lengthOf(answer), order: -1, key: leaves(answer), speed: bySpeed ? Infinity : 0 };
  const seen = new Set([first.key]);
  const found: Listed[] = [];
  // By speed the answers are scored as they're listed (in the scoring worker while the search worker lists more, see scoringSession), the step's own
  // shortest first: it sets the bar
  const scoring = bySpeed ? scoringSession(scramble, pieces, scoringOptions(options), { most, apart, bySize }, queue) : null;
  scoring?.add([first]);
  let lists = 0;
  // A step that's already done (0 moves) has nothing else worth trying, and by moves one candidate is just the shortest answer (unless endings may change which that is)
  if (shortest > 0 && (most > 1 || bySpeed || undo || avoid.length)) {
    // Most answers one combo gives, and how many each gave so far
    const cap = bySpeed || undo || avoid.length ? MAX_RANKED : most;
    const given = queue.map(() => 0);
    // Answers up to `must` moves are always listed (the shortest, and as many more as the shortest answer's own ending takes); the longer ones one move
    // at a time over every combo, shortest first, while the step's node budget lasts
    const must = Math.min(shortest + countMoves(ending(answer)), longest);
    let budget = LIST_NODES;
    for (let depth = must; depth <= deepest && budget > 0; depth++) {
      const extra = depth > must;
      // By moves the answers a step has to list are never cut short
      const counted = extra || bySpeed;
      for (const [order, combo] of queue.entries()) {
        // Skip a combo whose distance (or lower bound) is too long, one past its size's extra moves, one that gave all it may, and for extra moves one
        // that only ever gives its one answer
        if (combo.bound > depth || depth > limitOf(combo) || given[order] >= cap || (extra && combo.twips)) continue;
        if (!given[order]) lists++;
        try {
          // Every answer of this combo up to this depth, or on an extra depth only the ones that long (the worker only lists answers shorter than its
          // maxDepth, hence + 1)
          const reply = await askWorker(
            {
              kind: "list",
              start: combo.start,
              targets: combo.targets,
              moves: options.generatorMoves ?? FACE_MOVES,
              solvableWith: options.solvableWith,
              orbitTables: orbitTables(combo),
              maxDepth: depth + 1,
              maxAnswers: cap - given[order],
              ...(extra ? { minDepth: depth } : {}),
              ...(counted ? { maxNodes: budget } : {}),
            },
            options.onProgress,
          );
          if (counted) budget -= reply.nodes ?? 0;
          const listed: Listed[] = [];
          for (const moves of reply.answers ?? []) {
            given[order]++;
            // The first answers of a size set where its extra moves end
            sizeShortest.set(combo.fresh, Math.min(sizeShortest.get(combo.fresh) ?? Infinity, countMoves(moves)));
            const candidate = { combo, moves };
            // By speed every answer goes on to be scored, where the fastest of those leaving the cube the same way stays
            if (bySpeed) {
              listed.push({ answer: candidate, length: lengthOf(candidate), order, key: "", speed: Infinity });
              continue;
            }
            // By moves an answer leaving the cube like an earlier one is dropped here
            const key = leaves(candidate);
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ answer: candidate, length: lengthOf(candidate), order, key, speed: 0 });
          }
          scoring?.add(listed);
        } catch (error) {
          // Out of nodes: no longer answers from here on (any other error: no answer within the limit for this combo)
          if (String((error as Error).message ?? error).includes(NODE_LIMIT)) budget = 0;
        }
        if (budget <= 0) break;
      }
    }
  }
  let ranked: Listed[];
  if (scoring) {
    // By speed: every answer scored, fastest first (see makeScorer)
    ranked = await scoring.finish();
  } else {
    // By moves: the step's own shortest answer first, then the others; with endings counted that answer takes its place among them (first on a tie)
    setTiers([first, ...found], avoid, false, ending);
    ranked = undo || avoid.length ? [first, ...found].sort((a, b) => byTier(a, b) || byMoves(a, b)) : [first, ...found.sort(byMoves)];
  }
  // Places for each alternative: each one's best get its own share; else sizes ranked apart: each size's best get a share of the places
  if (apart) ranked = shareOut(ranked, most, (entry) => entry.answer.combo.alternative);
  else if (bySize) ranked = shareOut(ranked, most, (entry) => entry.answer.combo.fresh);
  return ranked.slice(0, most).map((entry) => {
    const plain = stepResult(entry.answer, searches + lists, options.solvableWith, undo);
    const result = entry.tier === undefined ? plain : { ...plain, tier: entry.tier };
    // An answer with a wide turn is the plain one's result with its own solution, in both writings
    const { rotation } = entry.answer.combo;
    return entry.wide ? { ...result, solution: new Alg(joinMoves(rotation, entry.wide.plain)), wide: joinMoves(rotation, entry.wide.wide) } : result;
  });
}

// Solve the whole cube, judged by its centers in the grip it's held in
export async function solveFull(scramble: string, done = ""): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(joinMoves(scramble, done)));
}
