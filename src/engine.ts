// Cube engine: piece names, goal masks, grips, solvers and checks. No page code here, so it can move to another app later.

// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Parse alg strings into moves
import { Alg } from "cubing/alg";
// Puzzle model
import { cube3x3x3 } from "cubing/puzzles";
// Partial-goal solver and full 3x3x3 solver
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
// Lets us build a modified pattern
import { KPattern, type KPuzzle } from "cubing/kpuzzle";

// What a step checks on a goal piece: solve = home and turned right, place = home with any turn,
// orientN = turned right anywhere on group N's spots, swapN = anywhere on group N's spots with any turn,
// relativeN = solved relative to the other pieces of relative group N, wherever the group sits (the group turned as a whole),
// free = its spot may change (in a step that keeps every other piece untouched; anywhere else it's the same as not listing it)
export type Role = "solve" | "place" | "free" | `orient${number}` | `swap${number}` | `relative${number}`;

// Goal pieces by type and piece number, each with its role, e.g. { EDGES: { 4: "solve", 0: "orient1" } }
export type Goal = Record<string, Record<number, Role>>;

// One piece read from goal text
export interface GoalPiece {
  orbit: string; // piece type: EDGES, CORNERS or CENTERS
  index: number; // piece number in that type
  role: Role;
}

// Options for a step search
export interface StepOptions {
  // Moves the search may use (face turns by default)
  generatorMoves?: string[];
  // Longest solution to look for (no limit by default)
  maxDepth?: number;
  // Grips to try, as rotations from how the cube is held now (default: only the current grip)
  rotations?: string[];
  // Moves earlier steps already did after the scramble (they change the grip only through x, y, z)
  done?: string;
  // Goal also counts when the cube is off by one of these moves, e.g. ["", "D", "D2", "D'"] for a pseudo-cross (default: [""], no offset)
  offsets?: string[];
  // Goal also counts when only these moves are needed to finish it later, e.g. ["R", "U"] for corners a 2-gen finish can solve; named in the grip, like offsets (default: none)
  solvableWith?: string[];
   // Stop at the first grip × offset that finds an answer (within maxDepth) instead of comparing them all for the shortest
  firstFound?: boolean;
  // Earlier steps' pieces to keep solved too, named in the grip the step starts in (this step's roles win on conflicts)
  keep?: Goal;
  // Pieces earlier steps already did, named in the grip the step starts in (with or without keep), so no grip turn can pass them off as this step's pieces (default: keep)
  earlier?: Goal;
  // Every piece the goal doesn't list stays exactly as it is now (same spot, same twist): the goal's pieces go home, the pieces they push out fill the spots they leave,
  // and :x spots may take any piece; for BLD steps and finding algs (default: false, unlisted pieces are ignored)
  untouched?: boolean;
  // BLD: the buffer piece ("UF", "UFR"…): the step's goal is the next targets of the buffer's cycle (its pieces text stays empty), everything else untouched
  buffer?: string;
  // BLD: targets per step, e.g. 2 for a 3-cycle (default 2); a cycle break counts as a target
  targetsPerStep?: number;
  // BLD: pieces that may also swap when the targets left can't be done alone (an odd number of them), e.g. "UFR UBR" for edges (default: none)
  parity?: string;
  // Hears when the search worker builds or loads a table (first-time builds can take seconds), e.g. to show "Building tables…"
  onProgress?: (progress: TableProgress) => void;
}

// What the search worker is doing with a table: building one, or loading one stored in this browser (finished = false when it starts, true when it's done)
export interface TableProgress {
  action: "build" | "load";
  finished: boolean;
  states?: number; // once finished: the table's size (0 = it couldn't be built or loaded, e.g. a goal too big for one table, which gets split instead)
}

// Best answer of a step search
export interface StepResult {
  solution: Alg; // grip rotation (if any), then the moves (the offset is left in, not undone)
  rotation: string; // grip that won ("" = as held)
  offset: string; // offset the goal was reached up to ("" = none); undo it later with invertMoves(offset)
  pieces: string; // goal text it solved (the winning alternative plus kept pieces), named in the grip it ends in
  settled: string; // the goal pieces it left for good, for later steps to keep: pieces, minus those the solvable-with moves would still move
  alternative: number; // which of the step's alternatives won (0 = the first, or the only one)
  searches: number; // searches actually run (combos asking for the same thing, or whose measured distance can't beat the best, are skipped)
  changed?: string; // steps that keep every other piece untouched: the spots it may change (pieces text, named in the grip it ends in); every other piece stays as it was
}

// One step of a method, as plain data (what users edit and save as JSON)
export interface StepConfig {
  name: string;
  pieces: string; // goal text, e.g. "DFR FR", "UF:o UR:o…" or "DFR:r FR:r" (that pair joined anywhere); alternatives split by " | " (any one counts, e.g. "DF DR DB DL | DF DR DB DL DFR FR")
  keep?: boolean; // also keep every earlier step's pieces solved
  grips: { bottom: string[]; anyFront: boolean }; // faces that may go on the bottom, and whether y turns pick the front too
  offsets: string; // offsets text, e.g. "D D2 D'" ("" = none)
  solvableWith?: string; // moves that may finish the goal later, e.g. "R U" ("" = none: the goal itself)
  untouched?: boolean; // every piece the goal doesn't list stays as it is now (always on with a buffer)
  buffer?: string; // BLD buffer piece, e.g. "UF" ("" = none): the step solves the next targets of its cycle
  targetsPerStep?: number; // BLD: targets per step (2 = 3-cycles)
  parity?: string; // BLD: pieces that may swap too when the targets left are odd, e.g. "UFR UBR" ("" = none)
  moves: string[]; // moves the search may use, e.g. ["U", "R", "L"]
  maxDepth?: number | null; // longest solution to look for (null = no limit)
  firstFound?: boolean; // stop at the first grip × offset with an answer
  lookahead?: number; // later steps that judge this step's answers: each candidate is followed by that many steps (each its own shortest way), fewest moves in total wins (0 = none, the step's own shortest)
  extraMoves?: number; // with lookahead: candidates may be this many moves longer than the step's shortest answer (0 = the shortest answers only)
  repeat?: boolean; // run the step again and again until it has nothing left to do (e.g. one BLD 3-cycle per round, or "the easiest pair" until F2L is done)
}

// A whole method: steps run in order, each from where the last one left the cube
export interface Method {
  name: string;
  steps: StepConfig[];
}

// One finished step of a method run
export interface MethodStepResult extends StepResult {
  name: string; // step name
  step: number; // which of the method's steps it ran (its index)
  done: string; // moves before this step (after the scramble)
  offsets: string[]; // offsets the step's goal counted up to
  solvableWith: string[]; // moves that may finish the step's goal later ([] = none)
  moves: number; // move count of the solution
  ms: number; // search time
  ok: boolean; // scramble + done + solution really reaches the step's goal
  lookahead: { candidates: number; steps: number; total: number | null } | null; // with lookahead: answers compared, later steps they were judged over, and the winner's moves over this step and those (null = no answer got through them)
}

// A whole method run
export interface MethodResult {
  steps: MethodStepResult[];
  solution: string; // every step's solution in order
  pieces: string; // every step's pieces, named in the grip the run ends in
  offset: string; // offset the last step left in ("" = none)
  moves: number;
  ms: number;
  ok: boolean; // every step reached its goal
}

// Options for a method run
export interface MethodOptions {
  done?: string; // moves already done after the scramble, before the first step
  onStep?: (step: MethodStepResult, index: number) => void; // hears about each step as it finishes
  onStart?: (index: number, round: number) => void; // hears when a step starts (round 1, 2… for a repeated step)
  onProgress?: (progress: TableProgress) => void; // hears when the search worker builds or loads a table
}

// Face turns used when a step search isn't given its own moves
export const FACE_MOVES = ["U", "R", "F", "D", "L", "B"];

// Whole-cube rotations: they change the grip and don't count as moves
const ROTATIONS = ["x", "y", "z"];

// Piece names in cubing.js's order: the position in each list is the piece number
export const PIECE_NAMES: Record<string, string[]> = {
  EDGES: ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"],
  CORNERS: ["UFR", "UBR", "UBL", "UFL", "DFR", "DFL", "DBL", "DBR"],
  CENTERS: ["U", "L", "F", "R", "B", "D"],
};

// Piece type for each name length: 1 letter = center, 2 = edge, 3 = corner
export const ORBIT_BY_LENGTH: Record<number, string> = { 1: "CENTERS", 2: "EDGES", 3: "CORNERS" };

// Rotation that puts each face (as held now) on the bottom
export const BOTTOM_TURNS: Record<string, string> = { D: "", U: "x2", F: "x'", B: "x", R: "z", L: "z'" };

// y turns that pick a new front face while keeping the bottom
export const FRONT_TURNS = ["", "y", "y2", "y'"];

// Every grip (24 rotations, "as held" first)
const ALL_GRIPS = Object.values(BOTTOM_TURNS).flatMap((bottom) => FRONT_TURNS.map((front) => joinMoves(bottom, front)));

// Message when a step keeps centers its moves can't bring home (twips would search forever)
const CENTERS_OUT =
  "The goal's centers are out of place and the allowed moves can't bring them home: list only the centers the step needs, or allow M, E or S.";
  
// Message when every allowed grip only names pieces earlier steps already did (the answer would be a bare grip turn)
const NOTHING_NEW =
  "In every allowed grip, this step's pieces are ones earlier steps already did, so a grip turn alone would count: allow other bottom faces, or check the step's pieces.";

// Message when a step that keeps every other piece untouched also has offsets or solvable-with moves
const UNTOUCHED_MIX = "A step that keeps every other piece untouched can't have offsets or solvable-with moves.";

// Message when an untouched step's pieces use a role other than solved, :p or :x
const UNTOUCHED_ROLES = "With every other piece untouched, list pieces as solved, :p (in place, any twist) or :x (its spot may change).";

// Message when an untouched goal can't be reached with everything else kept (e.g. a lone swap or a lone twist)
const UNTOUCHED_OUT =
  "With every other piece untouched, the allowed moves can't do this (a lone swap or a lone twist): add pieces, or mark spots that may change with :x.";

// Message when a BLD step's targets left are odd and it has no parity pieces
const PARITY_NEEDED =
  "The targets left are odd (a lone swap), which no moves can do with everything else untouched: give the step parity pieces, e.g. UFR UBR (two corners a parity alg swaps too).";

// Most states of a whole-orbit sub-table that BLD steps ask the worker for (all 8 corners = 88M states, ~44 MB, a few seconds to build once)
const ORBIT_TABLE_STATES = 100_000_000;

// Most ways an untouched step's spots that may change can be filled (each one is searched as its own goal)
const MAX_UNTOUCHED_TARGETS = 5_000;

// Most rounds of a repeated method step (a BLD solve needs about 6–10 per piece type)
const MAX_REPEATS = 60;

// Sort a name's letters so "UR", "RU" and "ur" all mean the same piece
export function normalizeName(name: string): string {
  return name.toUpperCase().split("").sort().join("");
}

