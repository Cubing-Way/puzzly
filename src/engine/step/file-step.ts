// Steps answered from an answer file (see answer-file.ts): a step asked with the options a file was made for, on a cube whose every combo is one of the
// file's cases, takes the file's answers instead of searching. They're ranked as the step's scoring ranks listed answers (see makeScorer), with what
// depends on the rest of the cube worked out at the time: finding pieces before and after the answer, cancels into the moves before, which grips have a
// clean answer over every free slot (the faces to avoid), ties in the order the search lists answers. Only the answers that could still make the
// step's list are scored, the others are left out by a lower bound from the file's costs, and those that are get the very costs and writings the
// step's own scoring gives them. A step one of whose combos is at its goal already is done with no moves, also without a search. A cut file (a
// few MB, for a page) holds only some answers per case and says what the rest leave: a step it answers must be one none of those could have changed,
// else it's searched

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Cube patterns and the cube definition's type
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
// Patterns as numbers per spot
import { cellsKey, cellsOf } from "../core/cells";
// Move text helpers
import { FACE_MOVES, joinMoves, shortRotations, withoutEndRotations } from "../core/moves";
// Loaded cube definition, and the rotation a move sequence makes
import { kpuzzle, netRotation } from "../core/puzzle";
// Moves as other grips see them
import { movesInGrip } from "../core/turns";
// Goal text
import { goalToText } from "../goal/goal";
// Speed costs, floors and writings
import { speedCost, speedFloor, writingFloor, writingSearch, strained, type Writing } from "../speed/fingering";
// What finding a step's pieces costs
import { LOOK, lookCost, nextLook } from "../speed/look";
// Engine data shapes
import type { StepOptions, StepResult } from "../types";
// Answer files and their cases
import { readAnswerFile, caseAnswers, tokensText, FLAG_WRITING, FLAG_CLEAN, FLAG_ANY_CLEAN, FLAG_WRITING_CLEAN, type AnswerFile, type AnswerFileCase, type CaseAnswers } from "./answer-file";
// One alternative × grip of a step
import type { Combo } from "./combo";
// What a step's scoring shares with this: looks per combo, cancels, holds, move orders, the faces to avoid
import { cancelCut, comboLook, holdOf, moveOrders, scoringOptions, turnsFaces } from "./scoring";
// A step's combos before the worker measures them
import { plannedCombos } from "./step-combos";
// A step's result for one answer
import { stepResult } from "./step";

// The answer files loaded so far
const files: AnswerFile[] = [];

// Steps a cut file couldn't answer so far, by why (see fileCandidates' end), for the bench: its list wasn't full, something left out could come before
// its last answer (by cost, sure to turn a face to avoid, by a cancel), under a bar a grip's writing was checked with, or be a clean writing a grip is
// clean by
export const cutMisses: Record<string, number> = {};
const miss = (why: string): null => {
  cutMisses[why] = (cutMisses[why] ?? 0) + 1;
  return null;
};

// Load an answer file (its bytes, as bench/answer-file.ts writes them, or a file read already, see readAnswerFile): steps asked with the options it was
// made for are answered from it from now on
export function loadAnswerFile(data: Uint8Array | ArrayBuffer | AnswerFile): void {
  files.push(data instanceof Uint8Array || data instanceof ArrayBuffer ? readAnswerFile(data) : data);
}

// Forget every answer file loaded (steps are searched again)
export function clearAnswerFiles(): void {
  files.length = 0;
}

