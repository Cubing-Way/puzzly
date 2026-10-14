// Messages between the engine (on the page) and its search worker, and the part of a Worker the engine needs

// Table progress, as the engine's listeners hear it
import type { TableProgress } from "../types";

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
