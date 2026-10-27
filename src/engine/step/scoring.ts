// Scoring a step's listed answers by speed: each answer in every way the hands can make it (twin grips, move orders, wide and slice writings, tilts),
// against a bar that rises as answers come in, then ranked. The same code runs on the page or in a scoring worker (see worker/scoring-worker.ts)

// Move text helpers
import { joinMoves, invertMoves, cancelsInto, lookedFrom, shortRotations, withoutEndRotations } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Moves as other grips see them
import { movesInGrip } from "../core/turns";
// Goal masks and merging
import { maskPattern, mergeGoals } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Solvable-with moves
import { solvableIndex } from "../goal/solvable";
// Speed cost of a move sequence, and an answer's cheapest writing with wide and slice turns (with the bounds of its search)
import { speedCost, speedFloor, writingFloor, writingSearch, strained, cancelSaving, type WritingSearch, type Writing } from "../speed/fingering";
// Frames rotations hold the cube in, and turns named without a grip's rotations
import { frameAfter, undoRotations, turnsBefore } from "../speed/writings";
// What finding a step's pieces costs
import { LOOK, hiddenShare, lookCost, newPieces, nextGroups, nextLook, pieceCount, inspectionLook } from "../speed/look";
// Engine data shapes
import type { Goal, StepOptions } from "../types";
// The bar a list's speed bound prunes with
import type { Limit } from "./bound";
// One alternative × grip of a step
import type { Combo, Answer } from "./combo";

// One listed answer: its length, its combo's place in the queue, how it leaves the cube, its speed cost (0 unless ranking by speed),
// and when it's the answer with one turn made as a wide turn, that solution in both its writings (after the grip rotation, or for a writing that starts
// held another way after the rotations in `start`, "" = none)
export interface Listed {
  answer: Answer;
  length: number;
  order: number;
  key: string;
  speed: number;
  wide?: { wide: string; plain: string; start?: string };
  form?: string; // an answer with one turn made wide: which of its wide forms it is (they're answers of their own, though they leave the cube the same way)
  avoided?: boolean;
  tier?: number;
}

// The options a step's scoring reads (plain data, so a scoring worker can be sent them)
export type ScoringOptions = Pick<
  StepOptions,
  "done" | "look" | "untouched" | "buffer" | "earlier" | "keep" | "next" | "previous" | "previousStarts" | "last" | "wideAxes" | "sliceAxes" | "rotationAxes" | "avoid" | "solvableWith" | "undoOffset"
>;

// The scoring options of a step's options (left-out ones stay out)
export function scoringOptions(options: StepOptions): ScoringOptions {
  const { done, look, untouched, buffer, earlier, keep, next, previous, previousStarts, last, wideAxes, sliceAxes, rotationAxes, avoid, solvableWith, undoOffset } = options;
  const picked: ScoringOptions = { done, look, untouched, buffer, earlier, keep, next, previous, previousStarts, last, wideAxes, sliceAxes, rotationAxes, avoid, solvableWith, undoOffset };
  for (const name of Object.keys(picked) as (keyof ScoringOptions)[]) if (picked[name] === undefined) delete picked[name];
  return picked;
}

// How a step's places are shared out: the most answers given, places of its own for each alternative (0 = none), and whether sizes (new pieces) are ranked apart
export interface Places {
  most: number;
  apart: number;
  bySize: boolean;
}

// The offset an answer reaches: the one of the target the cube matches after it, or with solvable-with moves the one those moves reach (a lone target needs no check)
export function reachedOffset({ combo, moves }: Answer, solvableWith: string[] = []): string {
  // One offset (most steps: none): it's that one, nothing to check
  if (combo.offsets.length === 1) return combo.offsets[0];
  const end = maskPattern(combo.held.applyAlg(moves), combo.goal);
  const reached = !solvableWith.length
    ? combo.targets.findIndex((target) => end.isIdentical(target))
    : combo.targets.length > 1
      ? solvableIndex(end, combo.targets, solvableWith)
      : 0;
  return combo.offsets[Math.max(0, reached)];
}