// Join move texts with spaces, skipping empty ones
export function joinMoves(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

// Group role for each suffix letter: oriented, swap group, relative group
const GROUP_ROLES: Record<string, string> = { o: "orient", s: "swap", r: "relative" };

// Read a role suffix: "" = solve, ":p" = place, ":x" = free, ":o" / ":o2"… = oriented in group 1 / 2…, ":s" / ":s2"… = swap group, ":r" / ":r2"… = relative group (null if it isn't one)
export function roleFromSuffix(suffix: string): Role | null {
  const tag = suffix.toLowerCase();
  if (tag === "") return "solve";
  if (tag === ":p") return "place";
  if (tag === ":x") return "free";
  // Group roles: letter, then an optional group number (1 when left out)
  const group = /^:([osr])([1-9]\d*)?$/.exec(tag);
  if (!group) return null;
  return `${GROUP_ROLES[group[1]]}${Number(group[2] ?? 1)}` as Role;
}

// Suffix that writes a role in goal text ("" for solve, ":o" for group 1, ":o2" for group 2, ":r" for relative group 1…)
export function roleSuffix(role: Role): string {
  if (role === "solve") return "";
  if (role === "place") return ":p";
  if (role === "free") return ":x";
  // Group roles: first letter, plus the group number unless it's 1
  const group = role.replace(/^\D+/, "");
  return `:${role[0]}${group === "1" ? "" : group}`;
}

// True for roles whose pieces share one id per group (orient and swap groups; relative pieces keep their own ids)
function isGroupRole(role: Role): boolean {
  return role.startsWith("orient") || role.startsWith("swap");
}

// Group number of a relative role (0 for any other role)
function relativeGroup(role: Role): number {
  return role.startsWith("relative") ? Number(role.slice("relative".length)) : 0;
}

// Piece number by name with its letters sorted, per piece type (so "RFU" finds UFR), made once
const PIECE_INDEX: Record<string, Map<string, number>> = Object.fromEntries(
  Object.entries(PIECE_NAMES).map(([orbit, names]) => [orbit, new Map(names.map((name, index) => [normalizeName(name), index]))]),
);

// Read goal text like "DF DR UF:o FR:o2 UFR:p L" into pieces with roles; throws a clear error on a typo
export function parseGoalText(text: string): GoalPiece[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => {
      // Split the piece name from its optional role suffix
      const [name, ...suffix] = word.split(":");
      const role = roleFromSuffix(suffix.length ? `:${suffix.join(":")}` : "");
      // Pick the piece type from the name's length
      const orbit = ORBIT_BY_LENGTH[name.length];
      // Find the piece's number in that type's list
      const index = orbit ? (PIECE_INDEX[orbit]?.get(normalizeName(name)) ?? -1) : -1;
      // Stop with a clear message on a typo
      if (!orbit || index === -1) throw new Error(`Unknown piece: "${name}"`);
      if (!role) throw new Error(`Unknown role in "${word}" (use :o, :o2…, :s, :s2…, :r, :r2…, :p or :x)`);
      return { orbit, index, role };
    });
}

// Split goal text into its alternatives ("|" or a new line between them; blank ones are dropped, so no text at all = one empty goal)
export function splitAlternatives(text: string): string[] {
  const alternatives = text.split(/[|\n]/).map((part) => part.trim()).filter(Boolean);
  return alternatives.length ? alternatives : [""];
}

// Split goal text into its alternatives and check each one; throws a clear error on a typo (naming the alternative when there are several),
// or on an empty goal when needPieces is set (a step that doesn't keep earlier pieces needs some of its own)
export function readAlternatives(text: string, needPieces = false): string[] {
  const alternatives = splitAlternatives(text);
  alternatives.forEach((alternative, index) => {
    try {
      if (!parseGoalText(alternative).length && needPieces) throw new Error("Pick at least one piece, or keep earlier steps' pieces.");
    } catch (error) {
      throw new Error(alternatives.length > 1 ? `Alternative ${index + 1}: ${(error as Error).message}` : (error as Error).message);
    }
  });
  return alternatives;
}

// All six centers kept solved (a goal's centers when its text names none)
function allCenters(): Record<number, Role> {
  return Object.fromEntries(PIECE_NAMES.CENTERS.map((_, index) => [index, "solve" as Role]));
}

// Turn goal text into the per-piece roles that maskPattern expects (defaultCenters = false leaves centers out when none is typed)
export function goalFromText(text: string, defaultCenters = true): Goal {
  const goal: Goal = {};
  // Add each typed piece with its role (a piece typed twice keeps its last role)
  for (const { orbit, index, role } of parseGoalText(text)) (goal[orbit] ??= {})[index] = role;
  // No center typed: keep all six, so slice moves can't move them
  if (defaultCenters) goal.CENTERS ??= allCenters();
  return goal;
}

// Write a goal back as goal text in piece-list order (all six solved centers are left out, since that's what no center means)
export function goalToText(goal: Goal): string {
  const centers = Object.values(goal.CENTERS ?? {});
  const allSix = centers.length === PIECE_NAMES.CENTERS.length && centers.every((role) => role === "solve");
  return Object.entries(PIECE_NAMES)
    .filter(([orbit]) => !(orbit === "CENTERS" && allSix))
    .flatMap(([orbit, names]) => names.flatMap((name, index) => (goal[orbit]?.[index] ? [name + roleSuffix(goal[orbit][index])] : [])))
    .join(" ");
}

// True when a kept role already asks at least as much as a step's role (solved covers every role, in place covers swap groups, any relative group covers a relative role)
function covers(kept: Role | undefined, role: Role): boolean {
  return kept === role || kept === "solve" || (kept === "place" && role.startsWith("swap")) || (relativeGroup(role) > 0 && relativeGroup(kept ?? "solve") > 0);
}


// Combine two goals into a new one; `over`'s role wins for a piece in both. Relative groups stay apart: `base`'s are renumbered past `over`'s
// (a pair joined anywhere earlier and one joined now each keep their own group, rather than having to sit together)
export function mergeGoals(base: Goal, over: Goal): Goal {
  // Highest relative group number in `over` (0 = none)
  let shift = 0;
  for (const roles of Object.values(over)) for (const role of Object.values(roles)) shift = Math.max(shift, relativeGroup(role));
  const merged: Goal = {};
  // Base roles first (its relative groups moved up past over's), then over's on top
  for (const [orbit, roles] of Object.entries(base)) {
    const copy: Record<number, Role> = (merged[orbit] = { ...roles });
    if (shift) for (const [piece, role] of Object.entries(roles)) if (relativeGroup(role)) copy[Number(piece)] = `relative${relativeGroup(role) + shift}`;
  }
  for (const [orbit, roles] of Object.entries(over)) Object.assign((merged[orbit] ??= {}), roles);
  return merged;
}

// The goal without its :x pieces (outside untouched steps, a spot that may change is the same as a piece the goal doesn't list)
export function dropFree(goal: Goal): Goal {
  // Nothing to drop: the goal as it is (callers only read it)
  if (!Object.values(goal).some((roles) => Object.values(roles).includes("free"))) return goal;
  const kept: Goal = {};
  for (const [orbit, roles] of Object.entries(goal)) {
    kept[orbit] = Object.fromEntries(Object.entries(roles).filter(([, role]) => role !== "free"));
  }
  return kept;
}

// Hide what the goal doesn't check: each orient / swap group (and the ignored pieces) shares one id, place / swap / ignored pieces may be turned any way
// (relative pieces stay as they are, like solved ones: goalTargets puts their groups where they may sit)
export function maskPattern(pattern: KPattern, goal: Goal): KPattern {
  // Copy the data so the original pattern isn't changed (array copies: much faster than structuredClone, which a method search does thousands of times)
  const data: KPattern["patternData"] = {};
  for (const [orbitName, { pieces, orientation, orientationMod }] of Object.entries(pattern.patternData)) {
    data[orbitName] = { pieces: [...pieces], orientation: [...orientation], ...(orientationMod ? { orientationMod: [...orientationMod] } : {}) };
  }
  // :x pieces count as ignored
  const listed = dropFree(goal);
  // Go through each piece type: EDGES, CORNERS, CENTERS
  for (const [orbitName, orbit] of Object.entries(data)) {
    // Role of each goal piece of this type (not listed = ignored)
    const roles = listed[orbitName] ?? {};
    // Shared id per group and for ignored pieces: the first piece number with that role,
    // picked from the goal (not from where pieces sit) so start and target agree, and never the same for two groups
    const sharedIds = new Map<string, number>();
    orbit.pieces.forEach((_, id) => {
      const group = roles[id] ?? "ignored";
      if ((group === "ignored" || isGroupRole(group)) && !sharedIds.has(group)) sharedIds.set(group, id);
    });
    // Per-piece orientation rule (0 = matters, 1 = ignored), starting from the puzzle's own rules
    const mods = orbit.orientationMod ?? orbit.pieces.map(() => 0);
    orbit.orientationMod = mods;
    // Rewrite each spot based on the role of the piece sitting there
    orbit.pieces.forEach((piece, i) => {
      const role = roles[piece];
      // Group and ignored pieces become interchangeable with the rest of their group
      if (!role || isGroupRole(role)) orbit.pieces[i] = sharedIds.get(role ?? "ignored")!;
      // Place, swap and ignored pieces may be turned any way
      if (!role || role === "place" || role.startsWith("swap")) {
        orbit.orientation[i] = 0;
        mods[i] = 1;
      }
    });
  }
  // Turn the data back into a pattern
  return new KPattern(pattern.kpuzzle, data);
}

// Cube definition, filled in by loadEngine()
let kpuzzle: KPuzzle;
// Grip for each center layout ("U,L,F,R,B,D" order of center numbers → rotation)
const gripByCenters = new Map<string, string>();

// Most entries a lookup cache holds before it starts over (they only hold results of pure lookups, so a method search's many step starts don't redo them)
const MAX_REMEMBERED = 10_000;
// The solved cube after some moves (grips, offsets, a scramble), by move text
const turnedSolved = new Map<string, KPattern>();
// The cube held in a grip after a scramble, by grip and scramble (a step start then only applies the moves after the scramble)
const scrambledInGrip = new Map<string, KPattern>();
// The cube held after a scramble and some moves, by both
const heldAfter = new Map<string, KPattern>();

// A cached value, made on first use (the cache starts over once it's full)
function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    if (cache.size >= MAX_REMEMBERED) cache.clear();
    value = make();
    cache.set(key, value);
  }
  return value;
}

// The solved cube after these moves (kept, since grips and offsets come back again and again)
function solvedAfter(moves: string): KPattern {
  return remember(turnedSolved, moves, () => kpuzzle.defaultPattern().applyAlg(moves));
}

// Load the cube definition; await this once before using the engine
export async function loadEngine(): Promise<void> {
  kpuzzle = await cube3x3x3.kpuzzle();
  // Cached cubes and lookups belong to the old definition
  for (const cache of [turnedSolved, scrambledInGrip, heldAfter, movesKeys, movesRenamed, pieceMovesMade]) cache.clear();
  // Remember where the centers end up for each of the 24 grips
  for (const grip of ALL_GRIPS) gripByCenters.set(centerLayout(kpuzzle.defaultPattern().applyAlg(grip)), grip);
}

