// Search worker: answers the engine's step searches (see solvers.ts for how each goal is solved), one request at a time; long split searches are spread
// over helper workers (parallel.ts). An app's worker script calls runSearchWorker once, passing the compiled Rust code and how to start helpers

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { DistanceTable, SplitSearch, type InitInput } from "../../../search/pkg/puzzly_search.js";
// Table sizes and memory budgets
import { HELPER_MB, MAX_HELPERS, STATES_PER_NODE, TABLE_DATABASE } from "./limits";
// Helper workers that search parts of long split searches
import { HelperPool, NODE_LIMIT, type HelperWorker, type ParallelGoal } from "./parallel";
// Requests as the engine sends them
import type { SearchRequest } from "./protocol";
// Solvers and tables kept between searches
import { entryFor, missingStates, planLimit, tableKey, tableOf, upgrade, watchSolvers, type Entry } from "./solvers";
// Tables stored in this browser
import { listStored, openTableStore } from "./table-store";

// What the app's worker script gives the search worker
export interface SearchWorkerOptions {
  // The compiled Rust search code (search/pkg/puzzly_search_bg.wasm): its bytes, a URL to fetch it from, or a compiled module
  wasm: InitInput | Promise<InitInput>;
  // Starts one helper: a worker whose script calls runSearchHelper (see search-helper.ts). Left out: every search stays on one core
  helper?: () => HelperWorker;
  // Most helpers to start (default 3): one per core the device reports beyond this worker's, up to this many (each holds copies of the tables it helps with)
  maxHelpers?: number;
  // Name of the IndexedDB database built tables are stored in (default "puzzly-tables"); null = don't store them
  tableDatabase?: string | null;
}

// Worker-side global, set when the worker starts (tsconfig only has the page's DOM types)
let scope: Worker;
// Request being answered, so table progress can name it
let current = -1;
// Helper workers for long split searches, started on the first one (null without a way to start them, or when the device reports a single core)
let pool: HelperPool | null = null;
// Each split search's goal id (how helpers know it)
const goalIds = new WeakMap<SplitSearch, number>();
let nextGoal = 0;
// Resolves once the Rust code is loaded and the stored tables are listed
let ready: Promise<void>;

// Tell the engine a table is being built or loaded (finished = false), or is done (true, with its states; 0 = it couldn't be built or loaded), for a "Building tables…" status
function progress(action: "build" | "load", finished: boolean, states = 0): void {
  scope.postMessage({ id: current, progress: finished ? { action, finished, states } : { action, finished } });
}

// How far the start is: the exact distance from a table, a lower bound from split tables (their largest distance), or null for twips (unknown);
// Infinity = no allowed moves reach the goal
async function measure(request: SearchRequest): Promise<{ bound: number | null; exact: boolean }> {
  const { solver } = await entryFor(request, tableKey(request, request.targets));
  if (solver instanceof DistanceTable) return { bound: solver.measure(request.start), exact: true };
  if (solver instanceof SplitSearch) return { bound: solver.measure(request.start), exact: false };
  return { bound: null, exact: false };
}

// Options a search or list takes (twips style, plus a node budget and list paging)
interface SearchOptions {
  maxDepth?: number;
  maxAnswers?: number;
  minDepth?: number;
  after?: string;
  maxNodes?: number;
}

// A split entry's goal as helpers rebuild it: the same plan inputs, and its sub-tables (entry.uses, in sub-table order) when they need copies
function parallelGoal(entry: Entry, request: SearchRequest): ParallelGoal {
  const split = entry.solver as SplitSearch;
  let id = goalIds.get(split);
  if (id === undefined) goalIds.set(split, (id = nextGoal++));
  const uses = entry.uses!;
  return {
    id,
    split,
    kpuzzle: request.kpuzzle,
    targets: request.targets,
    moves: JSON.stringify(request.moves),
    limit: planLimit(split),
    tables: () => uses.map((key, index) => ({ key, targets: split.targets(index), table: tableOf(key) })),
  };
}

