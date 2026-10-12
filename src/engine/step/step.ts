// Step solvers: the shortest answer over a step's combos, every answer up to some extra moves (for lookahead), and the full-cube solver

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Full 3x3x3 solver
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
// Move text helpers
import { FACE_MOVES, countMoves, joinMoves, invertMoves } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Moves as other grips see them
import { movesInGrip } from "../core/turns";
// Roles, goal text and goal masks
import { maskPattern, goalToText } from "../goal/goal";
// Solvable-with moves
import { solvableIndex, settledGoal } from "../goal/solvable";
// Speed cost of a move sequence
import { speedCost } from "../speed/fingering";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// One alternative × grip of a step
import { type Combo, type Answer, knownAnswer, searchCombo, orbitTables } from "./combo";
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

// The offset an answer reaches: the one of the target the cube matches after it, or with solvable-with moves the one those moves reach (a lone target needs no check)
function reachedOffset({ combo, moves }: Answer, solvableWith: string[] = []): string {
  const end = maskPattern(combo.held.applyAlg(moves), combo.goal);
  const reached = !solvableWith.length
    ? combo.targets.findIndex((target) => end.isIdentical(target))
    : combo.targets.length > 1
      ? solvableIndex(end, combo.targets, solvableWith)
      : 0;
  return combo.offsets[Math.max(0, reached)];
}

