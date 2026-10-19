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

// How a step picks among its answers: the fewest moves, or the lowest speed cost (how fast the moves turn in the hands, see speed/)
export type Rank = "moves" | "speed";

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
  // Which answer is best: the fewest moves (default), or by speed the fastest to turn among the shortest answers and those up to extraMoves longer
  rank?: Rank;
  // Answers up to this many moves longer than the shortest count too: for rank "speed", and for listing candidates (default 0: the shortest answers only).
  // They're listed one move longer at a time while the step's search budget lasts (LIST_NODES in step.ts), so a step far from its goal may compare fewer
  extraMoves?: number;
  // Faces the answer avoids when it can, e.g. ["F", "B"] for a first-two-layers pair: among the answers compared (the shortest and those up to extraMoves
  // longer), by moves one that turns none of them comes before all others, whatever its length. By speed an answer that turns some only loses outright
  // to one held the same way that doesn't: rotating to avoid them, staying, and turning them where nothing held that way does without are ranked
  // together, since a rotation's cost is in the score (see StepResult.tier) (default: none)
  avoid?: string[];
  // The answer goes on to undo the offset it reached (a pseudo-cross ends with its D turn), and those moves count in its length and its speed: the best answer
  // is the shortest (or fastest) with them, and the result has no offset left (default: the offset is left in, for a later step)
  undoOffset?: boolean;
  // By speed: any number of an answer's face turns may be made as wide turns about these axes that cancel out (r … r', f … f'), which needs no rotation:
  // "x" (Rw, Lw), "y" (Uw, Dw), "z" (Fw, Bw). With rotations about the same axis (rotationAxes), one face turn may also be made as the opposite wide turn
  // (R as Lw: the other hand turns two layers) with the cube's turn made up by a rotation at the start or at the end, so the cube ends as the plain answer
  // leaves it (default: none)
  wideAxes?: string[];
  // By speed: two face turns of an answer may be made as one slice turn about these axes, along with other wide and slice turns that cancel out (M2 U M U2
  // M' U M2): "x" (M), "y" (E), "z" (S) (default: the same as wideAxes, as before they were apart)
  sliceAxes?: string[];
  // By speed: rotations the hands may make in the middle of an answer, about these axes: the one that makes up for a wide turn (see wideAxes), and with
  // "x", after a solve's first step, the cube tilted for the answer and tilted back (x R2 D2 R U R' D2 R U' R x') (default: the same as wideAxes)
  rotationAxes?: string[];
  // An alg set ("OLL", "PLL", "ZBLL": see algs/sets.ts): the step isn't searched but recognised, as solvers do the last layer. Each alg of the set is tried
  // after each turn of the top layer (for a goal that solves every piece, only those a lookup says solve the cube), the ones that reach the goal are
  // compared (by speed, or by moves) and the best is the answer, its case's default alg on a tie. Only a cube that fits no alg of the set is searched,
  // with the options above (default: none, the step is searched)
  algs?: string;
  // By speed, in a method: each answer also pays for finding pieces (see speed/look.ts), its own before its first turn (not on a solve's first step, which
  // is planned in inspection), so a pair in sight wins over one in the back, and with `next` the next step's after its last turn (default: false)
  look?: boolean;
  // The method's next step, for `look`: of two answers that turn alike, the one leaving that step's pieces in sight wins (default: none)
  next?: NextStep;
  // The solve's moves before this step as the hands make them (in a method: every earlier step's, joined as its solution joins them). By speed an answer
  // whose first turns cancel into their last ones (R then R', U then y U') is scored by what's left of it, less what those moves no longer turn (default: none)
  previous?: string;
  // Where each earlier step starts among `previous` (see joinStep), so the counts that belong to one step start over there when they're scored (default: none)
  previousStarts?: number[];
  // Hears when the search worker builds or loads a table (first-time builds can take seconds), e.g. to show "Building tables…"
  onProgress?: (progress: TableProgress) => void;
}

