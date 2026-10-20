// Messages between the engine (on the page) and its search and scoring workers, and the part of a Worker the engine needs

// Cube patterns as plain data
import type { KPatternData } from "cubing/kpuzzle";
// What a step's scoring reads, how it shares out its places, and the answers sure of a place so far
import type { Places, ScoringOptions, Sures } from "../step/scoring";
// What a writing search gives (with its bounds)
import type { WritingSearch } from "../speed/fingering";
// Table progress and goals, as the engine has them
import type { Goal, TableProgress } from "../types";

// One request to the worker: puzzle and start as JSON, targets as a JSON list (one pattern per offset the goal counts up to, any one counts), or an object with that list
// plus "solvableWith" moves and / or "orbitTables" (BLD steps: split tables also get whole-orbit tables up to that many states); the text is the cache key as it is;
// "measure" asks how far the start is (exact distance, or a lower bound), "search" asks for the moves, "list" for every answer shorter than maxDepth (up to maxAnswers;
// one page of a long list: answers from minDepth moves on that come after the answer `after`; with maxNodes it fails with NODE_LIMIT once it has searched that many nodes)
export interface SearchRequest {
  id: number;
  kind: "measure" | "search" | "list";
  kpuzzle: string;
  start: string;
  targets: string;
  moves: string[];
  maxDepth?: number;
  maxAnswers?: number;
  minDepth?: number;
  after?: string;
  maxNodes?: number;
}

// What a search or list that used up its node budget fails with
export const NODE_LIMIT = "Node limit reached";

// One answer from the worker: a search's moves, a list's answers (with the search nodes it took; none from a table), a measure's distance (bound, exact
// or a lower bound; null = unknown), an error, or table progress for the request it's working on (the answer comes later)
export interface SearchReply {
  id: number;
  moves?: string;
  answers?: string[];
  nodes?: number;
  bound?: number | null;
  exact?: boolean;
  error?: string;
  progress?: TableProgress;
}

// The part of a Worker the engine uses (a browser Worker, or anything shaped like one, e.g. a search worker run in the same thread for tests)
export interface SearchWorker {
  postMessage(message: SearchRequest): void;
  onmessage: ((event: { data: SearchReply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

// A combo as the scoring worker gets it: the parts scoring reads, its cubes as pattern data (the targets only when answers undo their offset), and its
// twin grips as places in the same list
export interface ComboData {
  alternative: number;
  rotation: string;
  goal: Goal;
  fresh: number;
  held: KPatternData;
  cube?: KPatternData;
  offsets: string[];
  targets: KPatternData[];
  twins?: number[];
}

// One listed answer as the scoring worker gets it: its combo's place in the step's list, its moves, its length (ending counted) and its place in the queue
export type ListedData = [combo: number, moves: string, length: number, order: number];

// One ranked answer as the scoring worker gives it back (see Listed in step/scoring.ts; combo = its place in the step's list)
export interface RankedData {
  combo: number;
  moves: string;
  length: number;
  order: number;
  key: string;
  speed: number;
  wide?: { wide: string; plain: string };
  form?: string;
  tier?: number;
}

// How a step's scoring begins: the step as given, how it shares out its places, its combos
export interface ScoringBegin {
  id: number;
  kind: "begin";
  scramble: string;
  pieces: string;
  options: ScoringOptions;
  places: Places;
  combos: ComboData[];
}

// One message to the scoring worker, for one step's scoring (`id`): begin it, add answers as they're listed (scored in the order they come), or finish it
// (the ranked answers come back)
export type ScoringRequest =
  | ScoringBegin
  | { id: number; kind: "add"; answers: ListedData[] }
  | { id: number; kind: "finish" };

// The scoring worker's answer to a finish: the ranked answers, or the error that stopped the scoring
export interface ScoringReply {
  id: number;
  ranked?: RankedData[];
  error?: string;
}

// The part of a Worker the engine uses for scoring (a browser Worker, or anything shaped like one, e.g. a Node thread in the benchmark)
export interface ScoringWorker {
  postMessage(message: ScoringRequest): void;
  onmessage: ((event: { data: ScoringReply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  terminate(): void;
}

// Messages a scoring helper gets from its scoring worker: a step's scoring begun (as the worker got it), a chunk of its answers to work out ahead from the
// worker's sure answers as they are when it sends the chunk, or the scoring ended
export type ScoringHelperMessage = ScoringBegin | { id: number; kind: "chunk"; chunk: number; sures: Sures; answers: ListedData[] } | { id: number; kind: "end" };

// A scoring helper's reply: one chunk's looks and writings, by what they're worked out from (see Ahead in step/scoring.ts), or the error it threw
export interface ScoringHelperReply {
  id: number;
  chunk: number;
  looks?: [string, number][];
  writings?: [string, WritingSearch & { limit: number }][];
  error?: string;
}

// The part of a Worker the scoring worker uses for a helper (a browser Worker, or a Node worker_threads one wrapped to look like it)
export interface ScoringHelperWorker {
  postMessage(message: ScoringHelperMessage): void;
  onmessage: ((event: { data: ScoringHelperReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}
