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

// What a step checks on a goal piece: solve = home and turned right, orient = turned right (may swap with other orient pieces), place = home, any turn
export type Role = "solve" | "orient" | "place";

// Goal pieces by type and piece number, each with its role, e.g. { EDGES: { 4: "solve", 0: "orient" } }
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
}

// Best answer of a step search
export interface StepResult {
  solution: Alg; // grip rotation (if any), then the moves
  rotation: string; // grip that won ("" = as held)
  searches: number; // searches actually run (grips asking for the same thing are skipped)
}

// Face turns used when a step search isn't given its own moves
export const FACE_MOVES = ["U", "R", "F", "D", "L", "B"];

// Piece names in cubing.js's order: the position in each list is the piece number
export const PIECE_NAMES: Record<string, string[]> = {
  EDGES: ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"],
  CORNERS: ["UFR", "UBR", "UBL", "UFL", "DFR", "DFL", "DBL", "DBR"],
  CENTERS: ["U", "L", "F", "R", "B", "D"],
};

// Piece type for each name length: 1 letter = center, 2 = edge, 3 = corner
export const ORBIT_BY_LENGTH: Record<number, string> = { 1: "CENTERS", 2: "EDGES", 3: "CORNERS" };

// Suffix that marks each role in goal text: "UF" = solve, "UF:o" = orientation only, "UF:p" = position only
export const ROLE_SUFFIX: Record<Role, string> = { solve: "", orient: ":o", place: ":p" };

// Rotation that puts each face (as held now) on the bottom
export const BOTTOM_TURNS: Record<string, string> = { D: "", U: "x2", F: "x'", B: "x", R: "z", L: "z'" };

// y turns that pick a new front face while keeping the bottom
export const FRONT_TURNS = ["", "y", "y2", "y'"];

// Every grip (24 rotations, "as held" first)
const ALL_GRIPS = Object.values(BOTTOM_TURNS).flatMap((bottom) => FRONT_TURNS.map((front) => joinMoves(bottom, front)));

// Sort a name's letters so "UR", "RU" and "ur" all mean the same piece
export function normalizeName(name: string): string {
  return name.toUpperCase().split("").sort().join("");
}

// Join move texts with spaces, skipping empty ones
export function joinMoves(...parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

// Read goal text like "DF DR UF:o UFR:p" into pieces with roles; throws a clear error on a typo
export function parseGoalText(text: string): GoalPiece[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => {
      // Split the piece name from its optional role suffix
      const [name, ...suffix] = word.split(":");
      const tag = suffix.length ? `:${suffix.join(":").toLowerCase()}` : "";
      const role = (Object.keys(ROLE_SUFFIX) as Role[]).find((r) => ROLE_SUFFIX[r] === tag);
      // Pick the piece type from the name's length
      const orbit = ORBIT_BY_LENGTH[name.length];
      const list = orbit ? PIECE_NAMES[orbit] : undefined;
      // Find the piece's number in that type's list
      const index = list ? list.findIndex((n) => normalizeName(n) === normalizeName(name)) : -1;
      // Stop with a clear message on a typo
      if (!orbit || index === -1) throw new Error(`Unknown piece: "${name}"`);
      if (!role) throw new Error(`Unknown role in "${word}" (use :o or :p)`);
      return { orbit, index, role };
    });
}

// Turn goal text into the per-piece roles that maskPattern expects
export function goalFromText(text: string): Goal {
  // Always keep every center so slice moves can't move them
  const goal: Goal = { CENTERS: { 0: "solve", 1: "solve", 2: "solve", 3: "solve", 4: "solve", 5: "solve" } };
  // Add each typed edge and corner with its role (a piece typed twice keeps its last role)
  for (const { orbit, index, role } of parseGoalText(text)) {
    if (orbit !== "CENTERS") (goal[orbit] ??= {})[index] = role;
  }
  return goal;
}

