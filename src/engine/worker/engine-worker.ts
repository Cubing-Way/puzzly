// Batch engine (started by the page's batch client, see batch-client.ts): a whole engine in a worker of its own, with its search worker in this same
// thread and no search helpers (several engines keep every core busy already), answering the calls of each job the page sends, one after another.
// An app's engine worker script calls runEngineWorker once, passing the compiled Rust code and how to start a scoring worker

// Alg, the type a step's solution comes in
import { Alg } from "cubing/alg";
// wasm-bindgen glue's input type for the Rust search crate (built by `npm run build-search`)
import type { InitInput } from "../../../search/pkg/puzzly_search.js";
// Engine setup
import { loadEngine } from "../setup";
// The calls a job may make
import { solveStep, stepCandidates } from "../step/step";
import { runMethod } from "../method/run";
import { searchMethod } from "../method/search";
import { beamSearchMethod } from "../method/beam";
// The search worker, run in this thread
import { sameThreadSearchWorker } from "./search-worker";
// Messages to and from the page, and the scoring worker's shape
import { ALG_TEXT, type BatchCalls, type EngineReply, type EngineRequest, type ScoringWorker } from "./protocol";

// What the app's engine worker script gives the batch engine
export interface EngineWorkerOptions {
  // The compiled Rust search code (search/pkg/puzzly_search_bg.wasm): its bytes, a URL to fetch it from, or a compiled module
  wasm: InitInput | Promise<InitInput>;
  // Starts this engine's scoring worker (see scoring-worker.ts). Left out: steps ranked by speed score in this thread, which was slower (4 engines on
  // 2 cores / 4 threads: 1.77 s a CFOP review instead of 1.34 s)
  scoringWorker?: () => ScoringWorker;
  // Name of the IndexedDB database built tables are stored in (default "puzzly-tables", the one the page's search worker uses too, so a table any
  // engine built loads in the others); null = don't store them
  tableDatabase?: string | null;
}

// The engine functions a job may call, by name
const CALLS: BatchCalls = { solveStep, stepCandidates, runMethod, searchMethod, beamSearchMethod };

// A call's result as plain data for postMessage: each Alg as its text, under ALG_TEXT (the page makes it an Alg again)
function plain(value: unknown): unknown {
  if (value instanceof Alg) return { [ALG_TEXT]: value.toString() };
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, plain(field)]));
  return value;
}

// Start answering the page's jobs in this worker: load the engine (the Rust code, the cube, the search worker in this thread), then run each job's calls
// in order, posting each one's answer as it's done; call it once from the worker's script
export function runEngineWorker(options: EngineWorkerOptions): void {
  // Worker-side global (tsconfig only has the page's DOM types)
  const scope = self as unknown as Worker;
  const search = sameThreadSearchWorker({ wasm: options.wasm, ...(options.tableDatabase === undefined ? {} : { tableDatabase: options.tableDatabase }) });
  // An idle stop only lets go of it (its tables stay in this thread, and the next request takes it up again): the page stops the whole engine instead
  const ready = loadEngine({ searchWorker: () => search, scoringWorker: options.scoringWorker, wasm: options.wasm });
  // Run one job: every call answers, with what it gave or the error it threw (an engine that didn't load fails each call with that error)
  const run = async ({ id, calls }: EngineRequest): Promise<void> => {
    for (const [index, { call, args }] of calls.entries()) {
      let reply: EngineReply;
      try {
        await ready;
        reply = { id, index, value: plain(await (CALLS[call] as (...args: unknown[]) => Promise<unknown>)(...args)) };
      } catch (error) {
        reply = { id, index, error: error instanceof Error ? error.message : String(error) };
      }
      scope.postMessage(reply);
    }
  };
  // Jobs run one at a time, in order
  let queue = Promise.resolve();
  scope.onmessage = ({ data }: MessageEvent<EngineRequest>) => {
    queue = queue.then(() => run(data));
  };
}
