// Search worker: answers every step search, from an exact distance table when the goal is small enough (else twips), keeping each target's solver

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { DistanceTable, Searcher } from "../search/pkg/puzzly_search.js";
// The compiled Rust code, bundled in as bytes
import wasmBytes from "../search/pkg/puzzly_search_bg.wasm";

// One search request from the engine (puzzle, start and target as JSON)
interface SearchRequest {
  id: number;
  kpuzzle: string;
  start: string;
  target: string;
  moves: string[];
  maxDepth?: number;
}

// What both solvers offer: same search contract (twips-style options, "No solution found!" when nothing fits), and freeing their memory
interface Solver {
  search(start: string, options: string): string;
  free(): void;
}

// A kept solver and the memory it holds
interface Entry {
  solver: Solver;
  mb: number;
}

// Biggest exact table to build, in states: up to ~5M states build in under half a second, while an XCross table (73M) takes ~5 s and twips answers XCross in ~0.1 s
const MAX_TABLE_STATES = 10_000_000;
// Memory the kept solvers may hold; past it the least recently used ones are freed
const MAX_CACHE_MB = 256;
// Twips's prune table size can't be read, so each Searcher counts as this much (most stay near 1 MB)
const SEARCHER_MB = 2;

// Worker-side global (tsconfig only has the page's DOM types)
const scope = self as unknown as Worker;

// Load the Rust code once, when the worker starts
const ready = init({ module_or_path: wasmBytes });

// Kept solvers by moves + target, least recently used first (a Map keeps insertion order)
const solvers = new Map<string, Entry>();
// Memory the kept solvers hold, in MB
let cacheMb = 0;

// A new solver for this target: an exact table if it fits (and builds), otherwise twips
function newSolver(request: SearchRequest): Entry {
  const moves = JSON.stringify(request.moves);
  try {
    const table = new DistanceTable(request.kpuzzle, `[${request.target}]`, moves, MAX_TABLE_STATES);
    return { solver: table, mb: table.bytes() / 2 ** 20 };
  } catch {
    // Too big for one table (or a layout it doesn't handle): twips searches instead
    return { solver: new Searcher(request.kpuzzle, request.target, moves), mb: SEARCHER_MB };
  }
}

// This target's solver, built on first use; the least recently used ones are freed past the memory limit
function solverFor(request: SearchRequest): Solver {
  const key = `${request.moves.join(" ")}/${request.target}`;
  // Reuse a kept one (moved to the newest end) or build it now
  let entry = solvers.get(key);
  if (entry) solvers.delete(key);
  else {
    entry = newSolver(request);
    cacheMb += entry.mb;
  }
  solvers.set(key, entry);
  // Free the least recently used solvers past the limit (never the one about to be used)
  for (const [oldKey, old] of solvers) {
    if (cacheMb <= MAX_CACHE_MB || oldKey === key) break;
    old.solver.free();
    cacheMb -= old.mb;
    solvers.delete(oldKey);
  }
  return entry.solver;
}

// Run each request and post back its moves, or the error
scope.onmessage = async ({ data }: MessageEvent<SearchRequest>) => {
  await ready;
  try {
    const options = data.maxDepth === undefined ? {} : { maxDepth: data.maxDepth };
    const moves = solverFor(data).search(data.start, JSON.stringify(options));
    scope.postMessage({ id: data.id, moves });
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error) });
  }
};
