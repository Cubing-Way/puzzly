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
// orientN = turned right anywhere on group N's spots, swapN = anywhere on group N's spots with any turn
export type Role = "solve" | "place" | `orient${number}` | `swap${number}`;

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
   // Stop at the first grip × offset that finds an answer (within maxDepth) instead of comparing them all for the shortest
  firstFound?: boolean;
  // Earlier steps' pieces to keep solved too, named in the grip the step starts in (this step's roles win on conflicts)
  keep?: Goal;
  // Pieces earlier steps already did, named in the grip the step starts in (with or without keep), so no grip turn can pass them off as this step's pieces (default: keep)
  earlier?: Goal;
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
  alternative: number; // which of the step's alternatives won (0 = the first, or the only one)
  searches: number; // searches actually run (combos asking for the same thing, or whose measured distance can't beat the best, are skipped)
}

// One step of a method, as plain data (what users edit and save as JSON)
export interface StepConfig {
  name: string;
  pieces: string; // goal text, e.g. "DFR FR" or "UF:o UR:o…"; alternatives split by " | " (any one counts, e.g. "DF DR DB DL | DF DR DB DL DFR FR")
  keep?: boolean; // also keep every earlier step's pieces solved
  grips: { bottom: string[]; anyFront: boolean }; // faces that may go on the bottom, and whether y turns pick the front too
  offsets: string; // offsets text, e.g. "D D2 D'" ("" = none)
  moves: string[]; // moves the search may use, e.g. ["U", "R", "L"]
  maxDepth?: number | null; // longest solution to look for (null = no limit)
  firstFound?: boolean; // stop at the first grip × offset with an answer
  lookahead?: number; // later steps that judge this step's answers: each candidate is followed by that many steps (each its own shortest way), fewest moves in total wins (0 = none, the step's own shortest)
  extraMoves?: number; // with lookahead: candidates may be this many moves longer than the step's shortest answer (0 = the shortest answers only)
}

// A whole method: steps run in order, each from where the last one left the cube
export interface Method {
  name: string;
  steps: StepConfig[];
}