// Center numbers in spot order, as a lookup key
function centerLayout(pattern: KPattern): string {
  return pattern.patternData["CENTERS"].pieces.join();
}

// Whole-cube rotation hidden in a move sequence (rotations, slices or wide moves), found from where the centers ended up
function netRotation(moves: string): string {
  return gripByCenters.get(centerLayout(solvedAfter(moves))) ?? "";
}

// Only the x, y, z rotations of a move sequence, in order
function rotationsIn(moves: string): string {
  // No x, y or z anywhere: nothing to parse (no other move has those letters)
  if (!/[xyz]/.test(moves)) return "";
  return Array.from(new Alg(moves).expand().experimentalLeafMoves())
    .filter((move) => ROTATIONS.includes(move.family))
    .join(" ");
}

// Grip after `scramble` then `done`: the scramble is judged by where its centers ended up,
// after that only x, y, z change the grip (slice and wide moves turn centers, not the hand)
function gripAfter(scramble: string, done = ""): string {
  return joinMoves(netRotation(scramble), rotationsIn(done));
}

// Grips to try: each allowed bottom face, with all four front faces or just the current one
export function gripRotations(bottoms: string[], anyFront: boolean): string[] {
  return bottoms.flatMap((face) => (anyFront ? FRONT_TURNS : [""]).map((front) => joinMoves(BOTTOM_TURNS[face], front)));
}

// The cube after `scramble` then `done`, renumbered so piece numbers mean "home spot in the grip it's held in now"
// (kept, as is the scramble held in each grip, so a method search's step starts mostly apply nothing, or only the moves after the scramble)
function heldPattern(scramble: string, done = ""): KPattern {
  return remember(heldAfter, `${scramble}\n${done}`, () => {
    const grip = gripAfter(scramble, done);
    const scrambled = remember(scrambledInGrip, `${grip}\n${scramble}`, () => kpuzzle.defaultPattern().applyAlg(new Alg(grip).invert()).applyAlg(joinMoves(scramble)));
    return done.trim() ? scrambled.applyAlg(joinMoves(done)) : scrambled;
  });
}

// Note a held cube worked out another way (e.g. a step's held cube plus its answer's moves), so heldPattern needn't apply every move again
function noteHeld(scramble: string, done: string, held: KPattern): void {
  remember(heldAfter, `${scramble}\n${done}`, () => held);
}

// The cube after `scramble` then `done`, held in another grip (a rotation from the grip it's held in): heldPattern(scramble, done + rotation),
// made by turning the held cube instead of applying every move again
function heldInGrip(scramble: string, done: string, rotation: string): KPattern {
  if (!rotation) return heldPattern(scramble, done);
  return remember(heldAfter, `${scramble}\n${joinMoves(done, rotation)}`, () => {
    // Held cube as a transformation of the solved cube, done between the rotation's inverse and the rotation
    const held = heldPattern(scramble, done).experimentalToTransformation();
    return held ? solvedAfter(invertMoves(rotation)).applyTransformation(held).applyAlg(rotation) : heldPattern(scramble, joinMoves(done, rotation));
  });
}

// Goal (text or roles) renumbered to the actual pieces that fill its spots in the grip after `scramble` then `done` (e.g. for the viewer's mask)
export function goalOnCube(goal: string | Goal, scramble: string, done = ""): Goal {
  // Solved cube held in that grip: the piece at each spot is the one that belongs there
  const homes = solvedAfter(gripAfter(scramble, done)).patternData;
  const onCube: Goal = {};
  // Move each role from its spot number to the number of the piece that belongs there
  for (const [orbit, roles] of Object.entries(typeof goal === "string" ? goalFromText(goal) : goal)) {
    const renumbered: Record<number, Role> = (onCube[orbit] = {});
    for (const [spot, role] of Object.entries(roles)) renumbered[homes[orbit].pieces[Number(spot)]] = role;
  }
  return onCube;
}

// Rename a goal's spots for the grip after a whole-cube rotation, so it still means the same pieces (e.g. "FR" becomes "FL" after y)
export function rotateGoal(goal: Goal, rotation: string): Goal {
  const turned = solvedAfter(rotation).patternData;
  const renamed: Goal = {};
  for (const [orbit, roles] of Object.entries(goal)) {
    const moved: Record<number, Role> = (renamed[orbit] = {});
    // The rotation brings whatever was on spot `from` to spot `to`
    turned[orbit].pieces.forEach((from, to) => {
      if (roles[from]) moved[to] = roles[from];
    });
  }
  return renamed;
}

// Read move text; throws a clear error on moves the 3x3x3 doesn't have, returns the cleaned-up moves
export function parseMoves(text: string): string {
  const alg = new Alg(text.trim());
  kpuzzle.defaultPattern().applyAlg(alg);
  return alg.toString();
}

// Moves that undo a move sequence (e.g. to take an offset back out)
export function invertMoves(moves: string): string {
  return new Alg(moves).invert().toString();
}

// Offsets in groups searched together: the ones the allowed moves can make (each move allowed, or a power of an allowed quarter turn) share one table with no offset,
// any other offset (e.g. D when only U R are allowed) gets its own group, since its target differs on spots the moves never touch
function offsetGroups(offsets: string[], moves: string[]): string[][] {
  return remember(offsetGroupsMade, `${offsets.join(",")}/${moves.join(" ")}`, () => groupOffsets(offsets, moves));
}

// Offset groups already worked out, by offsets and moves
const offsetGroupsMade = new Map<string, string[][]>();

// Work out offsetGroups' answer
function groupOffsets(offsets: string[], moves: string[]): string[][] {
  const leaves = (text: string) => Array.from(new Alg(text).experimentalLeafMoves());
  // Faces the allowed moves turn by a quarter (every power of those is allowed too), and the exact allowed moves
  const quarter = new Set(moves.flatMap(leaves).filter((move) => Math.abs(move.amount) === 1).map((move) => move.family));
  const exact = new Set(moves.flatMap(leaves).map((move) => move.toString()));
  const shared: string[] = [];
  const alone: string[][] = [];
  for (const offset of offsets) {
    if (leaves(offset).every((move) => quarter.has(move.family) || exact.has(move.toString()))) shared.push(offset);
    else alone.push([offset]);
  }
  return shared.length ? [shared, ...alone] : alone;
}

// Read offset text into a step's offsets list, no offset first: spaces split one-move offsets ("D D2 D'"),
// commas split offsets of several moves ("U, U D"); throws a clear error on a bad move or a whole-cube turn
export function offsetsFromText(text: string): string[] {
  const offsets = [""];
  for (const part of text.split(text.includes(",") ? "," : /\s+/)) {
    // Clean up the moves (throws on moves the 3x3x3 doesn't have)
    const offset = parseMoves(part);
    // Whole-cube turns are grips, not offsets
    if (rotationsIn(offset)) throw new Error(`Offset "${offset}" turns the whole cube: use Bottom face / any front for grips.`);
    // Keep each offset once
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  return offsets;
}

// Read "solvable with" text into its moves ("R U" → ["R", "U"]; spaces or commas between them, "" = none); throws a clear error on a bad move or a whole-cube turn
export function solvableFromText(text: string): string[] {
  const moves: string[] = [];
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    // Clean up the move (throws on moves the 3x3x3 doesn't have)
    const move = parseMoves(word);
    // Whole-cube turns are grips, not moves that finish a goal
    if (rotationsIn(move)) throw new Error(`Solvable with "${move}" turns the whole cube: list face or slice moves (e.g. R U).`);
    // Keep each move once
    if (!moves.includes(move)) moves.push(move);
  }
  return moves;
}

// New random-state 3x3x3 scramble
export async function randomScramble(): Promise<string> {
  return (await randomScrambleForEvent("333")).toString();
}

// Allowed moves as turns of the cube itself in this grip (rotation, move, rotation back), so grips only merge when they allow the same turns
function movesKey(rotation: string, moves: string[]): string {
  return remember(movesKeys, `${rotation}/${moves.join(" ")}`, () => {
    const back = new Alg(rotation).invert().toString();
    return moves
      .map((move) => JSON.stringify(solvedAfter(joinMoves(rotation, move, back)).patternData))
      .sort()
      .join("|");
  });
}

// Moves keys already worked out, by rotation and moves
const movesKeys = new Map<string, string>();

// Turn families a step's moves may use (face, slice and wide turns), to name a turn the way another grip sees it
const TURN_FAMILIES = ["U", "R", "F", "D", "L", "B", "M", "E", "S", "Uw", "Rw", "Fw", "Dw", "Lw", "Bw"];
// Moves renamed for another grip, by both grips and the move (null = no single move is that turn)
const movesRenamed = new Map<string, string | null>();

// A move as the turns it allows: a quarter turn by its family alone (its powers are the same moves either way round), any other with its amount (e.g. "R2")
function turnName(move: string): string {
  const leaf = Array.from(new Alg(move).experimentalLeafMoves())[0];
  if (!leaf) return move;
  const amount = Math.abs(leaf.amount);
  return amount === 1 ? leaf.family : `${leaf.family}${amount}`;
}

// A move named in one grip, named the way another grip sees the same turn (both grips as rotations from one hold), e.g. R in grip y is B as held;
// quarter turns come without the prime (see turnName), null when no single move is that turn
function moveInGrip(move: string, from: string, to: string): string | null {
  if (from === to) return turnName(move);
  return remember(movesRenamed, `${from}/${move}/${to}`, () => {
    // The turn as the cube itself turns it in a grip (rotation, move, rotation back)
    const turn = (rotation: string, name: string) => JSON.stringify(solvedAfter(joinMoves(rotation, name, invertMoves(rotation))).patternData);
    const wanted = turn(from, move);
    // The move that turns the cube the same way in the other grip
    for (const family of TURN_FAMILIES) {
      for (const amount of ["", "2", "'"]) if (turn(to, family + amount) === wanted) return turnName(family + amount);
    }
    return null;
  });
}

// Moves with each turn once (see turnName); a half turn whose quarter turn is there too is left out, as one of its powers
function distinctTurns(moves: string[]): string[] {
  const names = [...new Set(moves.map(turnName))];
  return names.filter((name) => !(name.endsWith("2") && names.includes(name.slice(0, -1))));
}

// Moves named as the cube is held (see turnName), named for a grip; a list from `prefer` instead when it allows the same turns
// (a step's own list, so a measure shares its tables); null when one has no single-move name there
function movesForGrip(turns: string[], rotation: string, prefer: string[][]): string[] | null {
  const named: string[] = [];
  for (const turn of turns) {
    const name = moveInGrip(turn, "", rotation);
    if (name === null) return null;
    named.push(name);
  }
  const allowed = distinctTurns(named);
  // Same turns: the same names once each list is tidied the same way
  const same = (list: string[]) => {
    const other = distinctTurns(list);
    return other.length === allowed.length && other.every((name) => allowed.includes(name));
  };
  return prefer.find(same) ?? allowed;
}

