// The engine's data shapes: goals and roles, step options and results, methods as plain data and their runs

// Parses alg text into moves
import type { Alg } from "cubing/alg";

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