// The moves that undo an offset, a half turn written plainly ("D2", not "D2'")
function undoing(offset: string): string {
  return invertMoves(offset).replace(/2'/g, "2");
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
// turns none of them, if the answers compared hold one
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  // By speed, with the offset undone, or with faces to avoid: the first of the step's candidates, which come best first
  if (options.rank === "speed" || options.undoOffset || options.avoid?.length) return (await stepCandidates(scramble, pieces, { ...options, maxCandidates: 1 }))[0];
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  return stepResult(answer, searches, options.solvableWith);
}

// True when a solution turns one of these faces (a wide turn counts for its face; rotations don't)
export function turnsFaces(moves: string, faces: string[]): boolean {
  return faces.length > 0 && moves.split(" ").some((move) => faces.includes(move[0]));
}

// Most answers stepCandidates gives by default (each one costs a run of the next steps when a method looks ahead)
export const MAX_CANDIDATES = 64;

// Most answers of one combo that get a speed score when a step ranks by speed (all of them are scored before the fastest are kept)
export const MAX_RANKED = 1000;

// Options for listing a step's answers: solveStep's (extraMoves = how much longer than the shortest an answer may be), plus how many to give
export interface CandidateOptions extends StepOptions {
  maxCandidates?: number; // most answers given (default MAX_CANDIDATES), best first
}

// One listed answer: its length, its combo's place in the queue, how it leaves the cube, its speed cost (0 unless ranking by speed),
// and when it's the answer with one turn made as a wide turn, that solution in both its writings (after the grip rotation)
interface Listed {
  answer: Answer;
  length: number;
  order: number;
  key: string;
  speed: number;
  wide?: { wide: string; plain: string };
  avoided?: boolean;
  tier?: number;
}

// Faces whose turns can be made as the opposite wide turn, per axis: the face, the wide turn's family, and the rotation that makes up for a clockwise quarter
// turn. R is Lw then x: the left hand turns two layers while the right holds its own still, and the cube ends up turned as by x
const WIDE_FOR: Record<string, [string, string, string][]> = {
  x: [
    ["R", "Lw", "x"],
    ["L", "Rw", "x'"],
  ],
  y: [
    ["U", "Dw", "y"],
    ["D", "Uw", "y'"],
  ],
  z: [
    ["F", "Bw", "z"],
    ["B", "Fw", "z'"],
  ],
};

// A plain face turn: its face and what follows it ("", "'" or "2")
const FACE_TURN = /^([URFDLB])('|2)?$/;

// A rotation given for a clockwise quarter turn, for a turn with this suffix: the other way round for a prime, twice for a half turn
function turned(rotation: string, suffix: string): string {
  if (suffix === "2") return `${rotation[0]}2`;
  return rotation.endsWith("'") === (suffix === "'") ? rotation[0] : `${rotation[0]}'`;
}

// An answer's moves with one of them made as the opposite wide turn, in both ways the cube's turn can be made up, each in two writings (after the grip
// rotation): `wide` as the hands make it, and `plain` with the turn itself and a rotation, which is the same thing to the cube. Made up first: a rotation,
// the moves before named for the cube held that way, the wide turn, the rest. Made up last: the wide turn, the moves after named as the cube lies until
// then, and the rotation. Both leave the cube exactly as the plain moves do
function wideForms(moves: string[], grip: string, axes: string[]): { wide: string; plain: string }[] {
  return moves.flatMap((move, index) => {
    const [, face, suffix = ""] = FACE_TURN.exec(move) ?? [];
    const pair = axes.flatMap((axis) => WIDE_FOR[axis] ?? []).find(([turn]) => turn === face);
    if (!pair) return [];
    // The wide turn, the rotation that makes up for it, and that rotation undone
    const [wide, rotation] = [pair[1] + suffix, turned(pair[2], suffix)];
    const back = rotation.endsWith("2") ? rotation : turned(rotation, "'");
    const [before, after] = [moves.slice(0, index).join(" "), moves.slice(index + 1).join(" ")];
    const held = joinMoves(grip, rotation);
    // Rotation first: the moves before, the turn and the wide turn, as the rotated cube names them
    const [early, turn, same] = [movesInGrip(before, grip, held), movesInGrip(move, grip, held), movesInGrip(wide, grip, held)];
    // Rotation last: the moves after, as the cube names them before it's rotated
    const late = movesInGrip(after, held, grip);
    return [
      ...(early === null || turn === null || same === null ? [] : [{ wide: joinMoves(rotation, early, same, after), plain: joinMoves(rotation, early, turn, back, after) }]),
      ...(late === null ? [] : [{ wide: joinMoves(before, wide, late, rotation), plain: joinMoves(before, move, back, late, rotation) }]),
    ];
  });
}

// Answers a step could take, for looking ahead: solveStep's answer first, then every other answer of every alternative × grip × offset up to extraMoves longer
// (shortest first, then the ones adding more new pieces, then the closest combos). Answers leaving the cube the same way count once, and an answer never
// passes through the goal on its way (that would be a shorter answer plus moves that keep the goal, which the next steps can always make themselves).
// With rank "speed" they come fastest first instead: up to MAX_RANKED answers per combo get a speed cost (grip rotation included, free on a solve's first step) before the list is cut,
// and of answers leaving the cube the same way the fastest stays. Each answer is also tried in the other grips that ask for the same thing (a cross with any
// front: the same turns with each front), as an answer of its own, since the hands turn it differently there; with wideAxes, also with one turn made as the opposite
// wide turn and a rotation at the start or the end to make up for it, which leaves the cube as the plain answer does.
// With undoOffset every answer goes on to undo the offset it reached, and is measured with those moves: by moves the shortest with them comes first.
// With faces to avoid, the answers come by tier first (see StepResult.tier): on those faces' account an answer only loses outright to one held the same way
export async function stepCandidates(scramble: string, pieces: string, options: CandidateOptions = {}): Promise<StepResult[]> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  const shortest = countMoves(answer.moves);
  const most = Math.max(1, options.maxCandidates ?? MAX_CANDIDATES);
  const bySpeed = options.rank === "speed";
  // Faces the answer avoids when it can (none = nothing to avoid)
  const avoid = options.avoid ?? [];
  // With undoOffset an answer ends with the moves that undo the offset it reached ("" = it reached none, or the offset is left in)
  const undo = Boolean(options.undoOffset);
  const ending = (candidate: Answer) => (undo ? undoing(reachedOffset(candidate, options.solvableWith)) : "");
  // Longest answer that still counts: the shortest plus the extra moves (at least as many as its own ending takes, so an answer that needs no ending
  // and is no longer in all isn't missed), within the user's limit
  const longest = Math.min(shortest + Math.max(0, options.extraMoves ?? 0, countMoves(ending(answer))), options.maxDepth ?? Infinity);
  // How an answer leaves the cube (grip and every piece, as it really is: untouched steps' held cubes are relabeled), so answers leaving it the same way count once
  const leaves = ({ combo, moves }: Answer) => `${combo.rotation}/${JSON.stringify((combo.cube ?? combo.held).applyAlg(moves).patternData)}`;
  // An answer's speed cost, its grip rotation included, which is free when nothing was turned before the step (only worked out when ranking by speed)
  const fresh = !options.done?.trim();
  const speed = (candidate: Answer) => (bySpeed ? speedCost(joinMoves(candidate.combo.rotation, candidate.moves, ending(candidate)), undefined, fresh) : 0);
  // An answer's length, its ending counted
  const lengthOf = (candidate: Answer) => countMoves(candidate.moves) + countMoves(ending(candidate));
  const first: Listed = { answer, length: lengthOf(answer), order: -1, key: leaves(answer), speed: speed(answer) };
  const seen = new Set([first.key]);
  const found: Listed[] = [];
  let lists = 0;
  // A step that's already done (0 moves) has nothing else worth trying, and by moves one candidate is just the shortest answer (unless endings may change which that is)
  if (shortest > 0 && (most > 1 || bySpeed || undo || avoid.length)) {
    for (const [order, combo] of queue.entries()) {
      // Skip a combo whose distance (or lower bound) is already too long
      if (combo.bound > longest) continue;
      lists++;
      try {
        // Every answer of this combo up to the longest (the worker only lists answers shorter than its maxDepth, hence + 1)
        const reply = await askWorker(
          {
            kind: "list",
            start: combo.start,
            targets: combo.targets,
            moves: options.generatorMoves ?? FACE_MOVES,
            solvableWith: options.solvableWith,
            orbitTables: orbitTables(combo),
            maxDepth: longest + 1,
            maxAnswers: bySpeed || undo || avoid.length ? MAX_RANKED : most,
          },
          options.onProgress,
        );
        for (const moves of reply.answers ?? []) {
          const candidate = { combo, moves };
          const key = leaves(candidate);
          // By moves an answer leaving the cube like an earlier one is dropped here; by speed it's scored too, and the fastest of them stays (below)
          if (!bySpeed && seen.has(key)) continue;
          seen.add(key);
          found.push({ answer: candidate, length: lengthOf(candidate), order, key, speed: speed(candidate) });
        }
      } catch {
        // No answer within the limit for this combo
      }
    }
  }
  // Shortest first, then the ones adding more new pieces, then the closest combos (the sort keeps each list's own order on ties)
  const byMoves = (a: Listed, b: Listed) => a.length - b.length || b.answer.combo.fresh - a.answer.combo.fresh || a.order - b.order;
  // An answer as the hands make it (its wide writing when it has one), its grip rotation first
  const handsText = (entry: Listed) => joinMoves(entry.answer.combo.rotation, entry.wide ? entry.wide.wide : joinMoves(entry.answer.moves, ending(entry.answer)));
  // Whether an answer turns a face to avoid, and the rotations it starts with (how the cube is held for it)
  const dirty = (entry: Listed) => (entry.avoided ??= turnsFaces(handsText(entry), avoid));
  const holdOf = (entry: Listed) => /^((?:[xyz]\S* ?)*)/.exec(handsText(entry))![1].trim();
  // With faces to avoid, every answer's tier (see StepResult.tier): none of the faces and no rotation that costs is 0; none of them after a rotation is 1,
  // as is turning some where no answer held the same way does without; turning some although one held the same way doesn't is 2
  const setTiers = (entries: Listed[]): void => {
    if (!avoid.length) return;
    const cleanHolds = new Set(entries.filter((entry) => !dirty(entry)).map(holdOf));
    for (const entry of entries) entry.tier = dirty(entry) ? (cleanHolds.has(holdOf(entry)) ? 2 : 1) : bySpeed && !fresh && holdOf(entry) ? 1 : 0;
  };
  const byTier = (a: Listed, b: Listed) => (a.tier ?? 0) - (b.tier ?? 0);
  let ranked: Listed[];
  if (bySpeed) {
    // Each answer in every twin grip of its combo too (the grips that ask for the same thing): the same moves, renamed for that grip
    const gripped = [first, ...found].flatMap((entry) => {
      const { combo, moves } = entry.answer;
      const twins = (combo.twins ?? []).flatMap((twin): Listed[] => {
        const renamed = movesInGrip(moves, combo.rotation, twin.rotation);
        if (renamed === null) return [];
        const twinned = { combo: twin, moves: renamed };
        return [{ answer: twinned, length: entry.length, order: entry.order, key: "", speed: speed(twinned) }];
      });
      return [entry, ...twins];
    });
    // With wide axes, each of those also with one turn made as the opposite wide turn (R as Lw…), the cube's turn made up by a rotation at the start or at the
    // end. The cube ends as the plain answer leaves it, so its result is the plain one's with this solution
    const axes = options.wideAxes ?? [];
    const held = !axes.length
      ? gripped
      : gripped.flatMap((entry) => {
          const { combo, moves } = entry.answer;
          const key = entry.key || leaves(entry.answer);
          const all = joinMoves(moves, ending(entry.answer)).split(" ").filter(Boolean);
          const wides = wideForms(all, combo.rotation, axes).map((wide, index): Listed => ({ ...entry, key: `wide${index}/${key}`, speed: speedCost(joinMoves(combo.rotation, wide.wide), undefined, fresh), wide }));
          return [{ ...entry, key }, ...wides];
        });
    // Fastest first (ties as above), keeping the first of the answers that leave the cube the same way, until there are enough
    const kept = new Set<string>();
    ranked = [];
    setTiers(held);
    for (const entry of held.sort((a, b) => byTier(a, b) || a.speed - b.speed || byMoves(a, b))) {
      const key = entry.key || leaves(entry.answer);
      if (kept.has(key)) continue;
      kept.add(key);
      ranked.push(entry);
      if (ranked.length === most) break;
    }
  } else {
    // By moves: the step's own shortest answer first, then the others; with endings counted that answer takes its place among them (first on a tie)
    setTiers([first, ...found]);
    ranked = undo || avoid.length ? [first, ...found].sort((a, b) => byTier(a, b) || byMoves(a, b)) : [first, ...found.sort(byMoves)];
  }
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
