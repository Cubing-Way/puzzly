// Page side of the search worker: starts it on first use (the app says how), sends each request and hands back its answer; stopped when idle

// Patterns the requests carry
import type { KPattern } from "cubing/kpuzzle";
// Loaded cube definition (sent along with each request)
import { kpuzzle } from "../core/puzzle";
// Table progress, as listeners hear it
import type { TableProgress } from "../types";
// Messages to and from the worker
import type { SearchReply, SearchWorker } from "./protocol";

// How the app using the engine runs its search worker
export interface SearchClientOptions {
  // Starts the search worker: a worker whose script calls runSearchWorker (see search-worker.ts). Step searches need it; reading text and checking answers don't
  searchWorker?: () => SearchWorker;
  // Stop the search worker after this long without requests (default 60 s), so its memory goes back to the system (WebAssembly memory never shrinks);
  // the next request starts a fresh worker, which loads the tables stored in this browser
  workerIdleMs?: number;
}

// One request to the search worker: measure how far the start is from the targets (any one counts), search for the moves, or list every answer
export interface WorkerRequest {
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

// Idle time before the worker is stopped, unless the app sets its own
const WORKER_IDLE_MS = 60_000;

// How the app starts the search worker (null until loadEngine is given one), and how long an idle one is kept
let startWorker: (() => SearchWorker) | null = null;
let idleMs = WORKER_IDLE_MS;
// One search worker at a time, so each goal's tables (exact, split, or twips's prune table) are built once and reused
let searchWorker: SearchWorker | null = null;
// Requests waiting for the worker's answer, by request number, with who hears about their table progress
const waiting = new Map<number, { resolve: (reply: SearchReply) => void; reject: (error: Error) => void; onProgress?: (progress: TableProgress) => void }>();
// Number for the next request
let nextRequest = 0;
// Timer that stops the worker once it's idle
let idleTimer: ReturnType<typeof setTimeout> | undefined;
// The puzzle definition as JSON, without its check function (which JSON can't carry), made on first use
let puzzleJson = "";

// Set how the search worker is started and how long an idle one is kept (left-out options stay as they were); a worker started another way is stopped
export function configureSearch(options: SearchClientOptions): void {
  if (options.searchWorker && options.searchWorker !== startWorker) {
    stopSearchWorker();
    startWorker = options.searchWorker;
  }
  idleMs = options.workerIdleMs ?? idleMs;
}

// Stop the search worker, freeing its memory (the next request starts a fresh one)
export function stopSearchWorker(): void {
  clearTimeout(idleTimer);
  searchWorker?.terminate();
  searchWorker = null;
}

// Start the search worker on first use, the way the app said to
function getSearchWorker(): SearchWorker {
  if (searchWorker) return searchWorker;
  if (!startWorker) throw new Error("No search worker: give loadEngine a searchWorker option that starts one.");
  const worker = startWorker();
  // Hand each answer or error to the request that asked for it, and table progress to its listener
  worker.onmessage = ({ data }) => {
    const entry = waiting.get(data.id);
    if (data.progress) {
      entry?.onProgress?.(data.progress);
      return;
    }
    waiting.delete(data.id);
    if (data.error !== undefined) entry?.reject(new Error(data.error));
    else entry?.resolve(data);
    // Nothing left to answer: stop the worker unless another request comes soon
    if (!waiting.size) idleTimer = setTimeout(stopSearchWorker, idleMs);
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
export function askWorker(request: WorkerRequest, onProgress?: (progress: TableProgress) => void): Promise<SearchReply> {
  // A request keeps the worker alive
  clearTimeout(idleTimer);
  if (!puzzleJson) {
    const definition: Record<string, unknown> = { ...kpuzzle.definition };
    delete definition.experimentalIsPatternSolved;
    puzzleJson = JSON.stringify(definition);
  }
  const id = nextRequest++;
  return new Promise<SearchReply>((resolve, reject) => {
    // No way to start a worker: the request fails with the reason
    const worker = getSearchWorker();
    waiting.set(id, { resolve, reject, onProgress });
    worker.postMessage({
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