// Ask an entry's solver for the request's answer (search), or for every answer as a JSON list of move texts (list; twips can only give its one answer);
// a split search goes through the helpers when there are some (its long iterations are spread over them), lists stay here
async function ask(entry: Entry, request: SearchRequest, options: SearchOptions): Promise<string> {
  const { solver } = entry;
  const text = JSON.stringify(options);
  if (request.kind !== "list") {
    if (pool && solver instanceof SplitSearch) return pool.search(parallelGoal(entry, request), request.start, options.maxDepth, options.maxNodes ?? Infinity);
    return solver.search(request.start, text);
  }
  if (solver instanceof DistanceTable || solver instanceof SplitSearch) return solver.list(request.start, text);
  return JSON.stringify([solver.search(request.start, text)]);
}

// Search nodes the last request on this split search used (a search through the helpers counts theirs too)
function nodesUsed(split: SplitSearch, request: SearchRequest): number {
  return pool && request.kind !== "list" ? pool.nodes : split.nodes();
}

// Answer one search or list: a split goal below its biggest plan may use as many search nodes as building the next plan's missing tables would cost, then switches
async function search(request: SearchRequest): Promise<string> {
  const key = tableKey(request, request.targets);
  const entry = await entryFor(request, key);
  const options: SearchOptions = {
    ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
    ...(request.maxAnswers === undefined ? {} : { maxAnswers: request.maxAnswers }),
    ...(request.minDepth === undefined ? {} : { minDepth: request.minDepth }),
    ...(request.after === undefined ? {} : { after: request.after }),
  };
  while (entry.next) {
    const split = entry.solver as SplitSearch;
    const allowed = Math.floor(missingStates(entry.next.plans[0], request) / STATES_PER_NODE) - entry.next.spent;
    if (allowed > 0) {
      try {
        return await ask(entry, request, { ...options, maxNodes: allowed });
      } catch (error) {
        if (!String(error).includes(NODE_LIMIT)) throw error;
      } finally {
        entry.next.spent += nodesUsed(split, request);
      }
    }
    // Out of budget (or the next plan's tables are kept or stored already): search with the next plan from now on
    await upgrade(entry, request, key);
  }
  return ask(entry, request, options);
}

// Answer one request and post back its bound, moves or list of answers, or the error
async function answer(request: SearchRequest): Promise<void> {
  await ready;
  current = request.id;
  try {
    if (request.kind === "measure") scope.postMessage({ id: request.id, ...(await measure(request)) });
    else if (request.kind === "list") scope.postMessage({ id: request.id, answers: JSON.parse(await search(request)) });
    else scope.postMessage({ id: request.id, moves: await search(request) });
  } catch (error) {
    scope.postMessage({ id: request.id, error: String(error) });
  }
}

// Start answering the engine's requests in this worker: load the Rust code, open the stored tables, set up the helpers; call it once from the worker's script
export function runSearchWorker(options: SearchWorkerOptions): void {
  scope = self as unknown as Worker;
  // Helpers for long split searches: one per core the device reports beyond this worker's, up to the limit (none without a way to start them)
  const helpers = options.helper ? Math.max(0, Math.min((globalThis.navigator?.hardwareConcurrency ?? 1) - 1, options.maxHelpers ?? MAX_HELPERS)) : 0;
  pool = helpers > 0 ? new HelperPool(options.helper!, helpers, HELPER_MB) : null;
  // Table work goes to the engine as progress; a freed split search frees the helpers' copy of it too
  watchSolvers({
    progress,
    freed: (split) => {
      const id = goalIds.get(split);
      if (id !== undefined) pool?.dropGoal(id);
    },
  });
  // The stored-tables database (opened while the Rust code loads), then which tables it holds
  openTableStore(options.tableDatabase === undefined ? TABLE_DATABASE : options.tableDatabase);
  ready = init({ module_or_path: options.wasm }).then(listStored);
  // Requests run one at a time, in order (loading a stored table waits, and the next request mustn't start meanwhile)
  let queue = Promise.resolve();
  scope.onmessage = ({ data }: MessageEvent<SearchRequest>) => {
    queue = queue.then(() => answer(data));
  };
}