// A combo's case as an answer file knows it: its goal and its held cube with the goal's hidden pieces masked, which is all its search sees
export function caseKey(combo: Pick<Combo, "goal" | "start">): string {
  return `${goalToText(combo.goal)}\n${cellsKey(cellsOf(combo.start))}`;
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((item, at) => item === b[at]);

// The file made for a step's pieces and options, if one is loaded: the same goal, moves, grips, offsets, faces to avoid and hand-turn axes, and no more
// extra moves than it has. It holds every answer its step listed going on past the cap, so it stands for a step that goes on past the cap or not.
// Never for a solve's first step (its grip rotation is free), a method's last one (no rotations after its last turn), BLD steps, steps that undo their
// offset or stop at the first grip, places per alternative (a beam search), or a file whose answers may rotate the cube in their middle
function fileFor(pieces: string, options: StepOptions & { perAlternative?: number }): AnswerFile | undefined {
  if (options.rank !== "speed" || options.untouched || options.buffer || options.firstFound || options.undoOffset || options.last || options.algs || options.perAlternative) return undefined;
  if (Number.isFinite(options.maxDepth ?? Infinity) || !options.done?.trim()) return undefined;
  const wideAxes = options.wideAxes ?? [];
  const asked = {
    generatorMoves: options.generatorMoves ?? FACE_MOVES,
    rotations: options.rotations ?? [""],
    offsets: options.offsets?.length ? options.offsets : [""],
    solvableWith: options.solvableWith ?? [],
    avoid: options.avoid ?? [],
    wideAxes,
    sliceAxes: options.sliceAxes ?? wideAxes,
    rotationAxes: options.rotationAxes ?? wideAxes,
  };
  const names = Object.keys(asked) as (keyof typeof asked)[];
  // Of the files that fit, the one made with the fewest extra moves: it was listed the way the step lists (a list going a move further runs out of
  // its cap or budget elsewhere)
  const fits = files.filter(({ header }) => header.pieces === pieces && (options.extraMoves ?? 0) <= header.options.extraMoves && !header.options.rotationAxes.length && names.every((name) => sameList(asked[name], header.options[name])));
  return fits.reduce<AnswerFile | undefined>((best, file) => (!best || file.header.options.extraMoves < best.header.options.extraMoves ? file : best), undefined);
}

// Each move's turn of the pieces, per orbit, from the cube definition (made again for another definition)
let turnsFor: KPuzzle | null = null;
const turnData = new Map<string, Record<string, { permutation: number[]; orientationDelta: number[] }>>();
function turnOf(move: string): Record<string, { permutation: number[]; orientationDelta: number[] }> {
  if (turnsFor !== kpuzzle) {
    turnData.clear();
    turnsFor = kpuzzle;
  }
  let data = turnData.get(move);
  if (!data) turnData.set(move, (data = kpuzzle.moveToTransformation(move).transformationData));
  return data;
}

// A held cube after some moves, turned on its piece arrays (quicker than the pattern's own applyAlg, which parses the moves)
type CubeData = Record<string, { pieces: number[]; orientation: number[] }>;
function cubeAfter(held: KPattern, moves: string): CubeData {
  let data: CubeData = held.patternData;
  for (const move of moves.split(" ")) {
    if (!move) continue;
    const turn = turnOf(move);
    const next: CubeData = {};
    for (const { orbitName, numOrientations } of kpuzzle.definition.orbits) {
      const { permutation, orientationDelta } = turn[orbitName];
      const { pieces, orientation } = data[orbitName];
      next[orbitName] = { pieces: permutation.map((from) => pieces[from]), orientation: permutation.map((from, at) => (orientation[from] + orientationDelta[at]) % numOrientations) };
    }
    data = next;
  }
  return data;
}

// The axis each layer turns about (a run of turns about one axis may be made in any order, see moveOrders)
const AXIS_OF: Record<string, string> = { R: "x", L: "x", M: "x", U: "y", D: "y", E: "y", F: "z", B: "z", S: "z" };

// What a lower bound from the file's costs leaves room for: they're kept to hundredths
const SLACK = 0.01;

// Whether the hands make what comes after some moves from home: there are none, or they end with a rotation about y or z (both hands let go; an x may be
// a tilt, see fingering.ts)
const fromHome = (moves: string): boolean => !moves || /(^|\s)[yz][2']?$/.test(moves);

// An answer scored as the step scores it: as which combo (one of a case's twin grips) and in what order of its face turns, its length, its combo's place
// in the step's queue (-1: the step's shortest answer, which the step scores first) and that combo's grip, which twin it is, how many new pieces it adds,
// its score, whether it's clean as the hands make it and its tier (once the clean grips are known), its writing when that's how the hands make it;
// worked out once it could make the list, how it leaves the cube and where the search lists it; `rewrite` when it's written as the file writes it held
// another way: the bar its writing is searched under and what finding pieces adds to it
interface Ranked {
  combo: Combo;
  moves: string;
  length: number;
  order: number;
  listedIn: string;
  twin: number;
  fresh: number;
  speed: number;
  clean: boolean;
  tier: number | undefined;
  wide?: { wide: string; plain: string; start?: string };
  rewrite?: { bar: number; look: number };
  searched?: { plain: number; less: number };
  key?: string;
  listed?: string;
}

// One of the step's combos with its case: its twin grips (itself first), each of the file's holds as one of them (-1: none), what finding pieces costs
// in each (its own look and the next step's piece groups, and the least that comes to), what each hold's rotation costs more than in the file, and
// which tokens cancel into the moves before as the first turn held each way (-1: not known yet)
interface Item {
  combo: Combo;
  entry: AnswerFileCase;
  answers: CaseAnswers;
  helds: Combo[];
  twinOf: number[];
  looks: { own: number; groups: ReturnType<typeof comboLook>["groups"]; least: number }[];
  shift: number[];
  joins: Int8Array[];
}

// A step that's done with no moves (one of its combos is at its goal already: `combo`), as stepCandidates gives it: its shortest answer is empty, so
// nothing else is listed, and the empty answer is scored held as its combo and each twin (the grip rotation alone, finding pieces, a cancel into the
// moves before), fastest first
function emptyAnswers(scramble: string, pieces: string, options: StepOptions, combo: Combo, most: number): StepResult[] {
  const scoring = scoringOptions(options);
  const avoid = options.avoid ?? [];
  const cut = cancelCut(scoring);
  const scored = [combo, ...(combo.twins ?? [])].map((held, twin) => {
    const known = options.look ? comboLook(scramble, pieces, scoring, held) : { own: 0, groups: [] };
    const look = options.look ? known.own + (known.groups.length ? nextLook(held.held, known.groups) : 0) : 0;
    const joined = cut(held.rotation);
    const speed = speedCost(joined ? joined.rest : held.rotation, undefined, false) - (joined ? joined.saving : 0) + look;
    const tier = avoid.length ? (!turnsFaces(held.rotation, avoid) && !strained(held.rotation) ? 0 : 1) : undefined;
    return { held, twin, speed, tier };
  });
  scored.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.speed - b.speed || a.twin - b.twin);
  return scored.slice(0, most).map(({ held, speed, tier }) => ({ ...stepResult({ combo: held, moves: "" }, 0, options.solvableWith), ...(tier === undefined ? {} : { tier }), speed }));
}

// A step's answers from an answer file, best first, as stepCandidates would give them (`most` of them), or null when no loaded file stands for the step
// or the cube isn't one of its cases (the step is searched then)
export function fileCandidates(scramble: string, pieces: string, options: StepOptions & { perAlternative?: number }, most: number): StepResult[] | null {
  const file = fileFor(pieces, options);
  if (!file) return null;
  let candidates: Combo[];
  try {
    ({ candidates } = plannedCombos(scramble, pieces, options));
  } catch {
    return null;
  }
  if (!candidates.length || new Set(candidates.map((combo) => combo.fresh)).size > 1) return null;
  const scoring = scoringOptions(options);
  const avoid = options.avoid ?? [];
  const looking = Boolean(options.look);
  // A writing with wide or slice turns pays for the flip when a step comes after it (see makeScorer)
  const flip = looking && options.next ? LOOK.flip : 0;
  const cut = cancelCut(scoring);
  // A combo already at its goal (a free slot an earlier step happened to fill): the step's shortest answer is empty, so it lists nothing else
  const done = candidates.find((combo) => combo.targets.some((target) => target.isIdentical(combo.start)));
  if (done) return emptyAnswers(scramble, pieces, options, done, most);
  const entries = candidates.map((combo) => file.cases.get(caseKey(combo)));
  if (entries.some((entry) => !entry)) return null;
  const { holds, tokens } = file.header;
  const previous = Boolean(options.previous);
  const wideAxes = options.wideAxes ?? [];
  const sliceAxes = options.sliceAxes ?? wideAxes;
  const writtenAxes = [...new Set([...wideAxes, ...sliceAxes])];
  const writes = writtenAxes.length > 0;
  const rotationCost = (rotation: string): number => (rotation ? speedCost(rotation) : 0);
  // The combos in the order the worker's measures would put them (closest first, then the one adding more new pieces; the sort keeps the order above)
  const items: Item[] = candidates
    .map((combo, at) => ({ combo, entry: entries[at]! }))
    .sort((a, b) => a.entry.bound - b.entry.bound || b.combo.fresh - a.combo.fresh)
    .map(({ combo, entry }) => {
      const helds = [combo, ...(combo.twins ?? [])];
      const grips = helds.map((held) => netRotation(held.rotation));
      const twinOf = holds.map((hold) => grips.indexOf(netRotation(joinMoves(combo.rotation, hold))));
      const looks = helds.map((held) => {
        const known = looking ? comboLook(scramble, pieces, scoring, held) : { own: 0, groups: [] };
        return { ...known, least: known.own + (known.groups.length ? lookCost(0) : 0) };
      });
      const shift = holds.map((hold, at) => (twinOf[at] < 0 ? 0 : rotationCost(helds[twinOf[at]].rotation) - rotationCost(hold)));
      return { combo, entry, answers: caseAnswers(file, entry), helds, twinOf, looks, shift, joins: helds.map(() => new Int8Array(tokens.length).fill(-1)) };
    });
  // The step's shortest answer (the first combo in the queue that has one that short) and the longest it compares
  const shortest = Math.min(...items.map(({ entry }) => entry.shortest));
  const longest = shortest + Math.max(0, options.extraMoves ?? 0);
  const firstItem = items.findIndex(({ entry }) => entry.shortest === shortest);
  // The step scores its shortest answer first, in each twin grip: those of the file's answers come before every other on a tie
  const firsts = new Set<number>();
  {
    const { answers, combo, entry, helds, twinOf } = items[firstItem];
    const renamed = helds.map((held) => movesInGrip(entry.first, combo.rotation, held.rotation));
    for (let index = 0; index < answers.count; index++) {
      const twin = twinOf[answers.hold[index]];
      if (answers.turns[index] !== shortest || twin < 0 || renamed[twin] === null) continue;
      if (moveOrders(tokensText(file, answers.movesAt[index], answers.turns[index])).includes(renamed[twin]!)) firsts.add(index);
    }
  }
  // Grips some answer is clean in, over every free slot (an answer turning a face to avoid ranks after them, see setTiers): the face turns in some order
  // (the step notes every order it scores), and below, grips whose only clean answers are writings
  const cleanHolds = new Set<string>();
  if (avoid.length) {
    for (const { answers, helds, twinOf } of items) {
      // A cut file says which holds have one, left out or not
      if (answers.dropped) {
        for (const [hold, { anyClean }] of answers.dropped.entries()) if (twinOf[hold] >= 0 && anyClean <= longest) cleanHolds.add(helds[twinOf[hold]].rotation);
        continue;
      }
      for (let index = 0; index < answers.count; index++) {
        const twin = twinOf[answers.hold[index]];
        if (answers.turns[index] <= longest && twin >= 0 && answers.flags[index] & FLAG_ANY_CLEAN) cleanHolds.add(helds[twin].rotation);
      }
    }
  }
  const isClean = (text: string): boolean => !avoid.length || (!turnsFaces(text, avoid) && !strained(text));
  // Whether a token held as a twin is made as one with the moves before the step when it's an answer's first turn
  const joins = (item: Item, twin: number, token: number): boolean => {
    if (item.joins[twin][token] < 0) item.joins[twin][token] = cut(joinMoves(item.helds[twin].rotation, tokens[token])) ? 1 : 0;
    return item.joins[twin][token] === 1;
  };
  // Whether an answer may cancel into the moves before the step: one of the turns it may start with (any of a first run about one axis, or its
  // writing's first) is made as one with them
  const mayCancel = (item: Item, twin: number, index: number): boolean => {
    if (!previous) return false;
    const { answers } = item;
    const at = answers.movesAt[index];
    const axis = AXIS_OF[tokens[file.bytes[at]][0].toUpperCase()];
    for (let place = 0; place < answers.turns[index] && (place === 0 || AXIS_OF[tokens[file.bytes[at + place]][0].toUpperCase()] === axis); place++) if (joins(item, twin, file.bytes[at + place])) return true;
    return Boolean(answers.flags[index] & FLAG_WRITING) && joins(item, twin, file.bytes[answers.writingAt[index]]);
  };
  // The least an answer that may cancel scores (finding pieces aside): each order of its face turns that starts with a turn that cancels (a run about one
  // axis first: see moveOrders) and its writing when its first turn does, by their floors after the cancel; as the file has them where they don't cancel
  const cancelledFloor = (item: Item, twin: number, index: number): number => {
    const { answers } = item;
    const rotation = item.helds[twin].rotation;
    const at = answers.movesAt[index];
    let least = Infinity;
    const run = answers.turns[index] > 1 && AXIS_OF[tokens[file.bytes[at]][0].toUpperCase()] === AXIS_OF[tokens[file.bytes[at + 1]][0].toUpperCase()];
    const moves = tokensText(file, at, answers.turns[index]);
    for (const order of run ? moveOrders(moves) : joins(item, twin, file.bytes[at]) ? [moves] : []) {
      const joined = cut(joinMoves(rotation, order));
      if (joined) least = Math.min(least, speedFloor(joined.rest, undefined, false) - joined.saving);
    }
    if (answers.flags[index] & FLAG_WRITING && joins(item, twin, file.bytes[answers.writingAt[index]])) {
      const joined = cut(joinMoves(rotation, tokensText(file, answers.writingAt[index], answers.writingTokens[index])));
      if (joined) least = Math.min(least, speedFloor(joined.rest, undefined, false) - joined.saving + flip);
    }
    return least;
  };
  // Every answer the step compares (no longer than its longest), with a lower bound of its score, whether it's sure to turn a face to avoid, and its grip
  let count = 0;
  for (const { answers } of items) count += answers.count;
  const bounds = new Float64Array(count);
  const dirtyAt = new Uint8Array(count);
  const holdAt: string[] = [];
  const itemOf = new Uint16Array(count);
  const indexOf = new Uint32Array(count);
  const cancelling = new Uint8Array(count);
  let listed = 0;
  for (const [place, item] of items.entries()) {
    const { answers, helds, twinOf, looks, shift } = item;
    for (let index = 0; index < answers.count; index++) {
      const hold = answers.hold[index];
      const twin = twinOf[hold];
      if (answers.turns[index] > longest || twin < 0) continue;
      const flags = answers.flags[index];
      let bound = Math.min(answers.plain[index], flags & FLAG_WRITING ? answers.written[index] + flip : Infinity) + shift[hold] - SLACK;
      // Sure to turn a face to avoid (or be strained) in every way it may be made, where some answer held the same way doesn't: the lower tier
      let dirty = avoid.length > 0 && !(flags & FLAG_CLEAN) && (!(flags & FLAG_WRITING) || !(flags & FLAG_WRITING_CLEAN));
      if (mayCancel(item, twin, index)) {
        bound = Math.min(bound, cancelledFloor(item, twin, index) - 1e-9);
        // Another order of its turns may be made then
        dirty = false;
        cancelling[listed] = 1;
      }
      bounds[listed] = bound + looks[twin].least;
      dirtyAt[listed] = dirty ? 1 : 0;
      holdAt[listed] = helds[twin].rotation;
      itemOf[listed] = place;
      indexOf[listed] = index;
      listed++;
    }
  }
  const SPREAD = 2 ** 20;
  if (listed >= SPREAD) return null;
  // An answer's tier as setTiers gives it: as the hands make it, against the grips some answer is clean in
  const tierOf = (rotation: string, moves: string, wide: Ranked["wide"]): number | undefined => {
    if (!avoid.length) return undefined;
    const hands = shortRotations(joinMoves(wide?.start ?? rotation, wide ? wide.wide : moves));
    return !isClean(hands) && cleanHolds.has(holdOf(hands)) ? 1 : 0;
  };
  // One answer scored as the step scores it, with no bar (see makeScorer's add): its look, the fastest order of its face turns, then its writing when
  // that's faster
  const score = (at: number): Ranked => {
    const item = items[itemOf[at]];
    const index = indexOf[at];
    const { answers, helds, twinOf, looks } = item;
    const twin = twinOf[answers.hold[index]];
    const held = helds[twin];
    const { rotation } = held;
    const moves = tokensText(file, answers.movesAt[index], answers.turns[index]);
    const writing = answers.flags[index] & FLAG_WRITING ? tokensText(file, answers.writingAt[index], answers.writingTokens[index]) : null;
    const look = looking ? looks[twin].own + (looks[twin].groups.length ? nextLook({ patternData: cubeAfter(held.held, moves) }, looks[twin].groups) : 0) : 0;
    // The file's order is the fastest one, unless a cancel into the moves before makes another faster
    const cancels = cancelling[at] === 1;
    let own: { order: string; speed: number; clean: boolean } | null = null;
    for (const order of cancels ? moveOrders(moves) : [moves]) {
      const text = joinMoves(rotation, order);
      const joined = cut(text);
      const speed = speedCost(joined ? joined.rest : text, undefined, false) - (joined ? joined.saving : 0) + look;
      if (!own || speed < own.speed) own = { order, speed, clean: isClean(text) };
    }
    let wide: Ranked["wide"];
    let rewrite: Ranked["rewrite"];
    let searched: Ranked["searched"];
    if (writes && own) {
      const plain = own.order;
      const bar = own.speed - look - flip + Math.max(0, cut(joinMoves(rotation, plain))?.saving ?? 0);
      // The file's writing is the writing search's own for these face turns (nothing beats them when it has none). Held another way it costs the
      // same, but a tie may be written another way, so the answers given are written again as the step writes them (see `rewrite`); a cancel into
      // the moves before may make another order fastest, which is searched as the step searches it
      const filed = plain === moves && !cancels;
      let found: Writing | null = null;
      if (filed) {
        if (writing !== null) {
          const cost = speedCost(joinMoves(rotation, writing), undefined, false);
          if (cost <= bar + 1e-6) found = { text: writing, cost };
        }
      } else if (writingFloor(plain, undefined, false, rotation, true, writtenAxes) <= bar + 1e-6) found = writingSearch(plain, { wide: wideAxes, slice: sliceAxes }, undefined, false, rotation, bar, true).found;
      const hands = found ? joinMoves(found.start ?? rotation, found.text) : "";
      const joined = found && cut(hands);
      const written = found && { ...found, cost: joined ? speedCost(joined.rest, undefined, false) - joined.saving : found.cost };
      const writtenLook = written && (written.text !== plain || written.start !== undefined) ? look + flip : look;
      if (written && written.cost + writtenLook < own.speed) {
        // What the writing search's limit is made of, for a step's bar (see the grips whose only clean answers are writings, below)
        searched = { plain: own.speed, less: bar - own.speed };
        own = { order: plain, speed: written.cost + writtenLook, clean: isClean(hands) };
        wide = { wide: written.text, plain, ...(written.start === undefined ? {} : { start: written.start }) };
        if (filed && rotation !== holds[answers.hold[index]]) rewrite = { bar, look: writtenLook };
      }
    }
    const order = itemOf[at] === firstItem && firsts.has(index) ? -1 : itemOf[at];
    return {
      combo: held,
      moves: own!.order,
      length: answers.turns[index],
      order,
      listedIn: item.combo.rotation,
      twin,
      fresh: item.combo.fresh,
      speed: own!.speed,
      clean: own!.clean,
      tier: undefined,
      ...(wide ? { wide } : {}),
      ...(rewrite ? { rewrite } : {}),
      ...(searched ? { searched } : {}),
    };
  };
  // Each answer scored once
  const scoredAt = new Map<number, Ranked>();
  const exact = (at: number): Ranked => {
    let ranked = scoredAt.get(at);
    if (!ranked) scoredAt.set(at, (ranked = score(at)));
    return ranked;
  };
  // How an answer leaves the cube: of answers leaving it the same way, the first ranked stays (see makeScorer's rank)
  const keyOf = (ranked: Ranked): string => (ranked.key ??= `${ranked.combo.rotation}/${JSON.stringify(cubeAfter(ranked.combo.held, ranked.moves))}`);
  // Where the search lists an answer among its combo's answers of its length (the step scores them in that order, so a tie goes to the one listed
  // first): its turns named in the grip its combo is searched in, each run about one axis in the order the search allows (of two turns that commute,
  // the one of the earlier move first), as each turn's place in the search's turn order (the step's moves in order, each as a quarter, half and
  // counter turn)
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  const listedOf = (ranked: Ranked): string => {
    if (ranked.listed !== undefined) return ranked.listed;
    const raw = (movesInGrip(ranked.moves, ranked.combo.rotation, ranked.listedIn) ?? ranked.moves).split(" ");
    const places = raw.map((turn) => generatorMoves.indexOf(turn[0]) * 3 + ["", "2", "'"].indexOf(turn.slice(1)));
    for (let at = 1; at < raw.length; at++) {
      if (AXIS_OF[raw[at][0]] === AXIS_OF[raw[at - 1][0]] && places[at] < places[at - 1]) [places[at - 1], places[at]] = [places[at], places[at - 1]];
    }
    return (ranked.listed = String.fromCharCode(...places.map((place) => place + 1)));
  };
  // The step's order: lower tiers, then faster, then shorter, then adding more new pieces, then the closest combos, then as the search lists them
  // (raw answers first, each followed by its twins in order)
  const compare = (a: Ranked, b: Ranked): number => {
    const first = (a.tier ?? 0) - (b.tier ?? 0) || a.speed - b.speed || a.length - b.length || b.fresh - a.fresh || a.order - b.order;
    if (first) return first;
    const [x, y] = [listedOf(a), listedOf(b)];
    return x < y ? -1 : x > y ? 1 : a.twin - b.twin;
  };
  // Whether the step scores one answer before another: its shortest answer and its twins first, then one length at a time, each combo in turn, as the
  // search lists them
  const listedBefore = (a: Ranked, b: Ranked): boolean => {
    if ((a.order === -1) !== (b.order === -1)) return a.order === -1;
    const apart = a.length - b.length || a.order - b.order;
    if (apart) return apart < 0;
    const [x, y] = [listedOf(a), listedOf(b)];
    return x < y || (x === y && a.twin < b.twin);
  };
  // For a cut file's check (see below): the grips clean before this, the length of the writing each other grip is clean by, and each writing checked
  // with the bar it was checked under
  const cleanBefore = new Set(cleanHolds);
  const cleanBy = new Map<string, number>();
  const checked: { turns: number; bar: number }[] = [];
  // A grip whose only clean answers are writings is a clean grip only when the step's writing search found one of those writings, under the bar the
  // step had then (see makeScorer's add): the slowest of the `most` fastest clean answers scored before it, each leaving the cube its own way
  // (no bar while there are fewer). The search gives up on a writing by the floors of its turns, so one a little over the bar may still be found:
  // each such writing is searched again under that bar
  if (avoid.length) {
    const writingOnly = new Map<string, number[]>();
    for (let at = 0; at < listed; at++) {
      const flags = items[itemOf[at]].answers.flags[indexOf[at]];
      if (flags & FLAG_WRITING_CLEAN && !cleanHolds.has(holdAt[at])) writingOnly.set(holdAt[at], [...(writingOnly.get(holdAt[at]) ?? []), at]);
    }
    const bySpeed = writingOnly.size ? Array.from({ length: listed }, (_, at) => at).sort((a, b) => bounds[a] - bounds[b]) : [];
    for (const [hold, ats] of writingOnly) {
      const writings = ats.map(exact).filter((ranked) => ranked.wide && ranked.clean);
      writings.sort((a, b) => (listedBefore(a, b) ? -1 : listedBefore(b, a) ? 1 : 0));
      for (const writing of writings) {
        // The fastest clean answers scored before it, one per way of leaving the cube, fastest first by their bounds until no other can come in
        const sure = new Map<string, number>();
        let fastest: number[] = [];
        const slowest = (): number => (fastest.length < most ? Infinity : fastest[most - 1]);
        for (const other of bySpeed) {
          if (bounds[other] > slowest() + 1e-9) break;
          // Sure to turn a face to avoid, or listed after it by its length or combo: no need to score it
          const length = items[itemOf[other]].answers.turns[indexOf[other]];
          const order = itemOf[other] === firstItem && firsts.has(indexOf[other]) ? -1 : itemOf[other];
          if (dirtyAt[other] || (order !== -1 && (writing.order === -1 || length > writing.length || (length === writing.length && order > writing.order)))) continue;
          const ranked = exact(other);
          if (!ranked.clean || ranked.speed >= slowest() || !listedBefore(ranked, writing)) continue;
          const key = keyOf(ranked);
          const had = sure.get(key);
          if (had !== undefined && had <= ranked.speed) continue;
          sure.set(key, ranked.speed);
          // The `most` fastest of them, kept sorted (a faster answer leaving the cube as one of them takes its place)
          if (had !== undefined) fastest = [...sure.values()].sort((a, b) => a - b).slice(0, most);
          else {
            const into = fastest.findIndex((speed) => speed > ranked.speed);
            fastest.splice(into < 0 ? fastest.length : into, 0, ranked.speed);
            fastest.length = Math.min(fastest.length, most);
          }
        }
        const bar = slowest();
        const { rotation } = writing.combo;
        const plain = writing.wide!.plain;
        const limit = Math.min(bar, writing.searched!.plain) + writing.searched!.less;
        const found = bar === Infinity || (writingFloor(plain, undefined, false, rotation, true, writtenAxes) <= limit + 1e-6 && writingSearch(plain, { wide: wideAxes, slice: sliceAxes }, undefined, false, rotation, limit, true).found !== null);
        checked.push({ turns: writing.length, bar });
        if (found) {
          cleanHolds.add(hold);
          cleanBy.set(hold, writing.length);
          break;
        }
      }
    }
  }
  // Sorted by a lower bound of the tier (sure to turn a face to avoid, in a clean grip) then of the score, both packed with the answer's number into one
  // float (the bound rounded down, so it stays a bound)
  const tierBounds = new Uint8Array(listed);
  for (let at = 0; at < listed; at++) tierBounds[at] = dirtyAt[at] && cleanHolds.has(holdAt[at]) ? 1 : 0;
  const packed = new Float64Array(listed);
  for (let at = 0; at < listed; at++) packed[at] = Math.floor((tierBounds[at] * 4096 + Math.max(-1000, bounds[at]) + 1024) * 1024) * SPREAD + at;
  packed.sort();
  // The best `most` so far, each leaving the cube its own way; scored best first by their bounds until none left can come in
  const best: Ranked[] = [];
  for (let place = 0; place < listed; place++) {
    const at = packed[place] % SPREAD;
    if (best.length >= most) {
      const last = best[most - 1];
      if (tierBounds[at] > (last.tier ?? 0) || (tierBounds[at] === (last.tier ?? 0) && bounds[at] > last.speed + 1e-9)) break;
    }
    const ranked = exact(at);
    ranked.tier = tierOf(ranked.combo.rotation, ranked.moves, ranked.wide);
    // Not in the list, or behind an answer leaving the cube the same way: left out
    if (best.length >= most && compare(ranked, best[most - 1]) >= 0) continue;
    const same = best.findIndex((other) => keyOf(other) === keyOf(ranked));
    if (same >= 0) {
      if (compare(best[same], ranked) <= 0) continue;
      best.splice(same, 1);
    }
    const into = best.findIndex((other) => compare(ranked, other) < 0);
    best.splice(into < 0 ? best.length : into, 0, ranked);
    best.length = Math.min(best.length, most);
  }
  // A cut file left answers out (see DroppedHold in answer-file.ts): each must rank after the last one given by its bound, as if it were listed (so
  // the list must be full), and none may change which grips are clean: be one a grip could be clean by, or come in under the bar a writing was checked
  // with. Otherwise the step is searched
  if (file.header.cut) {
    const last = best.length >= most ? best[most - 1] : null;
    // Each text's cancel into the moves before, worked out once (the same turns come up for many first turns and holds)
    const cuts = new Map<string, ReturnType<typeof cut>>();
    const cutOnce = (text: string) => {
      if (!cuts.has(text)) cuts.set(text, cut(text));
      return cuts.get(text)!;
    };
    const after = (tier: number, bound: number): boolean => !!last && (tier > (last.tier ?? 0) || (tier === (last.tier ?? 0) && bound > last.speed + 1e-9));
    const underBar = (turns: number, bound: number): boolean => checked.some((writing) => turns <= writing.turns && bound <= writing.bar + 1e-9);
    for (const item of items) {
      const { answers, helds, twinOf, looks, shift } = item;
      for (const [hold, dropped] of (answers.dropped ?? []).entries()) {
        const twin = twinOf[hold];
        if (twin < 0 || !dropped.lengths.some(({ turns }) => turns <= longest)) continue;
        if (!last) return miss("short");
        const { rotation } = helds[twin];
        const least = looks[twin].least;
        // Those of each length: those that may be clean, and those sure not to be (in a clean grip they come after every clean one)
        for (const length of dropped.lengths) {
          if (length.turns > longest) continue;
          const bound = Math.min(length.plain, length.written + flip) + shift[hold] - SLACK + least;
          if (!after(0, bound)) return miss("cost");
          if (underBar(length.turns, bound)) return miss("bar");
          if (!after(cleanHolds.has(rotation) ? 1 : 0, Math.min(length.dirtyPlain, length.dirtyWritten + flip) + shift[hold] - SLACK + least)) return miss("dirty");
        }
        // Those whose first turn may cancel into the moves before: the floor of what's left of those moves and the turn, less what they no longer
        // turn, then the least the rest of the answer costs after any moves (see leastCostAfter), or its own cost where the hands start it from home
        // (what's left is nothing, or ends with a rotation about y or z). Where its next turns cancel too, each longer run of turns that join (only
        // turns that meet one of the moves before's last turns join, so there are few; a second turn only as those answers have it) with the least
        // those answers cost after two turns, and any answer left out after more
        if (previous) {
          const leftOf = (joined: { rest: string; saving: number }) => speedFloor(joined.rest, undefined, false) - joined.saving;
          const joinedAfter = (text: string, joined: { rest: string }, token: string) => {
            const longer = cutOnce(joinMoves(text, token))!;
            return longer.rest === joinMoves(joined.rest, token) ? null : longer;
          };
          // After `turns` turns (the next one joining too), the least (after two, the first turn's own: `two`, from any hand position and from home)
          const deeper = (text: string, joined: { rest: string; open: boolean }, turns: number, two: number[], seconds: number[], deepest = Infinity): number => {
            // A turn that stayed ended the joining: nothing after it joins
            if (!joined.open || (turns > 2 && turns - 3 >= dropped.deeper.length)) return Infinity;
            let lowest = Infinity;
            for (const token of turns === 2 ? seconds.map((second) => tokens[second]) : tokens) {
              const longer = joinedAfter(text, joined, token);
              if (!longer) continue;
              const home = fromHome(longer.rest);
              const rest = turns === 2 ? two[home ? 1 : 0] : (home ? dropped.deeperHome : dropped.deeper)[turns - 3];
              lowest = Math.min(lowest, leftOf(longer) + rest, turns < deepest ? deeper(joinMoves(text, token), longer, turns + 1, two, seconds, deepest) : Infinity);
            }
            return lowest;
          };
          for (const first of dropped.firsts) {
            if (!joins(item, twin, first.token)) continue;
            const text = joinMoves(rotation, tokens[first.token]);
            const joined = cutOnce(text)!;
            const plainBound = Math.min(first.plain, first.written + flip) + shift[hold] - SLACK + least;
            const firstTurn = leftOf(joined) + (fromHome(joined.rest) ? first.afterHome : first.after);
            const chained = deeper(text, joined, 2, [first.afterTwo, first.afterTwoHome], first.second);
            // Costs are kept to hundredths: SLACK covers the rounding (a writing's flip is left out: it only adds)
            const bound = Math.min(plainBound, Math.min(firstTurn, chained) - SLACK + least);
            if (!after(0, plainBound)) return miss("cancel-class cost");
            if (!after(0, firstTurn - SLACK + least)) return miss("cancel 1 turn");
            if (!after(0, bound)) return miss(after(0, Math.min(plainBound, Math.min(firstTurn, deeper(text, joined, 2, [first.afterTwo, first.afterTwoHome], first.second, 2)) - SLACK + least)) ? "cancel 3+ turns" : "cancel 2 turns");
            if (underBar(0, bound)) return miss("bar");
          }
        }
        // A grip that isn't clean by a turn order: none left out may be a clean writing listed before the one it's clean by
        const by = cleanBy.get(rotation);
        if (dropped.writingClean <= longest && !cleanBefore.has(rotation) && !(by !== undefined && dropped.writingClean > by)) return miss("writing");
      }
    }
  }
  // The answers given that are written as the file writes them held another way, written as the step writes them (the same cost: only a tie may come
  // out another way, and then its tier may change)
  let rewritten = false;
  for (const ranked of best) {
    if (!ranked.rewrite || !ranked.wide) continue;
    const { rotation } = ranked.combo;
    const found = writingSearch(ranked.wide.plain, { wide: wideAxes, slice: sliceAxes }, undefined, false, rotation, ranked.rewrite.bar, true).found;
    if (!found || (found.text === ranked.wide.wide && found.start === undefined)) continue;
    ranked.wide = { wide: found.text, plain: ranked.wide.plain, ...(found.start === undefined ? {} : { start: found.start }) };
    ranked.speed = found.cost + ranked.rewrite.look;
    ranked.tier = tierOf(rotation, ranked.moves, ranked.wide);
    rewritten = true;
  }
  if (rewritten) best.sort(compare);
  // As stepCandidates gives them (see its end)
  return best.map((ranked) => {
    const plain = stepResult({ combo: ranked.combo, moves: ranked.moves }, 0, options.solvableWith);
    const result = { ...plain, ...(ranked.tier === undefined ? {} : { tier: ranked.tier }), speed: ranked.speed };
    if (!ranked.wide) return result;
    const { rotation } = ranked.combo;
    const solution = shortRotations(joinMoves(rotation, ranked.wide.plain));
    const written = shortRotations(joinMoves(ranked.wide.start ?? rotation, ranked.wide.wide));
    const wide = options.last ? withoutEndRotations(written) : written;
    return wide === solution ? { ...result, solution: new Alg(solution) } : { ...result, solution: new Alg(solution), wide };
  });
}
