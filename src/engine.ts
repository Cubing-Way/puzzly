// Cube engine: piece names, goal masks, grips, solvers and checks. No page code here, so it can move to another app later.

// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Parse alg strings into moves
import { Alg } from "cubing/alg";
// Puzzle model
import { cube3x3x3 } from "cubing/puzzles";
// Partial-goal solver and full 3x3x3 solver
import { experimentalSolveTwips, experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
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
}

// Best answer of a step search
export interface StepResult {
  solution: Alg; // grip rotation (if any), then the moves
  rotation: string; // grip that won ("" = as held)
  searches: number; // searches actually run (grips asking for the same thing are skipped)
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

// Turn goal text into the per-piece roles that maskPattern expects
export function goalFromText(text: string): Goal {
  const goal: Goal = {};
  // Add each typed piece with its role (a piece typed twice keeps its last role)
  for (const { orbit, index, role } of parseGoalText(text)) (goal[orbit] ??= {})[index] = role;
  // No center typed: keep all six, so slice moves can't move them
  goal.CENTERS ??= Object.fromEntries(PIECE_NAMES.CENTERS.map((_, index) => [index, "solve" as Role]));
  return goal;
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

// Goal renumbered to the actual pieces that fill its spots in the grip after `scramble` then `done` (e.g. for the viewer's mask)
export function goalOnCube(text: string, scramble: string, done = ""): Goal {
  // Solved cube held in that grip: the piece at each spot is the one that belongs there
  const homes = kpuzzle.defaultPattern().applyAlg(gripAfter(scramble, done)).patternData;
  const onCube: Goal = {};
  // Move each role from its spot number to the number of the piece that belongs there
  for (const [orbit, roles] of Object.entries(goalFromText(text))) {
    const renumbered: Record<number, Role> = (onCube[orbit] = {});
    for (const [spot, role] of Object.entries(roles)) renumbered[homes[orbit].pieces[Number(spot)]] = role;
  }
  return onCube;
}

// Read move text; throws a clear error on moves the 3x3x3 doesn't have, returns the cleaned-up moves
export function parseMoves(text: string): string {
  const alg = new Alg(text.trim());
  kpuzzle.defaultPattern().applyAlg(alg);
  return alg.toString();
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

// Solve only the goal pieces (a step like the cross), trying each grip and keeping the shortest answer
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  const goal = goalFromText(pieces);
  const generatorMoves = options.generatorMoves ?? FACE_MOVES;
  // Target = solved cube with the same pieces hidden (the same for every grip, since spots are named in the grip)
  const target = maskPattern(kpuzzle.defaultPattern(), goal);
  // Orientation is judged from the grip, so orient-group goals can't be shared between grips
  const gripMatters = Object.values(goal).some((roles) => Object.values(roles).some((role) => role.startsWith("orient")));
  // Best answer so far, and the last search error (shown if no grip finds anything)
  let best: StepResult | null = null;
  let bestLength = Infinity;
  let lastError: unknown = null;
  // What each searched grip asked for: two grips needing the same pieces with the same turns give the same length
  const asked = new Set<string>();
  let searches = 0;
  for (const rotation of options.rotations ?? [""]) {
    // Earlier steps, then this grip's rotation
    const done = joinMoves(options.done ?? "", rotation);
    // Skip a grip that asks for the same thing as one already searched
    const key = [JSON.stringify(goalOnCube(pieces, scramble, done)), movesKey(rotation, generatorMoves), gripMatters ? rotation : ""].join("/");
    if (asked.has(key)) continue;
    asked.add(key);
    // Only look for answers shorter than the best so far (and within the user's limit)
    const maxDepth = Math.min(options.maxDepth ?? Infinity, bestLength - 1);
    if (maxDepth < 0) break;
    // Start = cube held in this grip, with the same pieces hidden
    const start = maskPattern(heldPattern(scramble, done), goal);
    // Skip a grip whose goal centers the allowed moves can't bring home (that search would never end)
    if (!centersReachable(start, target, generatorMoves)) {
      lastError ??= new Error(CENTERS_OUT);
      continue;
    }
    searches++;
    try {
      // Search, passing the depth limit only when there is one
      const moves = await experimentalSolveTwips(kpuzzle, start, {
        targetPattern: target,
        generatorMoves,
        ...(Number.isFinite(maxDepth) ? { maxDepth } : {}),
      });
      // Keep it if it beats the best so far
      const length = countMoves(moves.toString());
      if (length < bestLength) {
        bestLength = length;
        best = { solution: new Alg(joinMoves(rotation, moves.toString())), rotation, searches };
      }
    } catch (error) {
      // No answer within the limit for this grip: remember why and try the next one
      lastError = error;
    }
  }
  // No grip found an answer
  if (!best) throw lastError ?? new Error("No solution found.");
  return { ...best, searches };
}

// Solve the whole cube, judged by its centers in the grip it's held in
export async function solveFull(scramble: string, done = ""): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(joinMoves(scramble, done)));
}

// Check that scramble + done (earlier steps and this solution) really reaches the goal, in the grip it ends in (pieces = null means the whole cube)
export function reachesGoal(scramble: string, done: string, pieces: string | null): boolean {
  // Full goal: every piece home, judged by the centers
  if (pieces === null) {
    return heldPattern(joinMoves(scramble, done)).experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  }
  // Step goal: the goal pieces match the solved cube, everything else hidden
  const goal = goalFromText(pieces);
  return maskPattern(heldPattern(scramble, done), goal).isIdentical(maskPattern(kpuzzle.defaultPattern(), goal));
}

// Number of moves in an alg (R2 counts as one, whole-cube rotations don't count)
export function countMoves(alg: string): number {
  return Array.from(new Alg(alg).experimentalLeafMoves()).filter((move) => !ROTATIONS.includes(move.family)).length;
}