// The next step of a method, as a step ranked by speed needs it (see StepOptions.next): its goal text (alternatives split by " | ") and its grips
export interface NextStep {
  pieces: string;
  rotations: string[];
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
  // The same turns as the hands make them, when some are made as wide or slice turns (Lw' where `solution` says R' x, M where it says R L'): the writing to score and show.
  // `solution` stays the one to check and to go on from, since the engine tells how the cube is held from x, y, z turns alone
  wide?: string;
  // With faces to avoid, where the answer stands (a lower tier always comes first). By moves: 0 = it turns none of them; 1 = it turns some where no
  // answer held the same way does without; 2 = it turns some although an answer held the same way doesn't. By speed: 0 = anything but that last kind
  // (a rotation's cost is in the score, so rotating, staying and having to turn the faces are ranked together); 1 = it turns some, or turns L against an
  // open R layer (see HandModel.open), although an answer held the same way doesn't
  tier?: number;
  alg?: string; // a step answered from an alg set: the case it recognised (e.g. "OLL 33", "T perm")
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
  lookahead?: number; // later steps that judge this step's answers: each candidate is followed by that many steps (each its own shortest way, comparing one extra move at most while it only judges), fewest moves in total wins (0 = none, the step's own shortest)
  candidates?: number; // with lookahead: how many of the step's answers the later steps judge, best first (0 or left out = 64, the most); fewer is quicker, and a solver weighs a handful of crosses, not dozens
  extraMoves?: number; // with lookahead or rank "speed": candidates may be this many moves longer than the step's shortest answer (0 = the shortest answers only)
  avoid?: string; // faces the answer avoids when it can, e.g. "F B" ("" = none): answers that turn none of them come first among those compared
  wideAxes?: string; // by speed, axes its answer may make wide turns about, e.g. "x" or "x z" ("" = none): r … r' and f … f' that cancel out, or R as Lw with an x rotation (see rotationAxes)
  sliceAxes?: string; // by speed, axes its answer may make slice turns about: "x" = M, "y" = E, "z" = S ("" = none; left out = the same as wideAxes, as older method files mean)
  rotationAxes?: string; // by speed, axes its answer may rotate the cube about in its middle: x for a tilt (x … x'), and the rotation that makes up for a single wide turn ("" = none; left out = the same as wideAxes)
  style?: "human" | "efficiency"; // by speed in a method: "human" (default) = the step also pays for finding pieces, for turning the cube in the middle of an answer (x2 … Rw2: the pieces tracked are lost) and, as a solve's first step, for planning more than its smallest alternative in inspection (an easy XCross only), "efficiency" = only how fast its moves turn (any XCross)
  rank?: Rank; // how the step picks its answer: "moves" = the fewest moves (default), "speed" = the fastest to turn; with lookahead, what its candidates' totals count
  algs?: string; // an alg set the step is answered from, "OLL", "PLL" or "ZBLL" ("" = none): the case is recognised and its alg made, and only a cube that fits none of the set's algs is searched
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
  // With lookahead: answers compared, later steps they were judged over (at most: an answer that does more, like an XCross, is judged over fewer, so all
  // end at the same point), the winner's total over this step and those (null = no answer got through them), what that total counts (moves when left
  // out), and by speed how much of it is finding pieces (see speed/look.ts)
  lookahead: { candidates: number; steps: number; total: number | null; rank?: Rank; look?: number } | null;
}

// A whole method run
export interface MethodResult {
  steps: MethodStepResult[];
  solution: string; // every step's solution in order, a step's first turn joined with the turn before it when both turn the same layer (R then R' is nothing, U then U is U2)
  wide?: string; // the same with each step's wide writing where it has one (as the hands make it: the one to score and show)
  starts: number[]; // where each step starts among the moves as the hands make them (wide, else solution): pass it to speedCost and fingering to score the whole solve
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