// The moves that undo an offset, a half turn written plainly ("D2", not "D2'")
export function undoing(offset: string): string {
  return invertMoves(offset).replace(/2'/g, "2");
}

// What an answer ends with: with undoOffset the moves that undo the offset it reached ("" = it reached none, or the offset is left in)
export function endingOf(options: ScoringOptions): (candidate: Answer) => string {
  const undo = Boolean(options.undoOffset);
  return (candidate) => (undo ? undoing(reachedOffset(candidate, options.solvableWith)) : "");
}

// How an answer leaves the cube (grip and every piece, as it really is: untouched steps' held cubes are relabeled), so answers leaving it the same way count once
export function leaves({ combo, moves }: Answer): string {
  return `${combo.rotation}/${JSON.stringify((combo.cube ?? combo.held).applyAlg(moves).patternData)}`;
}

// Shortest first, then the ones adding more new pieces, then the closest combos (the sort keeps each list's own order on ties)
export function byMoves(a: Listed, b: Listed): number {
  return a.length - b.length || b.answer.combo.fresh - a.answer.combo.fresh || a.order - b.order;
}

// Lower tiers first (see StepResult.tier)
export function byTier(a: Listed, b: Listed): number {
  return (a.tier ?? 0) - (b.tier ?? 0);
}

// True when a solution turns one of these faces (a wide turn counts for its face; rotations don't)
export function turnsFaces(moves: string, faces: string[]): boolean {
  return faces.length > 0 && moves.split(" ").some((move) => faces.includes(move[0]));
}

// How moves as the hands make them hold the cube: the rotations they start with (the grip rotation, written short)
export function holdOf(text: string): string {
  return /^((?:[xyz]\S* ?)*)/.exec(text)![1].trim();
}

// What finding pieces costs an answer of a combo before and after it (see makeScorer): its own pieces before its first turn (the same for each of its
// answers; on a solve's first step, planned in inspection, only what it plans beyond its smallest alternative) and the next step's piece groups, named in
// the combo's grip, which are found after its last turn
export function comboLook(scramble: string, pieces: string, options: ScoringOptions, combo: Combo): { own: number; groups: Goal[] } {
  // Pieces done before, named in this combo's grip, and the ones it adds, found on the cube as held before its rotation
  const before = rotateGoal(options.earlier ?? options.keep ?? {}, combo.rotation);
  const adds = newPieces(combo.goal, before);
  // A solve's first step pays for planning an XCross's pair in inspection (nothing for a cross); a later step for finding its pieces, on the cube as
  // the hands hold it (a grip rotation made as one with the rotations before it: see lookedFrom)
  const looked = lookedFrom(options.done ?? "", combo.rotation);
  const own = !options.done?.trim()
    ? inspectionLook(heldPattern(scramble, options.done ?? ""), pieces, combo.alternative, combo.rotation)
    : !pieceCount(adds)
      ? 0
      : lookCost(hiddenShare(heldPattern(scramble, looked.done), rotateGoal(adds, invertMoves(looked.rotation))));
  return { own, groups: options.next ? nextGroups(options.next, mergeGoals(before, combo.goal)) : [] };
}

// Where moves as the hands make them cancel into the moves made before the step (options.previous): what's left of them, and what those moves no longer
// turn (null: nothing cancels)
export function cancelCut(options: ScoringOptions): (text: string) => { rest: string; saving: number } | null {
  const previous = options.previous ?? "";
  const joinPrevious = previous ? cancelsInto(previous) : null;
  return (text) => {
    const joined = joinPrevious && joinPrevious(text);
    return joined && { rest: joined.rest, saving: cancelSaving(previous, joined.kept, undefined, options.previousStarts) };
  };
}

// With faces to avoid, every answer's tier (see StepResult.tier). By moves: none of the faces is 0, turning some where no answer held the same way
// does without is 1, turning some although one held the same way doesn't is 2. By speed only that last kind comes later (tier 1): a rotation's cost is
// in the score, so an answer on other faces after a rotation, one without a rotation and one that has to turn the faces are ranked together.
// `holds` = the holds in which some answer is clean, given by a caller that knows of answers left out of `entries`
export function setTiers(entries: Listed[], avoid: string[], bySpeed: boolean, ending: (candidate: Answer) => string, holds?: Set<string>): void {
  if (!avoid.length) return;
  // An answer as the hands make it (its wide writing when it has one), its grip rotation first (with a rotation the writing starts with, the short way)
  const handsText = (entry: Listed) => shortRotations(joinMoves(entry.wide?.start ?? entry.answer.combo.rotation, entry.wide ? entry.wide.wide : joinMoves(entry.answer.moves, ending(entry.answer))));
  // Whether an answer turns a face to avoid (or is strained), and the rotations it starts with (how the cube is held for it)
  // An answer that turns L against an open R layer (or the reverse) is no clean answer either: it only wins where the ranking says so
  const dirty = (entry: Listed) => (entry.avoided ??= turnsFaces(handsText(entry), avoid) || strained(handsText(entry)));
  const cleanHolds = holds ?? new Set(entries.filter((entry) => !dirty(entry)).map((entry) => holdOf(handsText(entry))));
  for (const entry of entries) {
    const beaten = dirty(entry) && cleanHolds.has(holdOf(handsText(entry)));
    entry.tier = bySpeed ? (beaten ? 1 : 0) : dirty(entry) ? (beaten ? 2 : 1) : 0;
  }
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

// The fastest answers sure of a place so far, by size (see makeScorer), as a scoring hands them to its helpers
export type Sures = [number, { key: string; speed: number }[]][];

// A step's scoring by speed: `add` scores each listed answer in turn (the step's own shortest first: it sets the bar), `rank` gives them fastest first,
// `sures` the answers sure of a place so far (which set the bars), `resume` goes on from another scoring's (a helper, from its scoring worker's), and
// `limit` the bar an answer of some combos has to come in under so far to make the first `places` of its size (all of them by default), with the grips a
// clean answer was given in (a list's speed bound, see bound.ts)
export interface Scorer {
  add(raw: Listed): void;
  rank(): Listed[];
  sures(): Sures;
  resume(sures: Sures): void;
  limit(combos: Combo[], places?: number): Limit;
}

// Looks and writings worked out ahead: an answer's look by its combo and moves, a writing by its grip rotation and plain moves, with the limit it was
// searched under and the bounds of that search (see WritingSearch: another limit gives the very same writing when it would search the same way)
export interface Ahead {
  looks: Map<string, number>;
  writings: Map<string, WritingSearch & { limit: number }>;
}

// Whether a search under one limit gives the very same answer under another (see WritingSearch): the same limit, or one that goes on from every place it
// went on from and gives up on every place it gave up on (with the very same comparisons as the search)
function searchesAlike(searched: WritingSearch & { limit: number }, limit: number): boolean {
  if (searched.limit === limit) return true;
  const goesOn = limit === Infinity || searched.kept <= limit + 1e-6;
  const givesUp = searched.pruned === Infinity || (limit < Infinity && searched.pruned > limit + 1e-6);
  return goesOn && givesUp;
}

// What a scoring shares with its helpers (see worker/scoring-worker.ts): each combo's place in the step's list (for the keys of Ahead), the looks and
// writings a helper worked out ahead (the scoring worker reads them: they're the very numbers it would work out, so the solves stay the same), where a
// helper writes its own, and whether this is a helper (it resumes from the scoring worker's sure answers for each chunk, so it works out what the worker
// will ask for, and ranks nothing)
export interface Sharing {
  idOf: (combo: Combo) => number;
  ahead?: Ahead;
  record?: Ahead;
  helper?: boolean;
}

// The scoring of one step's answers (scramble, pieces and options as the step was given them, `places` as it shares them out, `share` what it shares
// with helpers, if any)
export function makeScorer(scramble: string, pieces: string, options: ScoringOptions, places: Places, share?: Sharing): Scorer {
  const { most, apart, bySize } = places;
  // Faces the answer avoids when it can (none = nothing to avoid), and what an answer ends with (see endingOf)
  const avoid = options.avoid ?? [];
  const ending = endingOf(options);
  // An answer's speed cost, its grip rotation included, which is free when nothing was turned before the step
  const fresh = !options.done?.trim();
  // Axes the answer may make wide turns, slice turns and rotations about (slices and rotations follow the wide axes when left out, as before they were apart)
  const wideAxes = options.wideAxes ?? [];
  const sliceAxes = options.sliceAxes ?? wideAxes;
  const rotationAxes = options.rotationAxes ?? wideAxes;
  // A single wide turn needs a rotation about its own axis to make up for it
  const madeUp = wideAxes.filter((axis) => rotationAxes.includes(axis));
  // Whether some writing with wide or slice turns that cancel out (or that start with the cube held another way) may be tried, and the axes they turn about
  const writes = wideAxes.length > 0 || sliceAxes.length > 0;
  const writtenAxes = [...new Set([...wideAxes, ...sliceAxes])];
  // The answers scored so far, and the holds in which some answer is clean (scored or not: it decides the tiers)
  const scored: Listed[] = [];
  const cleanHolds = new Set<string>();
  // An answer's key among the scored ones: how it leaves the cube (worked out when first needed), and for a wide form which one it is
  const keyOf = (entry: Listed) => (entry.form ?? "") + (entry.key ||= leaves(entry.answer));
  // The fastest answers so far that are sure of a place whatever comes later (clean ones, one per key), fastest first. Once there are `most`, the
  // slowest of them is the bar: an answer whose floor (see speedFloor) is above it can't make the list, so it isn't scored at all. With extra
  // moves most answers are long ones that a good short one rules out this way. Sizes ranked apart (see bySize) each have their own, and so does each
  // alternative with places of its own (then its bar is its own places' slowest)
  const sures = new Map<number, { key: string; speed: number }[]>();
  const bars = new Map<number, number>();
  const sizeOf = (answer: Answer): number => (apart ? answer.combo.alternative : bySize ? answer.combo.fresh : 0);
  const room = apart || most;
  const barOf = (answer: Answer): number => bars.get(sizeOf(answer)) ?? Infinity;
  const keep = (entry: Listed, clean: boolean): void => {
    // A helper ranks nothing: it only keeps its bars as the scoring worker will
    if (!share?.helper) scored.push(entry);
    if (!clean || entry.speed >= barOf(entry.answer)) return;
    const key = keyOf(entry);
    const sure = sures.get(sizeOf(entry.answer)) ?? [];
    sures.set(sizeOf(entry.answer), sure);
    const same = sure.findIndex((item) => item.key === key);
    if (same >= 0 && sure[same].speed <= entry.speed) return;
    if (same >= 0) sure.splice(same, 1);
    sure.push({ key, speed: entry.speed });
    sure.sort((a, b) => a.speed - b.speed);
    sure.length = Math.min(sure.length, room);
    if (sure.length === room) bars.set(sizeOf(entry.answer), sure[room - 1].speed);
  };
  // What finding pieces adds to an answer's score (see speed/look.ts): its own pieces before its first turn (the same for every answer of its combo; on
  // a solve's first step, planned in inspection, only what it plans beyond its smallest alternative) and the next step's after its last turn, on the cube
  // as it leaves it. Nothing without `look`, and nothing for steps that keep every other piece untouched (BLD: nobody looks at the cube)
  const looking = Boolean(options.look) && !options.untouched && !options.buffer;
  // What a writing with wide or slice turns adds (one turn made wide with a rotation to make up for it, or wide and slice turns that undo each other):
  // the centers move in the middle of the answer, and the next step's pieces the solver was tracking are somewhere else (see LOOK.flip; nothing
  // without a next step to look for)
  const flip = looking && options.next ? LOOK.flip : 0;
  const comboLooks = new Map<Combo, { own: number; groups: Goal[] }>();
  // An answer's look: worked out ahead by a helper, or here (then noted for the scoring worker, in a helper)
  const lookOf = (held: Answer): number => {
    if (!looking) return 0;
    const key = share && `${share.idOf(held.combo)}\n${held.moves}`;
    const ahead = key === undefined ? undefined : share!.ahead?.looks.get(key);
    if (ahead !== undefined) return ahead;
    const look = lookHere(held);
    if (key !== undefined) share!.record?.looks.set(key, look);
    return look;
  };
  const lookHere = (held: Answer): number => {
    const { combo } = held;
    const known = knownLook(combo);
    return known.own + (known.groups.length ? nextLook(combo.held.applyAlg(joinMoves(held.moves, ending(held))), known.groups) : 0);
  };
  // A combo's own look (the same for each of its answers) and the next step's piece groups, worked out once
  const knownLook = (combo: Combo): { own: number; groups: Goal[] } => {
    let known = comboLooks.get(combo);
    if (!known) comboLooks.set(combo, (known = comboLook(scramble, pieces, options, combo)));
    return known;
  };
  // An answer's cheapest writing with wide and slice turns that costs `limit` or less, after its grip rotation or with the cube held another way at its
  // start, and with `ends` the cheapest ending held each of those ways (see writingSearch): worked out ahead by a helper under a limit that searches the
  // same way, or here (then noted for the scoring worker, in a helper)
  const writingOf = (plain: string, rotation: string, limit: number, ends: string[] = []): WritingSearch => {
    const key = share && `${rotation}\n${plain}${ends.length ? `\n${ends.join(",")}` : ""}`;
    const ahead = key === undefined ? undefined : share!.ahead?.writings.get(key);
    if (ahead && searchesAlike(ahead, limit)) return ahead;
    const searched = writingSearch(plain, { wide: wideAxes, slice: sliceAxes }, undefined, fresh, rotation, limit, true, ends);
    if (key !== undefined) share!.record?.writings.set(key, { ...searched, limit });
    return searched;
  };
  // Whether moves as the hands make them are clean (none of the faces to avoid, no turn against an open layer); a clean one's hold is noted
  const noteClean = (text: string): boolean => {
    const clean = !avoid.length || (!turnsFaces(text, avoid) && !strained(text));
    if (clean && avoid.length) cleanHolds.add(holdOf(text));
    return clean;
  };
  // Where moves cancel into the ones made before the step (none on a solve's first step): what's left of them, and what those moves no longer turn
  const cut = cancelCut(options);
  // Moves as the hands make them, with what finding pieces adds (`look`), scored unless their floor is above the bar of the answer's size (a tie with
  // the bar is still scored: the order of the answers decides it); where they cancel into the moves before the step, what's left of them less the saving.
  // On a method's last step the rotations after the last turn aren't made (the solve is over), so they cost nothing
  const score = (text: string, answer: Answer, look: number): { speed: number; clean: boolean } | null => {
    const clean = noteClean(text);
    const made = options.last ? withoutEndRotations(text) : text;
    const joined = cut(made);
    const own = joined ? joined.rest : made;
    const saving = joined ? joined.saving : 0;
    return speedFloor(own, undefined, fresh) - saving + look > barOf(answer) + 1e-6 ? null : { speed: speedCost(own, undefined, fresh) - saving + look, clean };
  };
  // One listed answer in every way the hands can make it: as held and in every twin grip of its combo (the grips that ask for the same thing: the same
  // moves, renamed), each in the fastest order of its moves (turns about one axis in a row; the listed order on a tie). With wide axes also with one
  // turn made as the opposite wide turn (R as Lw…) and a rotation at the start or the end to make up for it, as answers of their own, and in its
  // cheapest writing with wide and slice turns that cancel out (r … r', M, f … f') or with the cube tilted for it (after a solve's first step, which
  // picks how the cube is held for free), which take the plain writing's place when they're faster
  const add = (raw: Listed): void => {
    const { combo, moves } = raw.answer;
    const twins = (combo.twins ?? []).flatMap((twin): Answer[] => {
      const renamed = movesInGrip(moves, combo.rotation, twin.rotation);
      return renamed === null ? [] : [{ combo: twin, moves: renamed }];
    });
    const helds = [raw.answer, ...twins];
    // Finding pieces costs the same in every writing (they all leave the cube alike)
    const looks = helds.map(lookOf);
    // On a solve's first step every start is free, so twins that make the very same turns share one writing search, each writing ending held as its
    // own grip names it (see writingSearch's ends), under the highest of their bars: their writings by those turns (as the cube names its faces), then
    // by grip rotation
    const shared = new Map<string, Map<string, Writing | null>>();
    const sharedWriting = (index: number, plain: string, rotation: string): Writing | null => {
      const turns = turnsBefore(plain, rotation);
      let writings = shared.get(turns);
      if (!writings) {
        // The other twins' grips as frames of this one's
        const held = frameAfter(undoRotations(rotation));
        const others = helds.filter((_, at) => at !== index).map((twin) => twin.combo.rotation);
        const limit = Math.max(...helds.map((twin, at) => barOf(twin) - looks[at] - flip));
        const searched = writingOf(plain, rotation, limit, others.map((other) => frameAfter(other, held)));
        writings = new Map([[rotation, searched.found], ...others.map((other, at): [string, Writing | null] => [other, searched.ends?.[at] ?? null])]);
        shared.set(turns, writings);
      }
      return writings.get(rotation) ?? null;
    };
    helds.forEach((held, index) => {
      const base: Listed = index ? { answer: held, length: raw.length, order: raw.order, key: "", speed: Infinity } : raw;
      const { rotation } = held.combo;
      const tail = ending(held);
      const look = looks[index];
      let own: (Listed & { clean: boolean }) | null = null;
      for (const order of moveOrders(held.moves)) {
        const result = score(joinMoves(rotation, order, tail), held, look);
        if (result && (!own || result.speed < own.speed)) own = { ...base, answer: { combo: held.combo, moves: order }, ...result };
      }
      if (writes || rotationAxes.length) {
        // The other writings start from the fastest order (the listed one when no order was worth scoring)
        const from: Listed = own ?? base;
        const all = joinMoves(from.answer.moves, tail).split(" ").filter(Boolean);
        const plain = all.join(" ");
        // One turn made as the opposite wide turn, with a rotation about its axis to make up for it (made first, it's one grip with the grip rotation:
        // z y then z is x y2)
        wideForms(all, rotation, madeUp).forEach((wide, place) => {
          const result = score(shortRotations(joinMoves(rotation, wide.wide)), held, look + flip);
          if (result) keep({ ...from, form: `wide${place}/`, speed: result.speed, wide }, result.clean);
        });
        // Only worth writing out when no writing at all would be under the bar, nor beat the plain writing, which it has to beat to take its place (the
        // writing's own cost is the lower of the two less what finding pieces and the flip add, plus what the plain writing saves by cancelling into the
        // moves before the step: another writing may save as much). The plain writing itself was scored above, so leaving it out here loses nothing
        const bar = Math.min(barOf(held), own?.speed ?? Infinity) - look - flip + Math.max(0, cut(joinMoves(rotation, plain))?.saving ?? 0);
        const writable = writes && writingFloor(plain, undefined, fresh, rotation, true, writtenAxes) <= bar + 1e-6;
        const found = !writable ? null : fresh && helds.length > 1 ? sharedWriting(index, plain, rotation) : writingOf(plain, rotation, bar).found;
        // As the hands make it: the grip rotation (or the rotations a writing that starts held another way makes instead), then the writing
        const hands = found ? joinMoves(found.start ?? rotation, found.text) : "";
        // Its cost after the moves before the step, as the other writings are scored
        const joined = found && cut(hands);
        const written = found && { ...found, cost: joined ? speedCost(joined.rest, undefined, fresh) - joined.saving : found.cost };
        // A writing with wide or slice turns pays for the flip; the plain one (given when nothing beats it) doesn't
        const writtenLook = written && (written.text !== plain || written.start !== undefined) ? look + flip : look;
        if (written && (!own || written.cost + writtenLook < own.speed))
          own = { ...from, speed: written.cost + writtenLook, wide: { wide: written.text, plain, ...(written.start === undefined ? {} : { start: written.start }) }, clean: noteClean(hands) };
        // The cube tilted for the answer and tilted back (x rotations only)
        for (const tilt of rotationAxes.includes("x") && !fresh ? tiltForms(all, rotation) : []) {
          const result = score(shortRotations(joinMoves(rotation, tilt.wide)), held, look);
          if (result && (!own || result.speed < own.speed)) own = { ...from, wide: tilt, ...result };
        }
      }
      if (own) keep(own, own.clean);
    });
  };
  // Fastest first (ties as above), keeping the first of the answers that leave the cube the same way, until there are enough (sizes ranked apart:
  // all of them, for shareOut)
  const rank = (): Listed[] => {
    const kept = new Set<string>();
    const ranked: Listed[] = [];
    setTiers(scored, avoid, true, ending, cleanHolds);
    for (const entry of scored.sort((a, b) => byTier(a, b) || a.speed - b.speed || byMoves(a, b))) {
      const key = keyOf(entry);
      if (kept.has(key)) continue;
      kept.add(key);
      ranked.push(entry);
      if (!bySize && !apart && ranked.length === most) break;
    }
    return ranked;
  };
  // The sure answers as a copy, and a scoring going on from such a copy (its bars as they follow from it)
  const copy = (snapshot: Sures): Sures => snapshot.map(([size, list]) => [size, list.map((item) => ({ ...item }))]);
  const resume = (snapshot: Sures): void => {
    sures.clear();
    bars.clear();
    for (const [size, list] of copy(snapshot)) {
      sures.set(size, list);
      if (list.length === room) bars.set(size, list[room - 1].speed);
    }
  };
  // The highest of the combos' bars for their first `places` (an answer listed for one is scored held as each: the slowest of that many sure answers of
  // its size, so with all the places, its bar), every grip some clean answer was given in, and the least any answer of them pays for finding pieces
  // (its combo's own look, and the next step's at its least: its pieces in plain sight)
  const leastLook = (combo: Combo) => knownLook(combo).own + (knownLook(combo).groups.length ? lookCost(0) : 0);
  const limit = (combos: Combo[], places = room): Limit => {
    const first = Math.min(places, room);
    const barIn = (combo: Combo) => {
      const sure = sures.get(sizeOf({ combo, moves: "" })) ?? [];
      return sure.length >= first ? sure[first - 1].speed : Infinity;
    };
    return { bar: Math.max(...combos.map(barIn)), clean: [...cleanHolds], look: looking ? Math.min(...combos.map(leastLook)) : 0 };
  };
  return { add, rank, sures: () => copy([...sures]), resume, limit };
}
