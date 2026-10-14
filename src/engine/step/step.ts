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
// Speed cost of a move sequence, and an answer's cheapest writing with wide and slice turns
import { speedCost, speedFloor, writingFloor, cheapestWriting, strained } from "../speed/fingering";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// Page side of the search worker
import { askWorker } from "../worker/client";
// What a list that used up its node budget fails with
import { NODE_LIMIT } from "../worker/protocol";
// Steps answered from an alg set
import { algCandidates } from "./alg-step";
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

// True when a solution turns one of these faces (a wide turn counts for its face; rotations don't)
export function turnsFaces(moves: string, faces: string[]): boolean {
  return faces.length > 0 && moves.split(" ").some((move) => faces.includes(move[0]));
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
  form?: string; // an answer with one turn made wide: which of its wide forms it is (they're answers of their own, though they leave the cube the same way)
  avoided?: boolean;
  tier?: number;
}

// How long a step scores answers before it gives the page a turn (so a timer keeps running and the page still answers), in milliseconds
const SCORING_SLICE_MS = 25;
// When a scoring step last gave the page a turn (one clock for all of them: a lookahead scores many steps at once)
let lastTurnGiven = 0;

// Give the page a turn if scoring has held it for a slice
async function givePageATurn(): Promise<void> {
  if (performance.now() - lastTurnGiven < SCORING_SLICE_MS) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  lastTurnGiven = performance.now();
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

// An answer's moves made with the cube tilted, as algs with F and B turns are learnt: an x or x' first (the wrists turn the whole cube), the moves named
// for the cube held that way, and the tilt back (R2 B2 R F R' B2 R F' R is x R2 D2 R U R' D2 R U' R x'). A turn of the top layer that starts or ends the
// answer may stay outside the tilt (U2 x … x' U'). Each in two writings, as wideForms gives them: `wide` as the hands make it, `plain` the answer itself
function tiltForms(moves: string[], grip: string): { wide: string; plain: string }[] {
  // Tilting only pays when it takes turns off F and B (they become turns of the top and bottom layers)
  if (moves.filter((move) => "FB".includes(move[0])).length < 2) return [];
  const plain = moves.join(" ");
  // Where the tilted part may start and end: the whole answer, or without a turn of the top layer at either end
  const starts = moves[0][0] === "U" ? [0, 1] : [0];
  const ends = moves.at(-1)![0] === "U" ? [moves.length, moves.length - 1] : [moves.length];
  return ["x", "x'"].flatMap((tilt) => {
    const back = turned(tilt, "'");
    return starts.flatMap((start) =>
      ends.flatMap((end) => {
        // The tilted part, named for the cube held that way (nothing left to tilt for: no form)
        const body = end - start < 2 ? null : movesInGrip(moves.slice(start, end).join(" "), grip, joinMoves(grip, tilt));
        return body === null ? [] : [{ wide: joinMoves(moves.slice(0, start).join(" "), tilt, body, back, moves.slice(end).join(" ")), plain }];
      }),
    );
  });
}

// The axis each layer turns about: turns about one axis in a row can be made in any order
const AXIS_OF: Record<string, string> = { R: "x", L: "x", M: "x", U: "y", D: "y", E: "y", F: "z", B: "z", S: "z" };

// Most orders of one answer that get a speed score
const MAX_ORDERS = 8;

// Every order of a few moves
function permutations(moves: string[]): string[][] {
  if (moves.length < 2) return [moves];
  return moves.flatMap((move, index) => permutations([...moves.slice(0, index), ...moves.slice(index + 1)]).map((rest) => [move, ...rest]));
}

// Every order an answer's moves can be made in: turns about one axis in a row may swap (L' R' is R' L' to the cube), and the hands may turn one order
// faster than the other (after R U, R' L' brings the right hand home before the left one turns). The search lists one order only; the listed one comes first
export function moveOrders(moves: string): string[] {
  const tokens = moves.split(" ").filter(Boolean);
  // No two turns about one axis in a row (most answers): the listed order is the only one
  if (!tokens.some((token, at) => at > 0 && AXIS_OF[token[0].toUpperCase()] !== undefined && AXIS_OF[token[0].toUpperCase()] === AXIS_OF[tokens[at - 1][0].toUpperCase()])) return [moves];
  let orders: string[][] = [[]];
  for (let at = 0; at < tokens.length; ) {
    // The run of turns about one axis that starts here (a rotation is a run of its own)
    const axis = AXIS_OF[tokens[at][0].toUpperCase()];
    let end = at + 1;
    while (axis && end < tokens.length && AXIS_OF[tokens[end][0].toUpperCase()] === axis) end++;
    const run = tokens.slice(at, end);
    // Each order so far goes on with each order of the run (only the listed one once there are enough)
    const runs = permutations(run);
    const kept = orders.length * runs.length > MAX_ORDERS ? [run] : runs;
    orders = orders.flatMap((order) => kept.map((next) => [...order, ...next]));
    at = end;
  }
  return orders.map((order) => order.join(" "));
}

// Answers a step could take, for looking ahead: solveStep's answer first, then every other answer of every alternative × grip × offset up to extraMoves longer
// (shortest first, then the ones adding more new pieces, then the closest combos). Answers leaving the cube the same way count once, and an answer never
// passes through the goal on its way (that would be a shorter answer plus moves that keep the goal, which the next steps can always make themselves).
// With rank "speed" they come fastest first instead: up to MAX_RANKED answers per combo get a speed cost (grip rotation included, free on a solve's first step) before the list is cut,
// and of answers leaving the cube the same way the fastest stays. Each answer is also tried in the other grips that ask for the same thing (a cross with any
// front: the same turns with each front), as an answer of its own, since the hands turn it differently there; with wideAxes, also with one turn made as the opposite
// wide turn and a rotation at the start or the end to make up for it, which leaves the cube as the plain answer does, and with any number of wide and
// slice turns whose cube turns cancel out (written as the hands make it: `r U R' U' r' F R F'` for `L F R' F' L' F R F'`).
// With undoOffset every answer goes on to undo the offset it reached, and is measured with those moves: by moves the shortest with them comes first.
// With faces to avoid, the answers come by tier first (see StepResult.tier): on those faces' account an answer only loses outright to one held the same way.
// By speed each answer is scored in the fastest order of its moves (see moveOrders), and with "x" among the wide axes, after a solve's first step, also with
// the cube tilted for it (see tiltForms). Longer answers are listed one move longer at a time while the node budget lasts (see LIST_NODES)
export async function stepCandidates(scramble: string, pieces: string, options: CandidateOptions = {}): Promise<StepResult[]> {
  // A step with an alg set lists the algs that fit, best first (see algCandidates); only a cube that fits none is searched
  const known = options.algs ? algCandidates(scramble, pieces, { ...options, maxCandidates: options.maxCandidates ?? MAX_CANDIDATES }) : [];
  if (known.length) return known;
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
  const first: Listed = { answer, length: lengthOf(answer), order: -1, key: leaves(answer), speed: bySpeed ? Infinity : 0 };
  const seen = new Set([first.key]);
  const found: Listed[] = [];
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
    for (let depth = must; depth <= longest && budget > 0; depth++) {
      const extra = depth > must;
      // By moves the answers a step has to list are never cut short
      const counted = extra || bySpeed;
      for (const [order, combo] of queue.entries()) {
        // Skip a combo whose distance (or lower bound) is too long, one that gave all it may, and for extra moves one that only ever gives its one answer
        if (combo.bound > depth || given[order] >= cap || (extra && combo.twips)) continue;
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
          for (const moves of reply.answers ?? []) {
            given[order]++;
            const candidate = { combo, moves };
            // By speed every answer goes on to be scored (below), where the fastest of those leaving the cube the same way stays
            if (bySpeed) {
              found.push({ answer: candidate, length: lengthOf(candidate), order, key: "", speed: Infinity });
              continue;
            }
            // By moves an answer leaving the cube like an earlier one is dropped here
            const key = leaves(candidate);
            if (seen.has(key)) continue;
            seen.add(key);
            found.push({ answer: candidate, length: lengthOf(candidate), order, key, speed: 0 });
          }
        } catch (error) {
          // Out of nodes: no longer answers from here on (any other error: no answer within the limit for this combo)
          if (String((error as Error).message ?? error).includes(NODE_LIMIT)) budget = 0;
        }
        if (budget <= 0) break;
      }
    }
  }
  // Shortest first, then the ones adding more new pieces, then the closest combos (the sort keeps each list's own order on ties)
  const byMoves = (a: Listed, b: Listed) => a.length - b.length || b.answer.combo.fresh - a.answer.combo.fresh || a.order - b.order;
  // An answer as the hands make it (its wide writing when it has one), its grip rotation first
  const handsText = (entry: Listed) => joinMoves(entry.answer.combo.rotation, entry.wide ? entry.wide.wide : joinMoves(entry.answer.moves, ending(entry.answer)));
  // Whether an answer turns a face to avoid (or is strained), and the rotations it starts with (how the cube is held for it)
  // An answer that turns L against an open R layer (or the reverse) is no clean answer either: it only wins where the ranking says so
  const dirty = (entry: Listed) => (entry.avoided ??= turnsFaces(handsText(entry), avoid) || strained(handsText(entry)));
  const holdOf = (entry: Listed) => /^((?:[xyz]\S* ?)*)/.exec(handsText(entry))![1].trim();
  // With faces to avoid, every answer's tier (see StepResult.tier). By moves: none of the faces is 0, turning some where no answer held the same way
  // does without is 1, turning some although one held the same way doesn't is 2. By speed only that last kind comes later (tier 1): a rotation's cost is
  // in the score, so an answer on other faces after a rotation, one without a rotation and one that has to turn the faces are ranked together
  const setTiers = (entries: Listed[], holds?: Set<string>): void => {
    if (!avoid.length) return;
    // The holds in which some answer is clean (given by a caller that knows of answers left out of `entries`)
    const cleanHolds = holds ?? new Set(entries.filter((entry) => !dirty(entry)).map(holdOf));
    for (const entry of entries) {
      const beaten = dirty(entry) && cleanHolds.has(holdOf(entry));
      entry.tier = bySpeed ? (beaten ? 1 : 0) : dirty(entry) ? (beaten ? 2 : 1) : 0;
    }
  };
  const byTier = (a: Listed, b: Listed) => (a.tier ?? 0) - (b.tier ?? 0);
  let ranked: Listed[];
  if (bySpeed) {
    const axes = options.wideAxes ?? [];
    // The answers scored so far, and the holds in which some answer is clean (scored or not: it decides the tiers)
    const scored: Listed[] = [];
    const cleanHolds = new Set<string>();
    // An answer's key among the scored ones: how it leaves the cube (worked out when first needed), and for a wide form which one it is
    const keyOf = (entry: Listed) => (entry.form ?? "") + (entry.key ||= leaves(entry.answer));
    // The fastest answers so far that are sure of a place whatever comes later (clean ones, one per key), fastest first. Once there are `most`, the
    // slowest of them is the bar: an answer whose floor (see speedFloor) is above it can't make the list, so it isn't scored at all. With extra
    // moves most answers are long ones that a good short one rules out this way
    const sure: { key: string; speed: number }[] = [];
    let bar = Infinity;
    const keep = (entry: Listed, clean: boolean): void => {
      scored.push(entry);
      if (!clean || entry.speed >= bar) return;
      const key = keyOf(entry);
      const same = sure.findIndex((item) => item.key === key);
      if (same >= 0 && sure[same].speed <= entry.speed) return;
      if (same >= 0) sure.splice(same, 1);
      sure.push({ key, speed: entry.speed });
      sure.sort((a, b) => a.speed - b.speed);
      sure.length = Math.min(sure.length, most);
      if (sure.length === most) bar = sure[most - 1].speed;
    };
    // Whether moves as the hands make them are clean (none of the faces to avoid, no turn against an open layer); a clean one's hold is noted
    const noteClean = (text: string): boolean => {
      const clean = !avoid.length || (!turnsFaces(text, avoid) && !strained(text));
      if (clean && avoid.length) cleanHolds.add(/^((?:[xyz]\S* ?)*)/.exec(text)![1].trim());
      return clean;
    };
    // Moves as the hands make them, scored unless their floor is above the bar (a tie with the bar is still scored: the order of the answers decides it)
    const score = (text: string): { speed: number; clean: boolean } | null => {
      const clean = noteClean(text);
      return speedFloor(text, undefined, fresh) > bar + 1e-6 ? null : { speed: speedCost(text, undefined, fresh), clean };
    };
    // One listed answer in every way the hands can make it: as held and in every twin grip of its combo (the grips that ask for the same thing: the same
    // moves, renamed), each in the fastest order of its moves (turns about one axis in a row; the listed order on a tie). With wide axes also with one
    // turn made as the opposite wide turn (R as Lw…) and a rotation at the start or the end to make up for it, as answers of their own, and in its
    // cheapest writing with wide and slice turns that cancel out (r … r', M, f … f') or with the cube tilted for it (after a solve's first step, which
    // picks how the cube is held for free), which take the plain writing's place when they're faster
    const scoreAnswer = (raw: Listed): void => {
      const { combo, moves } = raw.answer;
      const twins = (combo.twins ?? []).flatMap((twin): Answer[] => {
        const renamed = movesInGrip(moves, combo.rotation, twin.rotation);
        return renamed === null ? [] : [{ combo: twin, moves: renamed }];
      });
      [raw.answer, ...twins].forEach((held, index) => {
        const base: Listed = index ? { answer: held, length: raw.length, order: raw.order, key: "", speed: Infinity } : raw;
        const { rotation } = held.combo;
        const tail = ending(held);
        let own: (Listed & { clean: boolean }) | null = null;
        for (const order of moveOrders(held.moves)) {
          const result = score(joinMoves(rotation, order, tail));
          if (result && (!own || result.speed < own.speed)) own = { ...base, answer: { combo: held.combo, moves: order }, ...result };
        }
        if (axes.length) {
          // The other writings start from the fastest order (the listed one when no order was worth scoring)
          const from: Listed = own ?? base;
          const all = joinMoves(from.answer.moves, tail).split(" ").filter(Boolean);
          const plain = all.join(" ");
          wideForms(all, rotation, axes).forEach((wide, place) => {
            const result = score(joinMoves(rotation, wide.wide));
            if (result) keep({ ...from, form: `wide${place}/`, speed: result.speed, wide }, result.clean);
          });
          // Only worth writing out when no writing at all would be under the bar
          const written = writingFloor(plain, undefined, fresh, rotation) > bar + 1e-6 ? null : cheapestWriting(plain, axes, undefined, fresh, rotation, bar);
          if (written && (!own || written.cost < own.speed)) own = { ...from, speed: written.cost, wide: { wide: written.text, plain }, clean: noteClean(joinMoves(rotation, written.text)) };
          for (const tilt of axes.includes("x") && !fresh ? tiltForms(all, rotation) : []) {
            const result = score(joinMoves(rotation, tilt.wide));
            if (result && (!own || result.speed < own.speed)) own = { ...from, wide: tilt, ...result };
          }
        }
        if (own) keep(own, own.clean);
      });
    };
    // Every answer, the step's own shortest first (it sets the bar), with a turn for the page every few milliseconds
    for (const raw of [first, ...found]) {
      scoreAnswer(raw);
      await givePageATurn();
    }
    // Fastest first (ties as above), keeping the first of the answers that leave the cube the same way, until there are enough
    const kept = new Set<string>();
    ranked = [];
    setTiers(scored, cleanHolds);
    for (const entry of scored.sort((a, b) => byTier(a, b) || a.speed - b.speed || byMoves(a, b))) {
      const key = keyOf(entry);
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
