// Cube engine, page side: everything an app imports. No page code in here: the app says how the search worker is started (loadEngine),
// and the worker's own script calls runSearchWorker from ./worker/search-worker (see the README's "Using the engine")

// Setup: await loadEngine once before anything else
export { loadEngine, type EngineOptions } from "./setup";
// Data shapes: goals, step options and results, methods and their runs
export type { Role, Goal, GoalPiece, Rank, StepOptions, NextStep, TableProgress, StepResult, StepConfig, Method, MethodStepResult, MethodResult, MethodOptions } from "./types";
// The part of a Worker the engine needs from the app
export type { SearchWorker } from "./worker/protocol";
// Piece names and grips
export { PIECE_NAMES, ORBIT_BY_LENGTH, BOTTOM_TURNS, FRONT_TURNS, normalizeName, gripRotations } from "./core/cube";
// Move text
export { FACE_MOVES, joinMoves, joinSteps, invertMoves, countMoves } from "./core/moves";
// Speed: the hand map (finger tricks per wrist position), a move sequence's cheapest fingering, and an answer's cheapest writing with wide and slice turns
export { HANDS, WRISTS, trickName, type HandModel, type Trick, type Wrist, type Finger } from "./speed/hands";
export { fingering, speedCost, speedFloor, cheapestWriting, strained, fingeringText, THUMBS, type Fingering, type FingeringStep, type FingerWay, type Hand } from "./speed/fingering";
// Speed, the eyes: what finding a method step's pieces costs, by how much of them is in sight
export { LOOK, lookCost, hiddenShare, nextGroups, nextLook, pieceCount, type LookModel } from "./speed/look";
// Alg sets: the cases a step can be answered from without a search (the last layer's), and an alg as the face turns it makes
export { ALG_SETS, algSet, type AlgSet, type AlgCase } from "./algs/sets";
export { algCandidates } from "./step/alg-step";
export { toFaces } from "./core/faces";
// Checked moves and scrambles
export { parseMoves, randomScramble } from "./core/puzzle";
// Goals: roles, goal text, merging and masking
export { roleFromSuffix, roleSuffix, parseGoalText, splitAlternatives, readAlternatives, goalFromText, goalToText, mergeGoals, dropFree, maskPattern } from "./goal/goal";
// Goals named for another grip
export { goalOnCube, rotateGoal } from "./goal/grips";
// Offsets and solvable-with moves as text
export { offsetsFromText, offsetsToText } from "./goal/offsets";
export { solvableFromText } from "./goal/solvable";
// Blindfolded fields as text
export { bufferFromText, parityFromText } from "./goal/bld";
// Sticker mask of a goal for cubing.js's 3D viewer
export { stickeringMask } from "./goal/stickering";
// Step solvers and the goal check
export { solveStep, stepCandidates, solveFull, MAX_CANDIDATES, MAX_RANKED, type CandidateOptions } from "./step/step";
export { reachesGoal } from "./step/check";
// Methods: reading their data, running them, searching their runs for the fewest moves
export { readMethod } from "./method/config";
export { runMethod } from "./method/run";
export { searchMethod, METHOD_SEARCH_MS, type MethodSearchOptions, type MethodSearchResult } from "./method/search";