// True when the allowed moves can bring the start's goal centers to where the target has them (few center layouts, so a quick breadth-first walk)
function centersReachable(start: KPattern, target: KPattern, moves: string[]): boolean {
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
function maskedTarget(goal: Goal, offset = ""): KPattern {
  return maskPattern(solvedAfter(offset), goal);
}

// Most targets a goal's relative groups may give per offset (every mix of the groups' placements; the worker gets them all in one request)
const MAX_RELATIVE_TARGETS = 10_000;

// One relative group's pieces moved as a whole: each piece's type, number, and the spot and twist it lands on
type Placement = { orbit: string; piece: number; spot: number; twist: number }[];

// Every order of some items, where items of one class are interchangeable (each distinct order of classes once)
function arrangements<T>(items: T[], classOf: (item: T) => string): T[][] {
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
function goalTargets(goal: Goal, offset = ""): KPattern[] {
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
function reachableTargets(targets: KPattern[], moves: string[]): KPattern[] {
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

// Most patterns a "solvable with" check walks through (the search worker refuses goals with more end states than this too)
const MAX_SOLVABLE_STATES = 100_000;

// A pattern as one number per spot (piece types in the puzzle's order): piece × 256 + orientation mod × 16 + twist, for quick "solvable with" checks
function cellsOf(pattern: KPattern): Uint16Array {
  const cells: number[] = [];
  for (const { orbitName, numOrientations } of kpuzzle.definition.orbits) {
    const { pieces, orientation, orientationMod } = pattern.patternData[orbitName];
    pieces.forEach((piece, spot) => {
      const mod = orientationMod?.[spot] ?? 0;
      cells.push(piece * 256 + mod * 16 + (orientation[spot] % (mod || numOrientations)));
    });
  }
  return Uint16Array.from(cells);
}

// One move as cell lookups: spot i takes the cell on spot from[i] and gains twist[i], wrapping at count[i] (its piece type's orientations) unless the piece's own mod is smaller
interface CellMove {
  from: number[];
  twist: number[];
  count: number[];
}

// "Solvable with" moves as cell lookups
function cellMoves(moves: string[]): CellMove[] {
  return moves.map((move) => {
    const data = kpuzzle.moveToTransformation(move).transformationData;
    const cellMove: CellMove = { from: [], twist: [], count: [] };
    // First cell of each piece type
    let offset = 0;
    for (const { orbitName, numPieces, numOrientations } of kpuzzle.definition.orbits) {
      const { permutation, orientationDelta } = data[orbitName];
      for (let spot = 0; spot < numPieces; spot++) {
        cellMove.from.push(offset + permutation[spot]);
        cellMove.twist.push(orientationDelta[spot]);
        cellMove.count.push(numOrientations);
      }
      offset += numPieces;
    }
    return cellMove;
  });
}

// Cells after one move (orientation mods travel with their pieces; a twist wraps at the piece's mod, or at its type's orientations when it has none)
function moveCells(cells: Uint16Array, move: CellMove): Uint16Array {
  const out = new Uint16Array(cells.length);
  for (let spot = 0; spot < cells.length; spot++) {
    const cell = cells[move.from[spot]];
    const mod = (cell >> 4) & 15;
    out[spot] = (cell & ~15) | (((cell & 15) + move.twist[spot]) % (mod || move.count[spot]));
  }
  return out;
}

// Lookup key of some cells
function cellsKey(cells: Uint16Array): string {
  return String.fromCharCode(...cells);
}

// Which target the start reaches with only these moves (the earliest in the list when several do, so no offset wins when it can; -1 when none does):
// breadth-first from the start through every pattern those moves reach
function solvableIndex(start: KPattern, targets: KPattern[], moves: string[]): number {
  // Each target's key (a repeated target keeps its first index)
  const wanted = new Map<string, number>();
  targets.forEach((target, index) => {
    const key = cellsKey(cellsOf(target));
    if (!wanted.has(key)) wanted.set(key, index);
  });
  const turns = cellMoves(moves);
  const first = cellsOf(start);
  const seen = new Set([cellsKey(first)]);
  const queue = [first];
  // Earliest target found so far (the first one can't be beaten)
  let best = -1;
  for (let next = 0; next < queue.length; next++) {
    const found = wanted.get(cellsKey(queue[next]));
    if (found !== undefined && (best === -1 || found < best)) best = found;
    if (best === 0) return best;
    // Every move from here, keeping new patterns only (up to the cap)
    for (const turn of turns) {
      const moved = moveCells(queue[next], turn);
      const key = cellsKey(moved);
      if (seen.has(key) || seen.size >= MAX_SOLVABLE_STATES) continue;
      seen.add(key);
      queue.push(moved);
    }
  }
  return best;
}

// True when every mix of the moves leaves spot `at` holding what it holds now: follows where the spot's content could come from, and the twist it gains on the way
function keepsCell(cells: Uint16Array, at: number, turns: CellMove[]): boolean {
  const seen = new Set([`${at}/0`]);
  const queue: [number, number][] = [[at, 0]];
  for (const [spot, twist] of queue) {
    // The content of `spot`, brought to `at` with `twist` gained, must be what `at` holds (same piece and mod, same twist where it counts)
    const cell = cells[spot];
    const mod = (cell >> 4) & 15;
    if ((cell & ~15) !== (cells[at] & ~15) || ((cell & 15) + twist) % (mod || turns[0].count[at]) !== (cells[at] & 15)) return false;
    // One more move before the others: the content comes from where that move takes it from
    for (const turn of turns) {
      const step: [number, number] = [turn.from[spot], (twist + turn.twist[spot]) % turn.count[spot]];
      const key = `${step[0]}/${step[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(step);
    }
  }
  return true;
}

// The goal's pieces that the "solvable with" moves can't disturb, so later steps may keep them: every mix of those moves leaves the same piece on their spot, turned the same way
// where that counts (under R U: the left D-layer pieces, and the edges' orientation; not the R- and U-layer corners)
function settledGoal(goal: Goal, moves: string[]): Goal {
  if (!moves.length) return goal;
  const turns = cellMoves(moves);
  const target = cellsOf(maskedTarget(goal));
  const settled: Goal = {};
  // First cell of each piece type
  let offset = 0;
  for (const { orbitName, numPieces } of kpuzzle.definition.orbits) {
    for (const [spot, role] of Object.entries(goal[orbitName] ?? {})) {
      if (keepsCell(target, offset + Number(spot), turns)) (settled[orbitName] ??= {})[Number(spot)] = role;
    }
    offset += numPieces;
  }
  return settled;
}

// The pattern with every piece renamed after the spot it has in `by` (its twist counted from its twist there), so `by` itself becomes the solved cube.
// Moves act on spots, not on names, so the moves from `pattern` to `by` are the same as from the renamed pattern to solved: every untouched step (a BLD
// 3-cycle, a parity) becomes "solve the whole cube" from a cube that's solved but for a few pieces, and they all share one set of tables
function relabel(pattern: KPattern, by: KPattern): KPattern {
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
function countedTwists(orbitName: string, numOrientations: number): number {
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
function reachableChanges(moves: string[]): Set<string> {
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
interface Wanted {
  set: Record<string, Map<number, { piece: number; twist: number | null }>>;
  free: Record<string, Set<number>>;
  swap?: Record<string, Set<number>>;
}

// Throws unless every role of an untouched goal is solved, :p or :x
function checkUntouchedRoles(goal: Goal): void {
  for (const roles of Object.values(goal)) {
    if (Object.values(roles).some((role) => role !== "solve" && role !== "place" && role !== "free")) throw new Error(UNTOUCHED_ROLES);
  }
}

// An untouched goal on the cube held now: each listed piece goes home (turned right, or any way for :p), the pieces in its way and the :x spots
// make up the spots that may change (the pieces pushed out fill the spots the listed ones leave); every other piece stays
function untouchedWanted(held: KPattern, goal: Goal): Wanted {
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

// A BLD step's goal: follow the cycle from the buffer for `count` targets: each target sends the buffer's piece home (solved) and brings the piece there to the buffer;
// when the buffer holds its own piece (a cycle closed), a new cycle starts at any unsolved spot (each choice is its own goal: the shortest wins), its piece taking
// the buffer's place. The buffer then holds whatever piece is left, with any twist (the others fix it). Nothing to trace = an empty goal (the cube as it is).
// A step starting with the buffer home may instead fix two pieces that are only twisted in place (flipped edges, twisted corners), like a BLD flip alg
function traceWanted(held: KPattern, buffer: GoalPiece, count: number): Wanted[] {
  const { orbit, index: home } = buffer;
  const now = held.patternData[orbit];
  const wanted: Wanted[] = [];
  // Twist values that count for this piece type, and each spot's twist now
  const twistCount = countedTwists(orbit, kpuzzle.definition.orbits.find((info) => info.orbitName === orbit)!.numOrientations);
  const twistsNow = now.orientation.map((twist) => twist % twistCount);
  // Pieces home but twisted (not the buffer): with the buffer home and room for two targets, each pair of them is a goal of its own
  const twisted = now.pieces.flatMap((piece, spot) => (spot !== home && piece === spot && twistsNow[spot] !== 0 ? [spot] : []));
  if (now.pieces[home] === home && count >= 2) {
    twisted.forEach((first, index) => {
      for (const second of twisted.slice(index + 1)) {
        wanted.push({ set: { [orbit]: new Map([first, second].map((spot) => [spot, { piece: spot, twist: 0 }])) }, free: {} });
      }
    });
  }
  // pieces / twists: what each spot of the buffer's type holds as the step goes (twist null = not known yet), set: the spots the step has settled so far
  const walk = (pieces: number[], twists: (number | null)[], set: Map<number, { piece: number; twist: number | null }>, left: number): void => {
    if (left > 0) {
      const piece = pieces[home];
      // The buffer holds another piece: it goes home solved, and the piece there comes to the buffer
      if (piece !== home) {
        const next = [...pieces];
        const turned = [...twists];
        [next[home], turned[home], next[piece], turned[piece]] = [pieces[piece], null, piece, 0];
        walk(next, turned, new Map(set).set(piece, { piece, twist: 0 }), left - 1);
        return;
      }
      // Cycle closed: start a new one at any spot that isn't solved yet (the buffer's piece parks there for now)
      const unsolved = pieces.flatMap((holds, spot) => (spot !== home && (holds !== spot || twists[spot] !== 0) ? [spot] : []));
      if (unsolved.length) {
        for (const spot of unsolved) {
          const next = [...pieces];
          const turned = [...twists];
          [next[home], turned[home], next[spot], turned[spot]] = [pieces[spot], null, home, null];
          walk(next, turned, new Map(set).set(spot, { piece: home, twist: null }), left - 1);
        }
        return;
      }
    }
    // Done: the buffer ends holding the piece left there, any twist
    const final = new Map(set);
    if (final.size) final.set(home, { piece: pieces[home], twist: null });
    wanted.push({ set: { [orbit]: final }, free: {} });
  };
  walk([...now.pieces], twistsNow, new Map(), count);
  return wanted;
}

// The same goal where a BLD step's parity pieces may change too: swapping among themselves, each keeping its twist (like a parity alg's clean swap),
// or with `anyTwist` ending any way (spots the goal already settles are left out)
function withParity(wanted: Wanted, pieces: GoalPiece[], anyTwist: boolean): Wanted {
  const spots: Record<string, Set<number>> = {};
  for (const [orbit, free] of Object.entries(anyTwist ? wanted.free : {})) spots[orbit] = new Set(free);
  for (const { orbit, index } of pieces) if (!wanted.set[orbit]?.has(index) && !wanted.free[orbit]?.has(index)) (spots[orbit] ??= new Set()).add(index);
  return anyTwist ? { set: wanted.set, free: spots } : { set: wanted.set, free: wanted.free, swap: spots };
}

// Every end state an untouched goal allows: settled spots as asked, the pieces left over in every order on the spots that may change, every twist where it's free,
// swap spots' pieces in every order with their own twists; only the ones the allowed moves could reach (same permutation parities and twist sums as some mix of the moves) are kept
function completions(held: KPattern, wanted: Wanted, reachable: Set<string>): KPattern[] {
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
function untouchedPieces(wanted: Wanted): { solved: Goal; changed: Goal } {
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
function wholeGoal(): Goal {
  return Object.fromEntries(Object.entries(PIECE_NAMES).map(([orbit, names]) => [orbit, Object.fromEntries(names.map((_, index) => [index, "solve" as Role]))]));
}

// Read a BLD buffer ("UF", "ufr"…; "" = none) into its piece name; throws a clear error unless it's one edge or corner
export function bufferFromText(text: string): string {
  const pieces = parseGoalText(text);
  if (!pieces.length) return "";
  const [piece] = pieces;
  if (pieces.length > 1 || piece.orbit === "CENTERS" || piece.role !== "solve") throw new Error('The buffer is one edge or corner, e.g. "UF" or "UFR".');
  return PIECE_NAMES[piece.orbit][piece.index];
}

// Read BLD parity pieces ("UFR UBR"; "" = none) into piece names; throws a clear error on a typo or a role suffix
export function parityFromText(text: string): string {
  const pieces = parseGoalText(text);
  if (pieces.some((piece) => piece.role !== "solve")) throw new Error("Parity pieces are plain piece names, e.g. UFR UBR.");
  return pieces.map((piece) => PIECE_NAMES[piece.orbit][piece.index]).join(" ");
}


// How one piece type moves on its own: a piece state is spot × twists + twist, and each allowed move (R, R2, R' count apart) maps every state to the next
interface PieceMoves {
  twists: number; // twist values a piece of this type can have
  next: number[][]; // one lookup per allowed move: state before → state after
}

// Lookups for each piece type under the allowed moves, so a single piece's distance can be found without touching the rest of the cube
function pieceMoves(moves: string[]): Record<string, PieceMoves> {
  return remember(pieceMovesMade, moves.join(" "), () => makePieceMoves(moves));
}

// Piece lookups already made, by allowed moves
const pieceMovesMade = new Map<string, Record<string, PieceMoves>>();

// Make pieceMoves' lookups
function makePieceMoves(moves: string[]): Record<string, PieceMoves> {
  const solved = kpuzzle.defaultPattern();
  const tables: Record<string, PieceMoves> = {};
  for (const orbit of kpuzzle.definition.orbits) tables[orbit.orbitName] = { twists: orbit.numOrientations, next: [] };
  for (const move of moves) {
    // Every power of the move (R, R2, R'), until it comes back to solved
    for (let turned = solved.applyMove(move); !turned.isIdentical(solved); turned = turned.applyMove(move)) {
      for (const [orbitName, table] of Object.entries(tables)) {
        const { pieces, orientation } = turned.patternData[orbitName];
        const next: number[] = [];
        // The piece that was on spot `from` lands on spot `to`, twisted by that spot's change
        pieces.forEach((from, to) => {
          for (let twist = 0; twist < table.twists; twist++) {
            next[from * table.twists + twist] = to * table.twists + ((twist + orientation[to]) % table.twists);
          }
        });
        table.next.push(next);
      }
    }
  }
  return tables;
}

// Fewest allowed moves that take one piece from `state` to a state the goal accepts (Infinity if the moves can't get it there)
function pieceDistance(table: PieceMoves, state: number, accepts: (state: number) => boolean): number {
  const seen = new Set([state]);
  // Breadth-first: every state reachable in `depth` moves, one layer at a time (a piece has only ~24 states)
  for (let layer = [state], depth = 0; layer.length; depth++) {
    if (layer.some(accepts)) return depth;
    const nextLayer: number[] = [];
    for (const from of layer) {
      for (const move of table.next) {
        if (seen.has(move[from])) continue;
        seen.add(move[from]);
        nextLayer.push(move[from]);
      }
    }
    layer = nextLayer;
  }
  return Infinity;
}

// How easy a grip × offset looks: each goal piece's own fewest moves to a spot the goal accepts (in any of the offset's targets: one, or one per placement of the relative groups).
// The largest is a sure lower bound on the answer (bound); the sum ranks how far off the goal looks overall (total)
function estimate(held: KPattern, start: KPattern, targets: KPattern[], goal: Goal, tables: Record<string, PieceMoves>): { bound: number; total: number } {
  let bound = 0;
  let total = 0;
  for (const [orbitName, table] of Object.entries(tables)) {
    const roles = goal[orbitName] ?? {};
    const now = held.patternData[orbitName];
    const masked = start.patternData[orbitName];
    const wants = targets.map((target) => target.patternData[orbitName]);
    now.pieces.forEach((piece, spot) => {
      // Pieces the goal ignores don't count
      if (!roles[piece]) return;
      // A state is accepted when its spot wants this piece's (shared) id in some target, with the right twist unless the twist is ignored there
      const id = masked.pieces[spot];
      const accepts = (state: number) => {
        const at = Math.floor(state / table.twists);
        for (const want of wants) {
          const mod = want.orientationMod?.[at] || table.twists;
          if (want.pieces[at] === id && (state % table.twists) % mod === want.orientation[at] % mod) return true;
        }
        return false;
      };
      const moves = pieceDistance(table, spot * table.twists + now.orientation[spot], accepts);
      bound = Math.max(bound, moves);
      total += moves;
    });
  }
  return { bound, total };
}

// One answer from the search worker: a search's moves, a list's answers, a measure's distance (bound, exact or a lower bound; null = unknown), an error,
// or table progress for the request it's working on (the answer comes later)
interface WorkerReply {
  id: number;
  moves?: string;
  answers?: string[];
  bound?: number | null;
  exact?: boolean;
  error?: string;
  progress?: TableProgress;
}

// One request to the search worker: measure how far the start is from the targets (any one counts), search for the moves, or list every answer
interface WorkerRequest {
  kind: "measure" | "search" | "list";
  start: KPattern;
  targets: KPattern[];
  moves: string[];
  maxDepth?: number; // search and list: answers shorter than this (twips style)
  maxAnswers?: number; // list only: most answers to give (shortest first)
  minDepth?: number; // list only: answers of at least this many moves (one page of a long list)
  after?: string; // list only: answers that come after this one (same length, in the worker's turn order), so a page starts where the last one ended
  solvableWith?: string[]; // moves that may finish the goal later: the worker closes the targets under them (none = the targets as they are)
  orbitTables?: number; // untouched (BLD) steps: split tables also get one table per piece type holding all its pieces, up to this many states (0 / none = no such tables)
}

// Stop the search worker after this long without requests, so its memory goes back to the system (WebAssembly memory never shrinks);
// the next request starts a fresh worker, which loads the tables stored in this browser
const WORKER_IDLE_MS = 60_000;

// One search worker at a time, so each goal's tables (exact, split, or twips's prune table) are built once and reused
let searchWorker: Worker | null = null;
// Requests waiting for the worker's answer, by request number, with who hears about their table progress
const waiting = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void; onProgress?: (progress: TableProgress) => void }>();
// Number for the next request
let nextRequest = 0;
// Timer that stops the worker once it's idle
let idleTimer: ReturnType<typeof setTimeout> | undefined;
// The puzzle definition as JSON, without its check function (which JSON can't carry), made on first use
let puzzleJson = "";

// Stop the search worker, freeing its memory (the next request starts a fresh one)
function stopSearchWorker(): void {
  clearTimeout(idleTimer);
  searchWorker?.terminate();
  searchWorker = null;
}

// Start the search worker on first use (search-worker.js is built next to the page, so the path is page-relative)
function getSearchWorker(): Worker {
  if (searchWorker) return searchWorker;
  const worker = new Worker("search-worker.js", { type: "module" });
  // Hand each answer or error to the request that asked for it, and table progress to its listener
  worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const entry = waiting.get(data.id);
    if (data.progress) {
      entry?.onProgress?.(data.progress);
      return;
    }
    waiting.delete(data.id);
    if (data.error !== undefined) entry?.reject(new Error(data.error));
    else entry?.resolve(data);
    // Nothing left to answer: stop the worker unless another request comes soon
    if (!waiting.size) idleTimer = setTimeout(stopSearchWorker, WORKER_IDLE_MS);
  };
  // A crashed worker fails every waiting request, and the next request starts a fresh one
  worker.onerror = (event) => {
    for (const entry of waiting.values()) entry.reject(new Error(event.message || "Search worker failed."));
    waiting.clear();
    stopSearchWorker();
  };
  searchWorker = worker;
  return worker;
}

// Send one request to the shared worker (an exact table, split tables + IDA*, or twips answer it) and wait for its answer
function askWorker(request: WorkerRequest, onProgress?: (progress: TableProgress) => void): Promise<WorkerReply> {
  // A request keeps the worker alive
  clearTimeout(idleTimer);
  if (!puzzleJson) {
    const definition: Record<string, unknown> = { ...kpuzzle.definition };
    delete definition.experimentalIsPatternSolved;
    puzzleJson = JSON.stringify(definition);
  }
  const id = nextRequest++;
  return new Promise<WorkerReply>((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    getSearchWorker().postMessage({
      id,
      kind: request.kind,
      kpuzzle: puzzleJson,
      start: JSON.stringify(request.start.patternData),
      // Targets as a list, or with the moves that may finish them later (the worker closes them under those moves) and / or the whole-orbit tables to add
      targets: JSON.stringify(
        request.solvableWith?.length || request.orbitTables
          ? {
              targets: request.targets.map((target) => target.patternData),
              ...(request.solvableWith?.length ? { solvableWith: request.solvableWith } : {}),
              ...(request.orbitTables ? { orbitTables: request.orbitTables } : {}),
            }
          : request.targets.map((target) => target.patternData),
      ),
      moves: request.moves,
      maxDepth: request.maxDepth,
      maxAnswers: request.maxAnswers,
      minDepth: request.minDepth,
      after: request.after,
    });
  });
}

// One alternative × grip with all its offsets' targets (one table holds them all), measured and ready to search
interface Combo {
  alternative: number; // which of the step's alternatives
  rotation: string; // grip ("" = as held)
  goal: Goal; // the goal named in that grip (kept pieces included)
  fresh: number; // goal pieces earlier steps don't cover yet in that grip
  held: KPattern; // cube held in that grip
  start: KPattern; // held cube with the goal's hidden pieces masked
  offsets: string[]; // offsets the goal counts up to, one per target (repeated when relative groups give an offset several targets)
  targets: KPattern[]; // masked targets (solved cube turned by each offset, with each placement of the relative groups)
  bound: number; // measured distance: exact from one table, a lower bound from split tables or the pieces' own moves
  twips?: boolean; // the worker answers it with twips (no tables fit): a list gives only its one shortest answer
  cube?: KPattern; // untouched steps: the cube held in that grip as it really is (held is it relabeled, so the wanted end state is the solved cube)
  untouched?: { pieces: string; changed: string }; // untouched steps: the pieces it solves and every spot it may change (pieces text)
}

// One answer of a step: the combo it came from and its moves (after the grip rotation)
interface Answer {
  combo: Combo;
  moves: string;
}

// A step's goal in one grip, for one of its alternatives (no cube needed)
interface GripGoal {
  alternative: number; // which of the step's alternatives
  rotation: string; // grip ("" = as held)
  goal: Goal; // the goal named in that grip (kept pieces included)
  gripMatters: boolean; // the goal has orient-group pieces, which are judged from the grip (so two grips never ask for the same thing)
  fresh: number; // goal pieces earlier steps don't cover yet in that grip
}

// A step's goals worth trying from the earlier pieces (named in the grip it starts in): per alternative, its goal in each grip where earlier pieces cover the fewest
// of its pieces (a grip turn can't trade its pieces for ones already done). When no alternative adds anything, the step is already done if the cube may stay as held
// (only that grip is tried, e.g. a last pair after an XCross); otherwise it throws NOTHING_NEW rather than answer with a bare grip turn
function gripGoals(pieces: string, rotations: string[], keep: Goal | undefined, earlier: Goal | undefined): GripGoal[] {
  const perAlternative = readAlternatives(pieces).map((text, alternative) => {
    // This alternative's pieces (with kept pieces, its centers only count when typed, so the kept ones stand; :x pieces are just not checked)
    const own = dropFree(goalFromText(text, !keep));
    // Goal in one grip: the kept pieces renamed for that grip, with this alternative's pieces on top (no centers left at all = all six, like goal text)
    const goalFor = (rotation: string): Goal => {
      if (!keep) return own;
      const goal = mergeGoals(rotateGoal(keep, rotation), own);
      goal.CENTERS ??= allCenters();
      return goal;
    };
    // Its pieces as [type, number, role], centers left out (they only set the frame), to check each grip against earlier steps
    const ownPieces = Object.entries(own)
      .filter(([orbit]) => orbit !== "CENTERS")
      .flatMap(([orbit, roles]) => Object.entries(roles).map(([piece, role]) => [orbit, Number(piece), role] as const));
    // Orientation is judged from the grip, so orient-group goals can't be shared between grips
    const gripMatters = [own, keep ?? {}].some((goal) => Object.values(goal).some((roles) => Object.values(roles).some((role) => role.startsWith("orient"))));
    // Each grip: how many of its pieces earlier steps already cover there (e.g. a filled pair slot, or the solved first layer once x2 puts it on top)
    const goals = rotations.map((rotation) => {
      const before = rotateGoal(earlier ?? keep ?? {}, rotation);
      const covered = ownPieces.filter(([orbit, piece, role]) => covers(before[orbit]?.[piece], role)).length;
      return { alternative, rotation, goal: goalFor(rotation), gripMatters, covered, fresh: ownPieces.length - covered };
    });
    // Only the grips where earlier steps cover the fewest of its pieces; nothingNew: every grip only names pieces earlier steps already did
    const least = Math.min(...goals.map((goal) => goal.covered));
    return { goals: goals.filter((goal) => goal.covered === least), nothingNew: ownPieces.length > 0 && least === ownPieces.length };
  });
  // Alternatives that add something, else only the as-held grip
  const adding = perAlternative.filter((entry) => !entry.nothingNew);
  const goals = adding.length ? adding.flatMap((entry) => entry.goals) : perAlternative.flatMap((entry) => entry.goals.filter((goal) => goal.rotation === ""));
  if (!goals.length) throw new Error(NOTHING_NEW);
  return goals;
}

// Every alternative × grip combo of a step worth searching (each with all its offsets at once), measured by the worker and sorted closest first,
// plus the error to throw if none of them finds anything
async function stepCombos(scramble: string, pieces: string, options: StepOptions): Promise<{ queue: Combo[]; lastError: unknown }> {
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

// Whole-orbit tables a combo's worker requests ask for: untouched (BLD) steps get them (they make parity steps ~10–50× faster), others none
function orbitTables(combo: Combo): number | undefined {
  return combo.untouched ? ORBIT_TABLE_STATES : undefined;
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

// Search the measured combos in turn for the shortest answer (on a tie, the alternative adding more new pieces), skipping combos that can't beat the best so far
async function searchCombos(queue: Combo[], options: StepOptions, lastError: unknown): Promise<{ answer: Answer; searches: number }> {
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

// Shortest answers of untouched steps by allowed moves + relabeled start: a relabeled BLD case (a 3-cycle, a flip, a parity) doesn't depend on the rest of the cube,
// so the same case in a later step or scramble is answered at once (kept while the page is open, oldest dropped past the limit)
const knownAnswers = new Map<string, string>();
const MAX_KNOWN_ANSWERS = 5_000;

// Key of an untouched combo's answer: the allowed moves and its relabeled start
function answerKey(combo: Combo, moves: string[]): string {
  return `${moves.join(" ")}/${cellsKey(cellsOf(combo.start))}`;
}

// What's known of an untouched combo's shortest answer without searching: "" when it's at the goal already, a remembered answer, or undefined
function knownAnswer(combo: Combo, moves: string[]): string | undefined {
  if (!combo.untouched) return undefined;
  if (combo.targets.some((target) => target.isIdentical(combo.start))) return "";
  return knownAnswers.get(answerKey(combo, moves));
}

// One combo's shortest answer within maxDepth moves (Infinity = no limit): known already, or searched by the worker (which only finds answers shorter than
// the maxDepth it gets, hence + 1); throws "No solution found!" when there's none
async function searchCombo(combo: Combo, options: StepOptions, maxDepth: number): Promise<string> {
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  const known = knownAnswer(combo, generatorMoves);
  if (known !== undefined) {
    if (countMoves(known) > maxDepth) throw new Error("No solution found!");
    return known;
  }
  const reply = await askWorker(
    {
      kind: "search",
      start: combo.start,
      targets: combo.targets,
      moves: generatorMoves,
      solvableWith: options.solvableWith,
      orbitTables: orbitTables(combo),
      ...(Number.isFinite(maxDepth) ? { maxDepth: maxDepth + 1 } : {}),
    },
    options.onProgress,
  );
  const moves = reply.moves ?? "";
  // An untouched combo's answer is its shortest one (the search deepens one move at a time): remember it
  if (combo.untouched) {
    if (knownAnswers.size >= MAX_KNOWN_ANSWERS) knownAnswers.delete(knownAnswers.keys().next().value!);
    knownAnswers.set(answerKey(combo, generatorMoves), moves);
  }
  return moves;
}

// A step's result for one answer: the grip rotation and moves, the offset it reached (the target the cube matches after it, or with solvable-with moves
// the one those moves reach; a lone target needs no check), and the pieces it left for good
function stepResult({ combo, moves }: Answer, searches: number, solvableWith: string[] = []): StepResult {
  const end = maskPattern(combo.held.applyAlg(moves), combo.goal);
  const reached = !solvableWith.length
    ? combo.targets.findIndex((target) => end.isIdentical(target))
    : combo.targets.length > 1
      ? solvableIndex(end, combo.targets, solvableWith)
      : 0;
  const offset = combo.offsets[Math.max(0, reached)];
  // Pieces it solved (an untouched step: the ones it sent home, not the whole cube it was relabeled to), and the ones later steps may keep (the solvable-with moves may still move the others)
  const pieces = combo.untouched?.pieces ?? goalToText(combo.goal);
  const settled = solvableWith.length ? goalToText(settledGoal(combo.goal, solvableWith)) : pieces;
  return {
    solution: new Alg(joinMoves(combo.rotation, moves)),
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
// The worker first measures every combo (exact distance from one table, or a lower bound from split tables), so only combos that can still win are searched
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  return stepResult(answer, searches, options.solvableWith);
}

// Most answers stepCandidates gives by default (each one costs a run of the next steps when a method looks ahead)
export const MAX_CANDIDATES = 64;

// Options for listing a step's answers: solveStep's, plus how much longer than the shortest an answer may be, and how many to give
export interface CandidateOptions extends StepOptions {
  extraMoves?: number; // answers up to this many moves longer than the step's shortest count too (default 0: the shortest answers only)
  maxCandidates?: number; // most answers given (default MAX_CANDIDATES), shortest first
}

// Answers a step could take, for looking ahead: solveStep's answer first, then every other answer of every alternative × grip × offset up to extraMoves longer
// (shortest first, then the ones adding more new pieces, then the closest combos). Answers leaving the cube the same way count once, and an answer never
// passes through the goal on its way (that would be a shorter answer plus moves that keep the goal, which the next steps can always make themselves)
export async function stepCandidates(scramble: string, pieces: string, options: CandidateOptions = {}): Promise<StepResult[]> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  const shortest = countMoves(answer.moves);
  const most = Math.max(1, options.maxCandidates ?? MAX_CANDIDATES);
  // Longest answer that still counts: the shortest plus the extra moves, within the user's limit
  const longest = Math.min(shortest + Math.max(0, options.extraMoves ?? 0), options.maxDepth ?? Infinity);
  // How an answer leaves the cube (grip and every piece, as it really is: untouched steps' held cubes are relabeled), so answers leaving it the same way count once
  const leaves = ({ combo, moves }: Answer) => `${combo.rotation}/${JSON.stringify((combo.cube ?? combo.held).applyAlg(moves).patternData)}`;
  const seen = new Set([leaves(answer)]);
  const found: { answer: Answer; length: number; order: number }[] = [];
  let lists = 0;
  // A step that's already done (0 moves) has nothing else worth trying, and one candidate is just the shortest answer
  if (shortest > 0 && most > 1) {
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
            maxAnswers: most,
          },
          options.onProgress,
        );
        for (const moves of reply.answers ?? []) {
          const candidate = { combo, moves };
          const key = leaves(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ answer: candidate, length: countMoves(moves), order });
        }
      } catch {
        // No answer within the limit for this combo
      }
    }
  }
  // Shortest first, then the ones adding more new pieces, then the closest combos (the sort keeps each list's own order on ties)
  found.sort((a, b) => a.length - b.length || b.answer.combo.fresh - a.answer.combo.fresh || a.order - b.order);
  return [answer, ...found.slice(0, most - 1).map((entry) => entry.answer)].map((entry) => stepResult(entry, searches + lists, options.solvableWith));
}

// Solve the whole cube, judged by its centers in the grip it's held in
export async function solveFull(scramble: string, done = ""): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(joinMoves(scramble, done)));
}

// Check that scramble + done (earlier steps and this solution) really reaches the goal, in the grip it ends in, up to any of the step's offsets
// (and with solvable-with moves, up to what those moves can still do); with alternatives, any one counts (pieces = null means the whole cube, where neither applies).
// For a step that keeps every other piece untouched, `untouched` also asks that every spot but the changed ones holds what it held before the step
// (from = the moves before it, plus its grip rotation)
export function reachesGoal(
  scramble: string,
  done: string,
  pieces: string | null,
  offsets = [""],
  solvableWith: string[] = [],
  untouched?: { from: string; changed: string },
): boolean {
  // Full goal: every piece home, judged by the centers
  if (pieces === null) {
    return heldPattern(joinMoves(scramble, done)).experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  }
  // Step goal: some alternative's pieces match the solved cube turned by one of the offsets (relative groups anywhere they fit), everything else hidden
  const held = heldPattern(scramble, done);
  if (untouched && !keptOthers(heldPattern(scramble, untouched.from), held, goalFromText(untouched.changed, false))) return false;
  return splitAlternatives(pieces).some((text) => {
    const goal = dropFree(goalFromText(text));
    const reached = maskPattern(held, goal);
    const targets = (offsets.length ? offsets : [""]).flatMap((offset) => goalTargets(goal, offset));
    // With solvable-with moves, a target those moves can reach from here counts too
    return solvableWith.length ? solvableIndex(reached, targets, solvableWith) >= 0 : targets.some((target) => reached.isIdentical(target));
  });
}

// True when every spot but the changed ones holds the same piece, turned the same way (where twists count), in both patterns
function keptOthers(before: KPattern, after: KPattern, changed: Goal): boolean {
  return kpuzzle.definition.orbits.every(({ orbitName, numOrientations }) => {
    const [was, now] = [before.patternData[orbitName], after.patternData[orbitName]];
    const twists = countedTwists(orbitName, numOrientations);
    return was.pieces.every(
      (piece, spot) => changed[orbitName]?.[spot] !== undefined || (now.pieces[spot] === piece && now.orientation[spot] % twists === was.orientation[spot] % twists),
    );
  });
}

// Number of moves in an alg (R2 counts as one, whole-cube rotations don't count)
export function countMoves(alg: string): number {
  return Array.from(new Alg(alg).experimentalLeafMoves()).filter((move) => !ROTATIONS.includes(move.family)).length;
}

// Read method data (e.g. parsed JSON) into a Method with every field filled in, in a fixed order; throws a clear error on a bad field
export function readMethod(data: unknown): Method {
  const method = (data ?? {}) as Partial<Method>;
  if (!Array.isArray(method.steps)) throw new Error("A method needs a list of steps.");
  return { name: String(method.name ?? "").trim() || "Untitled method", steps: method.steps.map(readStep) };
}

// Read one step's data, filling defaults (D bottom, face turns, no offsets or solvable-with moves, nothing untouched, no buffer, no limit, no lookahead, no repeat)
// and checking pieces, grips, offsets, solvable-with moves, the BLD fields, moves and lookahead
function readStep(data: unknown, index: number): StepConfig {
  const step = (data ?? {}) as Partial<StepConfig>;
  const typed = String(step.name ?? "").trim();
  const name = typed || `Step ${index + 1}`;
  try {
    // BLD buffer (a buffer step traces its own pieces, so its pieces text stays empty)
    const buffer = bufferFromText(String(step.buffer ?? ""));
    // Goal pieces: alternatives written with " | " (a JSON list counts as alternatives too), no typos, and at least one piece unless the step keeps earlier ones or has a buffer
    const keep = Boolean(step.keep);
    const given: unknown = step.pieces;
    const pieces = readAlternatives(Array.isArray(given) ? given.join("|") : String(given ?? ""), !keep && !buffer).join(" | ");
    if (buffer && pieces) throw new Error("A step with a buffer picks its own pieces (the next targets of the buffer's cycle): leave its pieces empty.");
    // Grips: faces that may go on the bottom
    const bottom = (step.grips?.bottom ?? ["D"]).map((face) => String(face).toUpperCase());
    if (!bottom.length || !bottom.every((face) => Object.hasOwn(BOTTOM_TURNS, face))) throw new Error("Bottom faces must be some of U D F B R L.");
    // Offsets text (checked by reading it)
    const offsets = String(step.offsets ?? "").trim();
    offsetsFromText(offsets);
    // Solvable-with moves (checked by reading them, written back one space apart)
    const solvableWith = solvableFromText(String(step.solvableWith ?? "")).join(" ");
    // Untouched (always with a buffer): no offsets or solvable-with moves, and only solved / :p / :x pieces
    const untouched = Boolean(step.untouched) || Boolean(buffer);
    if (untouched && (offsets || solvableWith)) throw new Error(UNTOUCHED_MIX);
    if (untouched) for (const alternative of splitAlternatives(pieces)) checkUntouchedRoles(goalFromText(alternative));
    // BLD targets per step (a whole number from 1) and parity pieces
    const targetsPerStep = Number(step.targetsPerStep ?? 2);
    if (!(Number.isInteger(targetsPerStep) && targetsPerStep >= 1)) throw new Error("Targets per step must be a whole number from 1 (2 = 3-cycles).");
    const parity = parityFromText(String(step.parity ?? ""));
    // Allowed moves: one real move per entry, no whole-cube turns
    const moves = (step.moves ?? FACE_MOVES).map((move) => parseMoves(String(move)));
    if (!moves.length || moves.some((move) => !move || /\s/.test(move) || rotationsIn(move))) {
      throw new Error("Allowed moves must be a list of single moves without x, y, z.");
    }
    // Depth limit: a whole number, or null for none
    const maxDepth = step.maxDepth == null ? null : Number(step.maxDepth);
    if (maxDepth !== null && !(Number.isInteger(maxDepth) && maxDepth >= 0)) throw new Error("Max depth must be a whole number (or null for no limit).");
    // Lookahead: later steps that judge this step's answers, and how many moves longer than the shortest a candidate may be (0 = none)
    const lookahead = Number(step.lookahead ?? 0);
    const extraMoves = Number(step.extraMoves ?? 0);
    if (![lookahead, extraMoves].every((value) => Number.isInteger(value) && value >= 0)) throw new Error("Lookahead and extra moves must be whole numbers (0 = none).");
    return {
      name,
      pieces,
      keep,
      grips: { bottom, anyFront: Boolean(step.grips?.anyFront) },
      offsets,
      solvableWith,
      untouched,
      buffer,
      targetsPerStep,
      parity,
      moves,
      maxDepth,
      firstFound: Boolean(step.firstFound),
      lookahead,
      extraMoves,
      repeat: Boolean(step.repeat),
    };
  } catch (error) {
    // Say which step is wrong (by number, plus its name when it has one)
    throw new Error(`Step ${index + 1}${typed ? ` (${typed})` : ""}: ${(error as Error).message}`);
  }
}

// Search options for one step of a method, from where earlier steps left the cube (done), with their pieces named in the grip the step starts in (earlier)
function methodStepOptions(step: StepConfig, done: string, earlier: Goal, onProgress?: (progress: TableProgress) => void): StepOptions {
  return {
    generatorMoves: step.moves,
    maxDepth: step.maxDepth ?? undefined,
    rotations: gripRotations(step.grips.bottom, step.grips.anyFront),
    done,
    offsets: offsetsFromText(step.offsets),
    solvableWith: solvableFromText(step.solvableWith ?? ""),
    firstFound: step.firstFound,
    keep: step.keep ? earlier : undefined,
    earlier,
    untouched: step.untouched,
    buffer: step.buffer,
    targetsPerStep: step.targetsPerStep,
    parity: step.parity,
    onProgress,
  };
}

// Earlier pieces after a step: they follow its grip turn, then the pieces it left for good join them (later roles win; with solvable-with moves,
// pieces those moves would still move stay out, so a later step that keeps earlier pieces doesn't hold them in place)
function piecesAfter(earlier: Goal, result: Pick<StepResult, "rotation" | "settled">): Goal {
  return mergeGoals(rotateGoal(earlier, result.rotation), goalFromText(result.settled));
}

// Run a method's steps in order, each from where the earlier ones left the cube (start = scramble, then options.done).
// A step with lookahead lists its candidate answers and takes the one with the fewest moves over it and its next steps (each of those solved its own shortest way)
export async function runMethod(scramble: string, method: Method, options: MethodOptions = {}): Promise<MethodResult> {
  const steps: MethodStepResult[] = [];
  // Moves after the scramble so far, always passed as done (never folded into the scramble), so only their x, y, z change the grip
  let done = options.done ?? "";
  // Every earlier step's pieces, named in the grip the next step starts in
  let earlier: Goal = {};
  // Each step's own shortest answer from a given state, solved once per run (lookahead visits many states, and the run itself may reach one of them again)
  const ownAnswers = new Map<string, Promise<StepResult>>();
  const solveOwn = (index: number, from: string, before: Goal): Promise<StepResult> => {
    const key = `${index}\n${from}\n${goalToText(before)}`;
    let answer = ownAnswers.get(key);
    if (!answer) {
      const step = method.steps[index];
      answer = solveStep(scramble, step.pieces, methodStepOptions(step, from, before, options.onProgress));
      ownAnswers.set(key, answer);
    }
    return answer;
  };
  // Moves the next `count` steps after step `index` take, each its own shortest answer, from where `from` leaves the cube (Infinity when one of them finds nothing).
  // A repeated step comes back until a round has nothing left (0 moves, or nothing new), then the step after it; those empty rounds don't count
  const movesAhead = async (index: number, count: number, from: string, before: Goal): Promise<number> => {
    let total = 0;
    // Step that ran last, and whether it runs again next
    let at = index;
    let again = Boolean(method.steps[index].repeat);
    for (let judged = 0; judged < count; ) {
      const next = again ? at : at + 1;
      if (next >= method.steps.length) break;
      let result: StepResult;
      try {
        result = await solveOwn(next, from, before);
      } catch (error) {
        // A repeated step with nothing new left is finished: go on with the next step
        if (again && (error as Error).message === NOTHING_NEW) {
          again = false;
          continue;
        }
        return Infinity;
      }
      const solution = result.solution.toString();
      const moves = countMoves(solution);
      // Same when its round has nothing to do
      if (again && !moves) {
        again = false;
        continue;
      }
      total += moves;
      from = joinMoves(from, solution);
      before = piecesAfter(before, result);
      judged++;
      at = next;
      again = Boolean(method.steps[next].repeat) && moves > 0;
    }
    return total;
  };
  for (const [index, step] of method.steps.entries()) {
    // Rounds of this step: one, or with repeat as many as it finds something to do (each listed as "name 1", "name 2"…)
    for (let round = 1; ; round++) {
      options.onStart?.(index, round);
      const started = performance.now();
      // Later steps (or rounds) that judge this step's answers (none past the last step)
      const ahead = step.repeat ? (step.lookahead ?? 0) : Math.min(step.lookahead ?? 0, method.steps.length - 1 - index);
      let result: StepResult;
      let lookahead: MethodStepResult["lookahead"] = null;
      try {
        if (ahead > 0) {
          // Every candidate answer, judged by its own moves plus the next steps' own shortest answers (all asked at once: the worker answers them in turn)
          const candidates = await stepCandidates(scramble, step.pieces, { ...methodStepOptions(step, done, earlier, options.onProgress), extraMoves: step.extraMoves ?? 0 });
          const totals = await Promise.all(
            candidates.map(async (candidate) => {
              const solution = candidate.solution.toString();
              return countMoves(solution) + (await movesAhead(index, ahead, joinMoves(done, solution), piecesAfter(earlier, candidate)));
            }),
          );
          // Fewest moves in total wins; on a tie the earlier candidate (the step's own shortest answer comes first)
          const winner = totals.indexOf(Math.min(...totals));
          result = candidates[winner];
          lookahead = { candidates: candidates.length, steps: ahead, total: Number.isFinite(totals[winner]) ? totals[winner] : null };
        } else {
          // Search this step from where the last one ended, keeping the earlier pieces if it asks to
          result = await solveOwn(index, done, earlier);
        }
      } catch (error) {
        // A repeated step with nothing new left is finished
        if (round > 1 && (error as Error).message === NOTHING_NEW) break;
        // Say which step found nothing
        throw new Error(`${step.repeat ? `${step.name} ${round}` : step.name}: ${(error as Error).message}`);
      }
      const ms = performance.now() - started;
      const solution = result.solution.toString();
      // A repeated step whose round has nothing to do is finished (its first round is listed even then)
      if (round > 1 && !countMoves(solution)) break;
      // Earlier pieces follow the step's grip turn, then this step's pieces join them (later roles win)
      earlier = piecesAfter(earlier, result);
      // Record the step, checked on its own goal and offsets (and, when it keeps every other piece untouched, on those pieces too)
      const finished = methodRow(scramble, method, index, round, done, result, ms, lookahead);
      steps.push(finished);
      options.onStep?.(finished, index);
      done = joinMoves(done, solution);
      // One round only, or nothing left to do
      if (!step.repeat || !finished.moves) break;
      if (round >= MAX_REPEATS) throw new Error(`${step.name}: still finding something to do after ${MAX_REPEATS} rounds.`);
    }
  }
  // Totals over all steps
  return methodTotals(steps, earlier);
}

// One finished step of a method run: its result, named (numbered by round for a repeated step), with the moves before it, its offsets and solvable-with moves,
// and the check that it really reaches its goal (and, when it keeps every other piece untouched, that those stay)
function methodRow(scramble: string, method: Method, index: number, round: number, done: string, result: StepResult, ms: number, lookahead: MethodStepResult["lookahead"]): MethodStepResult {
  const step = method.steps[index];
  const offsets = offsetsFromText(step.offsets);
  const solvableWith = solvableFromText(step.solvableWith ?? "");
  const solution = result.solution.toString();
  const after = joinMoves(done, solution);
  const untouched = result.changed === undefined ? undefined : { from: joinMoves(done, result.rotation), changed: result.changed };
  return {
    ...result,
    name: step.repeat ? `${step.name} ${round}` : step.name,
    step: index,
    done,
    offsets,
    solvableWith,
    moves: countMoves(solution),
    ms,
    ok: reachesGoal(scramble, after, result.pieces, offsets, solvableWith, untouched),
    lookahead,
  };
}

// A whole method run from its steps: every solution in order, every step's pieces (named in the grip the run ends in), the offset the last step left in, and the totals
function methodTotals(steps: MethodStepResult[], pieces: Goal): MethodResult {
  return {
    steps,
    solution: joinMoves(...steps.map((step) => step.solution.toString())),
    pieces: goalToText(pieces),
    offset: steps.at(-1)?.offset ?? "",
    moves: steps.reduce((sum, step) => sum + step.moves, 0),
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    ok: steps.every((step) => step.ok),
  };
}

// Most goals one later step may have from a step start, and most ways the steps before it may have gone, for a method search's lower bound
// (past either, the goal walk stops before that step)
const MAX_LATER_GOALS = 64;
const MAX_WALK_STATES = 256;

// A goal a later step of a method may have, seen from a step start: named in the grip that step would search in (a rotation from the start's grip),
// with every move the steps up to it may use (named in that grip too) and its offsets' targets (each offset group apart: one measure each) and solvable-with moves.
// The fewest moves to it from the start is a lower bound on the rest of the run
interface LaterGoal {
  rotation: string;
  goal: Goal;
  moves: string[];
  targets: KPattern[][];
  solvableWith: string[];
}

// One way the steps from a step start may have gone, as the goal walk follows them: the grip they end in (from the start's grip), the earlier pieces
// named in that grip, and every move they may have used (named as the start holds the cube, see turnName)
interface WalkState {
  rotation: string;
  earlier: Goal;
  turns: string[];
}

// Goals the later steps of a method may have from the start of step `index` (earlier pieces named in its grip), found without the cube: every step's alternatives
// and grips are followed with the rules a run uses (kept pieces, grips where earlier pieces cover the fewest of its pieces, the pieces it leaves for good).
// Per later step, its goals, each once; only the steps whose pieces the next step doesn't keep (a step keeping them asks for more: CFOP's last pair, F2L, stands for
// the pairs before it), plus the last step reached. The walk stops after a repeated step's first round (more rounds may follow), before a step that keeps every other
// piece untouched (its goal depends on the cube), and where goals or ways get too many; a repeated or untouched step itself gives none
function laterGoals(steps: StepConfig[], index: number, earlier: Goal): LaterGoal[][] {
  const later: { index: number; goals: LaterGoal[] }[] = [];
  // The last step reached stands for the rest, and so does every step whose pieces the next one doesn't keep
  const standing = () => later.filter((entry, at) => at === later.length - 1 || !steps[entry.index + 1].keep).map((entry) => entry.goals);
  if (steps[index].repeat || steps[index].untouched || steps[index].buffer) return [];
  let states: WalkState[] = [{ rotation: "", earlier, turns: [] }];
  for (let at = index; at < steps.length && states.length; at++) {
    const step = steps[at];
    if (at > index && (step.untouched || step.buffer)) break;
    const offsets = offsetsFromText(step.offsets);
    const solvableWith = solvableFromText(step.solvableWith ?? "");
    const rotations = gripRotations(step.grips.bottom, step.grips.anyFront);
    // This step's goals, each once (by what it asks of the cube as the start holds it), and the ways on after it
    const goals = new Map<string, LaterGoal>();
    const next = new Map<string, WalkState>();
    for (const state of states) {
      let options: GripGoal[];
      try {
        options = gripGoals(step.pieces, rotations, step.keep ? state.earlier : undefined, state.earlier);
      } catch {
        // Nothing new for this step this way: a run can't go on like that
        continue;
      }
      for (const { rotation, goal, gripMatters } of options) {
        // The grip the step searches in (from the start's grip), and every move used up to it, named as the start holds the cube
        const grip = netRotation(joinMoves(state.rotation, rotation));
        const own = step.moves.map((move) => moveInGrip(move, grip, ""));
        if (own.includes(null)) return standing();
        const turns = distinctTurns([...state.turns, ...(own as string[])]);
        if (at > index) {
          // Those moves named in the step's grip (a list some step uses when it's the same turns), and its goal's targets per offset group
          const moves = movesForGrip(turns, grip, [step.moves, ...steps.slice(index, at).map((earlierStep) => earlierStep.moves), FACE_MOVES]);
          if (!moves) return standing();
          const key = [
            goalToText(rotateGoal(goal, invertMoves(grip))),
            movesKey(grip, moves),
            gripMatters ? grip : "",
            offsets.map((offset) => movesKey(grip, [offset])).join("&"),
            movesKey(grip, solvableWith),
          ].join("/");
          if (!goals.has(key)) {
            // Each offset group's targets, each once (too many relative-group placements: the walk stops before this step)
            let targets: KPattern[][];
            try {
              targets = offsetGroups(offsets, moves).map((group) => {
                const seen = new Set<string>();
                return group.flatMap((offset) => reachableTargets(goalTargets(goal, offset), moves)).filter((target) => {
                  const cells = cellsKey(cellsOf(target));
                  return !seen.has(cells) && Boolean(seen.add(cells));
                });
              });
            } catch {
              return standing();
            }
            goals.set(key, { rotation: grip, goal, moves, targets, solvableWith });
          }
        }
        // The earlier pieces after it, as a run's piecesAfter makes them
        const after = piecesAfter(state.earlier, { rotation, settled: goalToText(solvableWith.length ? settledGoal(goal, solvableWith) : goal) });
        const key = `${grip}/${goalToText(after)}/${turns.join(" ")}`;
        if (!next.has(key)) next.set(key, { rotation: grip, earlier: after, turns });
      }
    }
    if (at > index) {
      if (!goals.size || goals.size > MAX_LATER_GOALS) break;
      later.push({ index: at, goals: [...goals.values()] });
      if (step.repeat) break;
    }
    states = next.size > MAX_WALK_STATES ? [] : [...next.values()];
  }
  return standing();
}

// Fewest moves a later step's goal needs from the cube after `scramble` then `done`: the closest offset group's measure (a lower bound; 0 when the worker
// can't tell, e.g. twips; Infinity when the moves can't reach it)
async function measureLater(scramble: string, done: string, later: LaterGoal, onProgress?: (progress: TableProgress) => void): Promise<number> {
  const start = maskPattern(heldInGrip(scramble, done, later.rotation), later.goal);
  const measures = later.targets.map(async (group) => {
    // Only targets whose centers the moves can bring home (as in stepCombos)
    const targets = group.filter((target) => centersReachable(start, target, later.moves));
    if (!targets.length) return Infinity;
    try {
      const { bound, exact } = await askWorker({ kind: "measure", start, targets, moves: later.moves, solvableWith: later.solvableWith }, onProgress);
      return exact ? (bound ?? Infinity) : (bound ?? 0);
    } catch {
      return 0;
    }
  });
  return Math.min(...(await Promise.all(measures)));
}

// Fewest moves the rest of a run needs from a step start, from the later steps' goals: each step's closest goal, the largest of those (0 = no later goals)
async function laterBound(scramble: string, done: string, goals: LaterGoal[][], onProgress?: (progress: TableProgress) => void): Promise<number> {
  const perStep = await Promise.all(goals.map(async (options) => Math.min(...(await Promise.all(options.map((later) => measureLater(scramble, done, later, onProgress)))))));
  return Math.max(0, ...perStep);
}

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