// One finished step of a method run
export interface MethodStepResult extends StepResult {
  name: string; // step name
  done: string; // moves before this step (after the scramble)
  offsets: string[]; // offsets the step's goal counted up to
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

// Sort a name's letters so "UR", "RU" and "ur" all mean the same piece
export function normalizeName(name: string): string {
  return name.toUpperCase().split("").sort().join("");
}

// Join move texts with spaces, skipping empty ones
export function joinMoves(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

// Read a role suffix: "" = solve, ":p" = place, ":o" / ":o2"… = oriented in group 1 / 2…, ":s" / ":s2"… = swap group (null if it isn't one)
export function roleFromSuffix(suffix: string): Role | null {
  const tag = suffix.toLowerCase();
  if (tag === "") return "solve";
  if (tag === ":p") return "place";
  // Group roles: letter, then an optional group number (1 when left out)
  const group = /^:([os])([1-9]\d*)?$/.exec(tag);
  if (!group) return null;
  return `${group[1] === "o" ? "orient" : "swap"}${Number(group[2] ?? 1)}` as Role;
}

// Suffix that writes a role in goal text ("" for solve, ":o" for group 1, ":o2" for group 2…)
export function roleSuffix(role: Role): string {
  if (role === "solve") return "";
  if (role === "place") return ":p";
  // Group roles: first letter, plus the group number unless it's 1
  const group = role.replace(/^\D+/, "");
  return `:${role[0]}${group === "1" ? "" : group}`;
}

// True for roles whose pieces share one id per group (orient and swap groups)
function isGroupRole(role: Role): boolean {
  return role.startsWith("orient") || role.startsWith("swap");
}

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
      const list = orbit ? PIECE_NAMES[orbit] : undefined;
      // Find the piece's number in that type's list
      const index = list ? list.findIndex((n) => normalizeName(n) === normalizeName(name)) : -1;
      // Stop with a clear message on a typo
      if (!orbit || index === -1) throw new Error(`Unknown piece: "${name}"`);
      if (!role) throw new Error(`Unknown role in "${word}" (use :o, :o2…, :s, :s2… or :p)`);
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

// True when a kept role already asks at least as much as a step's role (solved covers every role, in place covers swap groups)
function covers(kept: Role | undefined, role: Role): boolean {
  return kept === role || kept === "solve" || (kept === "place" && role.startsWith("swap"));
}


// Combine two goals into a new one; `over`'s role wins for a piece in both
export function mergeGoals(base: Goal, over: Goal): Goal {
  const merged: Goal = {};
  for (const goal of [base, over]) for (const [orbit, roles] of Object.entries(goal)) Object.assign((merged[orbit] ??= {}), roles);
  return merged;
}

// Hide what the goal doesn't check: each group (and the ignored pieces) shares one id, place / swap / ignored pieces may be turned any way
export function maskPattern(pattern: KPattern, goal: Goal): KPattern {
  // Copy the data so the original pattern isn't changed
  const data = structuredClone(pattern.patternData);
  // Go through each piece type: EDGES, CORNERS, CENTERS
  for (const [orbitName, orbit] of Object.entries(data)) {
    // Role of each goal piece of this type (not listed = ignored)
    const roles = goal[orbitName] ?? {};
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

// Load the cube definition; await this once before using the engine
export async function loadEngine(): Promise<void> {
  kpuzzle = await cube3x3x3.kpuzzle();
  // Remember where the centers end up for each of the 24 grips
  for (const grip of ALL_GRIPS) gripByCenters.set(centerLayout(kpuzzle.defaultPattern().applyAlg(grip)), grip);
}

// Center numbers in spot order, as a lookup key
function centerLayout(pattern: KPattern): string {
  return pattern.patternData["CENTERS"].pieces.join();
}

// Whole-cube rotation hidden in a move sequence (rotations, slices or wide moves), found from where the centers ended up
function netRotation(moves: string): string {
  return gripByCenters.get(centerLayout(kpuzzle.defaultPattern().applyAlg(moves))) ?? "";
}

// Only the x, y, z rotations of a move sequence, in order
function rotationsIn(moves: string): string {
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
function heldPattern(scramble: string, done = ""): KPattern {
  return kpuzzle.defaultPattern().applyAlg(new Alg(gripAfter(scramble, done)).invert()).applyAlg(joinMoves(scramble, done));
}

// Goal (text or roles) renumbered to the actual pieces that fill its spots in the grip after `scramble` then `done` (e.g. for the viewer's mask)
export function goalOnCube(goal: string | Goal, scramble: string, done = ""): Goal {
  // Solved cube held in that grip: the piece at each spot is the one that belongs there
  const homes = kpuzzle.defaultPattern().applyAlg(gripAfter(scramble, done)).patternData;
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
  const turned = kpuzzle.defaultPattern().applyAlg(rotation).patternData;
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

// New random-state 3x3x3 scramble
export async function randomScramble(): Promise<string> {
  return (await randomScrambleForEvent("333")).toString();
}

// Allowed moves as turns of the cube itself in this grip (rotation, move, rotation back), so grips only merge when they allow the same turns
function movesKey(rotation: string, moves: string[]): string {
  const back = new Alg(rotation).invert().toString();
  return moves
    .map((move) => JSON.stringify(kpuzzle.defaultPattern().applyAlg(joinMoves(rotation, move, back)).patternData))
    .sort()
    .join("|");
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
  return maskPattern(kpuzzle.defaultPattern().applyAlg(offset), goal);
}


// How one piece type moves on its own: a piece state is spot × twists + twist, and each allowed move (R, R2, R' count apart) maps every state to the next
interface PieceMoves {
  twists: number; // twist values a piece of this type can have
  next: number[][]; // one lookup per allowed move: state before → state after
}

// Lookups for each piece type under the allowed moves, so a single piece's distance can be found without touching the rest of the cube
function pieceMoves(moves: string[]): Record<string, PieceMoves> {
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

// How easy a grip × offset looks: each goal piece's own fewest moves to a spot the goal accepts.
// The largest is a sure lower bound on the answer (bound); the sum ranks how far off the goal looks overall (total)
function estimate(held: KPattern, start: KPattern, target: KPattern, goal: Goal, tables: Record<string, PieceMoves>): { bound: number; total: number } {
  let bound = 0;
  let total = 0;
  for (const [orbitName, table] of Object.entries(tables)) {
    const roles = goal[orbitName] ?? {};
    const now = held.patternData[orbitName];
    const masked = start.patternData[orbitName];
    const want = target.patternData[orbitName];
    now.pieces.forEach((piece, spot) => {
      // Pieces the goal ignores don't count
      if (!roles[piece]) return;
      // A state is accepted when its spot wants this piece's (shared) id, with the right twist unless the twist is ignored there
      const id = masked.pieces[spot];
      const accepts = (state: number) => {
        const at = Math.floor(state / table.twists);
        const mod = want.orientationMod?.[at] || table.twists;
        return want.pieces[at] === id && (state % table.twists) % mod === want.orientation[at] % mod;
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
      targets: JSON.stringify(request.targets.map((target) => target.patternData)),
      moves: request.moves,
      maxDepth: request.maxDepth,
      maxAnswers: request.maxAnswers,
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
  offsets: string[]; // offsets the goal counts up to, one per target
  targets: KPattern[]; // masked targets (solved cube turned by each offset)
  bound: number; // measured distance: exact from one table, a lower bound from split tables or the pieces' own moves
}

// One answer of a step: the combo it came from and its moves (after the grip rotation)
interface Answer {
  combo: Combo;
  moves: string;
}

// Every alternative × grip combo of a step worth searching (each with all its offsets at once), measured by the worker and sorted closest first,
// plus the error to throw if none of them finds anything
async function stepCombos(scramble: string, pieces: string, options: StepOptions): Promise<{ queue: Combo[]; lastError: unknown }> {
  const keep = options.keep;
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  // Offsets the goal may be reached up to (an empty list means no offset), in groups that share one table
  const groups = offsetGroups(options.offsets?.length ? options.offsets : [""], generatorMoves);
  // Last error seen (shown if no combo finds anything)
  let lastError: unknown = null;
  // What each combo asks for: two combos asking for the same thing give the same answers
  const asked = new Set<string>();
  // How each piece moves under the allowed moves, for the easy-looking scores
  const tables = pieceMoves(generatorMoves);
  // Each grip once: earlier steps then the grip's rotation, the cube held that way, and the earlier steps' pieces named in that grip
  const grips = (options.rotations ?? [""]).map((rotation) => {
    const done = joinMoves(options.done ?? "", rotation);
    return { rotation, done, held: heldPattern(scramble, done), before: rotateGoal(options.earlier ?? keep ?? {}, rotation) };
  });
  // Each alternative's combos (grips × offsets), keeping only its grips where earlier steps cover the fewest of its pieces
  const perAlternative = readAlternatives(pieces).map((text, alternative) => {
    // This alternative's pieces (with kept pieces, its centers only count when typed, so the kept ones stand)
    const own = goalFromText(text, !keep);
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
    // Every grip with every offset group
    const combos = grips.flatMap(({ rotation, done, held, before }) => {
      // Start = cube held in this grip, with the goal's hidden pieces masked
      const goal = goalFor(rotation);
      const start = maskPattern(held, goal);
      // How many of its pieces earlier steps already cover in this grip (e.g. a filled pair slot, or the solved first layer once x2 puts it on top)
      const covered = ownPieces.filter(([orbit, piece, role]) => covers(before[orbit]?.[piece], role)).length;
      const fresh = ownPieces.length - covered;
      // Targets already used in this grip (an offset the goal can't see repeats one, so it's dropped)
      const seen: KPattern[] = [];
      return groups.flatMap((group) => {
        // Each offset's target = solved cube turned by the offset, with the same pieces hidden (offsets are named in the grip, like the goal's spots)
        const offsets: string[] = [];
        const targets: KPattern[] = [];
        for (const offset of group) {
          const target = maskedTarget(goal, offset);
          if (seen.some((other) => other.isIdentical(target))) continue;
          seen.push(target);
          offsets.push(offset);
          targets.push(target);
        }
        if (!targets.length) return [];
        // The easiest-looking offset's scores: its hardest piece alone is a sure lower bound (bound), the sum ranks how far off the goal looks (total)
        const scores = targets.map((target) => estimate(held, start, target, goal, tables));
        const bound = Math.min(...scores.map((score) => score.bound));
        const total = Math.min(...scores.map((score) => score.total));
        return [{ alternative, rotation, done, goal, gripMatters, covered, fresh, held, start, offsets, targets, bound, total }];
      });
    });
    // Only the grips where earlier steps cover the fewest of its pieces (a grip turn can't trade its pieces for ones already done)
    const least = Math.min(...combos.map((combo) => combo.covered));
    // nothingNew: every grip only names pieces earlier steps already did
    return { combos: combos.filter((combo) => combo.covered === least), nothingNew: ownPieces.length > 0 && least === ownPieces.length };
  });
  // Alternatives that add something; if none does, the step is already done when the cube may stay as held (only that grip is searched, e.g. a last pair after an XCross),
  // otherwise stop rather than answer with a bare grip turn
  const adding = perAlternative.filter((entry) => !entry.nothingNew);
  const combos = adding.length ? adding.flatMap((entry) => entry.combos) : perAlternative.flatMap((entry) => entry.combos.filter((combo) => combo.rotation === ""));
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
        combo.offsets.map((offset) => movesKey(rotation, [offset])).join("&"),
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
  // Ask the worker how far each combo is (it builds or loads the tables first): exact from one table, a lower bound from split tables,
  // unknown with twips (then the hardest piece's moves stand in)
  const measured = await Promise.all(
    candidates.map(async (combo) => {
      try {
        const { bound, exact } = await askWorker({ kind: "measure", start: combo.start, targets: combo.targets, moves: generatorMoves }, options.onProgress);
        return { ...combo, bound: exact ? (bound ?? Infinity) : Math.max(bound ?? 0, combo.bound) };
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

// Search the measured combos in turn for the shortest answer (on a tie, the alternative adding more new pieces), skipping combos that can't beat the best so far
async function searchCombos(queue: Combo[], options: StepOptions, lastError: unknown): Promise<{ answer: Answer; searches: number }> {
  // Best answer so far, its length and how many new pieces it adds
  let best: Answer | null = null;
  let bestLength = Infinity;
  let bestFresh = -1;
  let searches = 0;
  for (const combo of queue) {
    const { fresh, start, targets, bound } = combo;
    // Only look for answers shorter than the best so far, or as short when this alternative adds more new pieces (and within the user's limit)
    const maxDepth = Math.min(options.maxDepth ?? Infinity, fresh > bestFresh ? bestLength : bestLength - 1);
    // Skip a combo whose distance (or lower bound) is already too long: no search there can beat the best so far
    if (bound > maxDepth) continue;
    searches++;
    try {
      // Search, passing the depth limit only when there is one (the worker only finds answers shorter than its maxDepth, hence + 1)
      const reply = await askWorker(
        { kind: "search", start, targets, moves: options.generatorMoves ?? FACE_MOVES, ...(Number.isFinite(maxDepth) ? { maxDepth: maxDepth + 1 } : {}) },
        options.onProgress,
      );
      const moves = reply.moves ?? "";
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

// A step's result for one answer: the grip rotation and moves, and the offset it reached (the target the cube matches after it)
function stepResult({ combo, moves }: Answer, searches: number): StepResult {
  const end = maskPattern(combo.held.applyAlg(moves), combo.goal);
  const offset = combo.offsets[Math.max(0, combo.targets.findIndex((target) => end.isIdentical(target)))];
  return { solution: new Alg(joinMoves(combo.rotation, moves)), rotation: combo.rotation, offset, pieces: goalToText(combo.goal), alternative: combo.alternative, searches };
}

// Solve only the goal pieces (a step like the cross), trying each alternative × grip (each with all its offsets at once) and keeping the shortest answer
// (on a tie, the alternative adding more new pieces wins, so "cross | XCross" takes the XCross when it costs no extra move).
// The worker first measures every combo (exact distance from one table, or a lower bound from split tables), so only combos that can still win are searched
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  const { queue, lastError } = await stepCombos(scramble, pieces, options);
  const { answer, searches } = await searchCombos(queue, options, lastError);
  return stepResult(answer, searches);
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
  // How an answer leaves the cube (grip and every piece), so answers leaving it the same way count once
  const leaves = ({ combo, moves }: Answer) => `${combo.rotation}/${JSON.stringify(combo.held.applyAlg(moves).patternData)}`;
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
          { kind: "list", start: combo.start, targets: combo.targets, moves: options.generatorMoves ?? FACE_MOVES, maxDepth: longest + 1, maxAnswers: most },
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
  return [answer, ...found.slice(0, most - 1).map((entry) => entry.answer)].map((entry) => stepResult(entry, searches + lists));
}

// Solve the whole cube, judged by its centers in the grip it's held in
export async function solveFull(scramble: string, done = ""): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(joinMoves(scramble, done)));
}

// Check that scramble + done (earlier steps and this solution) really reaches the goal, in the grip it ends in,
// up to any of the step's offsets; with alternatives, any one counts (pieces = null means the whole cube, where offsets don't apply)
export function reachesGoal(scramble: string, done: string, pieces: string | null, offsets = [""]): boolean {
  // Full goal: every piece home, judged by the centers
  if (pieces === null) {
    return heldPattern(joinMoves(scramble, done)).experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  }
  // Step goal: some alternative's pieces match the solved cube turned by one of the offsets, everything else hidden
  const held = heldPattern(scramble, done);
  return splitAlternatives(pieces).some((text) => {
    const goal = goalFromText(text);
    const reached = maskPattern(held, goal);
    return (offsets.length ? offsets : [""]).some((offset) => reached.isIdentical(maskedTarget(goal, offset)));
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

// Read one step's data, filling defaults (D bottom, face turns, no offsets, no limit, no lookahead) and checking pieces, grips, offsets, moves and lookahead
function readStep(data: unknown, index: number): StepConfig {
  const step = (data ?? {}) as Partial<StepConfig>;
  const typed = String(step.name ?? "").trim();
  const name = typed || `Step ${index + 1}`;
  try {
    // Goal pieces: alternatives written with " | " (a JSON list counts as alternatives too), no typos, and at least one piece unless the step keeps earlier ones
    const keep = Boolean(step.keep);
    const given: unknown = step.pieces;
    const pieces = readAlternatives(Array.isArray(given) ? given.join("|") : String(given ?? ""), !keep).join(" | ");
    // Grips: faces that may go on the bottom
    const bottom = (step.grips?.bottom ?? ["D"]).map((face) => String(face).toUpperCase());
    if (!bottom.length || !bottom.every((face) => Object.hasOwn(BOTTOM_TURNS, face))) throw new Error("Bottom faces must be some of U D F B R L.");
    // Offsets text (checked by reading it)
    const offsets = String(step.offsets ?? "").trim();
    offsetsFromText(offsets);
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
    return { name, pieces, keep, grips: { bottom, anyFront: Boolean(step.grips?.anyFront) }, offsets, moves, maxDepth, firstFound: Boolean(step.firstFound), lookahead, extraMoves };
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
    firstFound: step.firstFound,
    keep: step.keep ? earlier : undefined,
    earlier,
    onProgress,
  };
}

// Earlier pieces after a step: they follow its grip turn, then its pieces join them (later roles win)
function piecesAfter(earlier: Goal, result: StepResult): Goal {
  return mergeGoals(rotateGoal(earlier, result.rotation), goalFromText(result.pieces));
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
  // Moves the `count` steps after step `index` take, each its own shortest answer, from where `from` leaves the cube (Infinity when one of them finds nothing)
  const movesAhead = async (index: number, count: number, from: string, before: Goal): Promise<number> => {
    let total = 0;
    for (let next = index + 1; next <= index + count; next++) {
      try {
        const result = await solveOwn(next, from, before);
        const solution = result.solution.toString();
        total += countMoves(solution);
        from = joinMoves(from, solution);
        before = piecesAfter(before, result);
      } catch {
        return Infinity;
      }
    }
    return total;
  };
  for (const [index, step] of method.steps.entries()) {
    const offsets = offsetsFromText(step.offsets);
    const started = performance.now();
    // Later steps that judge this step's answers (none past the last step)
    const ahead = Math.min(step.lookahead ?? 0, method.steps.length - 1 - index);
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
      // Say which step found nothing
      throw new Error(`${step.name}: ${(error as Error).message}`);
    }
    const ms = performance.now() - started;
    const solution = result.solution.toString();
    // Earlier pieces follow the step's grip turn, then this step's pieces join them (later roles win)
    earlier = piecesAfter(earlier, result);
    // Record the step, checked on its own goal and offsets
    const after = joinMoves(done, solution);
    const finished: MethodStepResult = {
      ...result,
      name: step.name,
      done,
      offsets,
      moves: countMoves(solution),
      ms,
      ok: reachesGoal(scramble, after, result.pieces, offsets),
      lookahead,
    };
    steps.push(finished);
    options.onStep?.(finished, index);
    done = after;
  }
  // Totals over all steps
  return {
    steps,
    solution: joinMoves(...steps.map((step) => step.solution.toString())),
    pieces: goalToText(earlier),
    offset: steps.at(-1)?.offset ?? "",
    moves: steps.reduce((sum, step) => sum + step.moves, 0),
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    ok: steps.every((step) => step.ok),
  };
}