// Hide what the goal doesn't check: ignored pieces share one id (any turn), orient pieces share another (turn kept), place pieces keep their id (any turn)
export function maskPattern(pattern: KPattern, goal: Goal): KPattern {
  // Copy the data so the original pattern isn't changed
  const data = structuredClone(pattern.patternData);
  // Go through each piece type: EDGES, CORNERS, CENTERS
  for (const [orbitName, orbit] of Object.entries(data)) {
    // Role of each goal piece of this type (not listed = ignored)
    const roles = goal[orbitName] ?? {};
    // Shared ids, picked from the goal (not from where pieces sit) so start and target agree
    const ids = orbit.pieces.map((_, id) => id);
    const ignoredId = ids.find((id) => !roles[id]) ?? 0;
    const orientId = ids.find((id) => roles[id] === "orient") ?? 0;
    // Per-piece orientation rule (0 = matters, 1 = ignored), starting from the puzzle's own rules
    const mods = orbit.orientationMod ?? orbit.pieces.map(() => 0);
    orbit.orientationMod = mods;
    // Rewrite each spot based on the role of the piece sitting there
    orbit.pieces.forEach((piece, i) => {
      const role = roles[piece];
      // Orient-only and ignored pieces become interchangeable within their group
      if (role === "orient") orbit.pieces[i] = orientId;
      if (!role) orbit.pieces[i] = ignoredId;
      // Place-only and ignored pieces may be turned any way
      if (!role || role === "place") {
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

// Grips to try: each allowed bottom face, with all four front faces or just the current one
export function gripRotations(bottoms: string[], anyFront: boolean): string[] {
  return bottoms.flatMap((face) => (anyFront ? FRONT_TURNS : [""]).map((front) => joinMoves(BOTTOM_TURNS[face], front)));
}

// The cube after `moves` and then `rotation`, renumbered so piece numbers mean "home spot in that grip" (centers back home)
function heldPattern(moves: string, rotation = ""): KPattern {
  // Whole grip = rotation already inside the moves, then the extra one
  const grip = joinMoves(netRotation(moves), rotation);
  return kpuzzle.defaultPattern().applyAlg(new Alg(grip).invert()).applyAlg(moves).applyAlg(rotation);
}

// Goal renumbered to the actual pieces that fill its spots in the grip after `moves` (e.g. for the viewer's mask)
export function goalOnCube(text: string, moves: string): Goal {
  // Solved cube held in that grip: the piece at each spot is the one that belongs there
  const homes = kpuzzle.defaultPattern().applyAlg(netRotation(moves)).patternData;
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

// Solve only the goal pieces (a step like the cross), trying each grip and keeping the shortest answer
export async function solveStep(scramble: string, pieces: string, options: StepOptions = {}): Promise<StepResult> {
  const goal = goalFromText(pieces);
  // Target = solved cube with the same pieces hidden (the same for every grip, since spots are named in the grip)
  const target = maskPattern(kpuzzle.defaultPattern(), goal);
  // Orientation is judged from the grip, so orient-only goals can't be shared between grips
  const gripMatters = Object.values(goal).some((roles) => Object.values(roles).includes("orient"));
  // Best answer so far, and the last search error (shown if no grip finds anything)
  let best: StepResult | null = null;
  let bestLength = Infinity;
  let lastError: unknown = null;
  // What each searched grip asked for: two grips needing the same pieces the same way give the same length
  const asked = new Set<string>();
  let searches = 0;
  for (const rotation of options.rotations ?? [""]) {
    // Skip a grip that asks for the same thing as one already searched
    const key = JSON.stringify(goalOnCube(pieces, joinMoves(scramble, rotation))) + (gripMatters ? rotation : "");
    if (asked.has(key)) continue;
    asked.add(key);
    // Only look for answers shorter than the best so far (and within the user's limit)
    const maxDepth = Math.min(options.maxDepth ?? Infinity, bestLength - 1);
    if (maxDepth < 0) break;
    // Start = scrambled cube held in this grip, with the same pieces hidden
    const start = maskPattern(heldPattern(scramble, rotation), goal);
    searches++;
    try {
      // Search, passing the depth limit only when there is one
      const moves = await experimentalSolveTwips(kpuzzle, start, {
        targetPattern: target,
        generatorMoves: options.generatorMoves ?? FACE_MOVES,
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

// Solve the whole cube, in the grip the moves leave it in
export async function solveFull(scramble: string): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(heldPattern(scramble));
}

// Check that scramble + solution really reaches the goal, in the grip the solution ends in (pieces = null means the whole cube)
export function reachesGoal(scramble: string, solution: string, pieces: string | null): boolean {
  const end = heldPattern(joinMoves(scramble, solution));
  // Full goal: every piece home
  if (pieces === null) return end.experimentalIsSolved({ ignorePuzzleOrientation: true, ignoreCenterOrientation: true });
  // Step goal: the goal pieces match the solved cube, everything else hidden
  const goal = goalFromText(pieces);
  return maskPattern(end, goal).isIdentical(maskPattern(kpuzzle.defaultPattern(), goal));
}

// Number of moves in an alg (R2 counts as one, whole-cube rotations don't count)
export function countMoves(alg: string): number {
  return Array.from(new Alg(alg).experimentalLeafMoves()).filter((move) => !["x", "y", "z"].includes(move.family)).length;
}
