// Search worker: answers every step search from an exact distance table when the goal is small enough, from split tables + IDA* when it's bigger,
// else with twips, keeping each target's solver (and every table) for later searches

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { DistanceTable, Searcher, SplitSearch } from "../search/pkg/puzzly_search.js";
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

// What every solver offers: same search contract (twips-style options, "No solution found!" when nothing fits), and freeing its memory
interface Solver {
  search(start: string, options: string): string;
  free(): void;
}

// A kept solver, the memory it holds, the cache keys of the sub-tables it uses (split searches),
// and for a split goal still on small sub-tables: its big plan and the search nodes the small one has used so far
interface Entry {
  solver: Solver;
  mb: number;
  uses?: string[];
  next?: { split: SplitSearch; spent: number };
}

// Biggest exact table to build, in states (also the sub-table limit of a split goal's big plan): up to ~5M states build in under half a second
const MAX_TABLE_STATES = 10_000_000;
// Sub-table limit of a split goal's first plan: small tables build in a fraction of a second, which is all shallow steps (F2L pairs…) need
const SMALL_TABLE_STATES = 1_000_000;
// A search node with small sub-tables costs about as much time as filling this many table states (~3 µs vs ~0.15 µs, measured)
const STATES_PER_NODE = 20;
// Memory the kept solvers may hold; past it the least recently used ones are freed
const MAX_CACHE_MB = 256;
// Twips's prune table size can't be read, so each Searcher counts as this much (most stay near 1 MB)
const SEARCHER_MB = 2;
// Error a split search gives when it used up its node budget (same text as the Rust side)
const NODE_LIMIT = "Node limit reached";

// Worker-side global (tsconfig only has the page's DOM types)
const scope = self as unknown as Worker;

// Load the Rust code once, when the worker starts
const ready = init({ module_or_path: wasmBytes });

// Kept solvers and tables by moves + target(s), least recently used first (a Map keeps insertion order)
const solvers = new Map<string, Entry>();
// Memory the kept solvers hold, in MB
let cacheMb = 0;

// Keep a new entry and count its memory
function keep(key: string, entry: Entry): void {
  solvers.set(key, entry);
  cacheMb += entry.mb;
}

// Mark an entry as just used (moved to the newest end)
function touch(key: string): void {
  const entry = solvers.get(key);
  if (!entry) return;
  solvers.delete(key);
  solvers.set(key, entry);
}

// Free an entry, and the split searches that use it (they hold its memory too)
function drop(key: string): void {
  const entry = solvers.get(key);
  if (!entry) return;
  solvers.delete(key);
  entry.solver.free();
  entry.next?.split.free();
  cacheMb -= entry.mb;
  for (const [other, user] of solvers) if (user.uses?.includes(key)) drop(other);
}

// Free the least recently used entries past the memory limit, sparing the ones about to be used
function trim(spare: Set<string>): void {
  for (const key of [...solvers.keys()]) {
    if (cacheMb <= MAX_CACHE_MB) break;
    if (!spare.has(key)) drop(key);
  }
}

// Cache key of a sub-table: moves + its targets (same format as a single goal's, so equal sub-goals share one table)
function tableKey(request: SearchRequest, targets: string): string {
  return `${request.moves.join(" ")}/${targets}`;
}

// Give a split search its sub-tables, from the cache or built now; returns their cache keys
function attachTables(split: SplitSearch, request: SearchRequest): string[] {
  const uses: string[] = [];
  for (let index = 0; index < split.tables(); index++) {
    const targets = split.targets(index);
    const key = tableKey(request, targets);
    let entry = solvers.get(key);
    if (!entry) {
      const table = new DistanceTable(request.kpuzzle, targets, JSON.stringify(request.moves), MAX_TABLE_STATES);
      entry = { solver: table, mb: table.bytes() / 2 ** 20 };
      keep(key, entry);
    }
    split.attach(index, entry.solver as DistanceTable);
    uses.push(key);
  }
  return uses;
}

// Estimated states of a split's sub-tables that aren't built yet (what switching to it would cost)
function missingStates(split: SplitSearch, request: SearchRequest): number {
  let states = 0;
  for (let index = 0; index < split.tables(); index++) if (!solvers.has(tableKey(request, split.targets(index)))) states += split.states(index);
  return states;
}

// A split search planned with this sub-table limit (null when the goal can't be split)
function plannedSplit(request: SearchRequest, maxStates: number): SplitSearch | null {
  try {
    return new SplitSearch(request.kpuzzle, `[${request.target}]`, JSON.stringify(request.moves), maxStates);
  } catch {
    return null;
  }
}

// A split goal's solver: small sub-tables first, with the big plan kept for later (dropped when it has the same tables)
function newSplit(request: SearchRequest): Entry | null {
  const small = plannedSplit(request, SMALL_TABLE_STATES);
  let big = plannedSplit(request, MAX_TABLE_STATES);
  // Same sub-tables either way: only one plan is needed
  if (small && big) {
    const smallTargets = new Set(Array.from({ length: small.tables() }, (_, index) => small.targets(index)));
    if (Array.from({ length: big.tables() }, (_, index) => big!.targets(index)).every((targets) => smallTargets.has(targets))) {
      big.free();
      big = null;
    }
  }
  // Start with whichever plan exists, the small one first
  const first = small ?? big;
  if (!first) return null;
  try {
    const uses = attachTables(first, request);
    return { solver: first, mb: 0, uses, next: small && big ? { split: big, spent: 0 } : undefined };
  } catch (error) {
    first.free();
    if (first !== big) big?.free();
    throw error;
  }
}

// A new solver for this target: an exact table if it fits, else split tables + IDA*, else twips
function newSolver(request: SearchRequest): Entry {
  try {
    const table = new DistanceTable(request.kpuzzle, `[${request.target}]`, JSON.stringify(request.moves), MAX_TABLE_STATES);
    return { solver: table, mb: table.bytes() / 2 ** 20 };
  } catch {
    // Too big for one table (or a layout it doesn't handle): try sub-tables
  }
  try {
    const split = newSplit(request);
    if (split) return split;
  } catch {
    // A sub-table that can't be built (too deep…): twips instead
  }
  return { solver: new Searcher(request.kpuzzle, request.target, JSON.stringify(request.moves)), mb: SEARCHER_MB };
}

// This target's solver, built on first use; the least recently used entries are freed past the memory limit
function entryFor(request: SearchRequest, key: string): Entry {
  // Reuse a kept one (moved to the newest end) or build it now
  let entry = solvers.get(key);
  if (entry) touch(key);
  else {
    entry = newSolver(request);
    keep(key, entry);
  }
  // A split search's sub-tables count as just used too
  for (const used of entry.uses ?? []) touch(used);
  trim(new Set([key, ...(entry.uses ?? [])]));
  return entry;
}

// Switch a split goal to its big plan (building its missing sub-tables); if one can't be built, it stays on the small plan
function upgrade(entry: Entry, request: SearchRequest, key: string): void {
  const big = entry.next!.split;
  entry.next = undefined;
  try {
    entry.uses = attachTables(big, request);
  } catch {
    big.free();
    return;
  }
  entry.solver.free();
  entry.solver = big;
  trim(new Set([key, ...entry.uses]));
}

// Answer one request: a split goal on small sub-tables may use as many search nodes as building its big plan's missing tables would cost, then switches
function search(request: SearchRequest): string {
  const key = `${request.moves.join(" ")}/${request.target}`;
  const entry = entryFor(request, key);
  const options = request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth };
  if (entry.next) {
    const small = entry.solver as SplitSearch;
    const allowed = Math.floor(missingStates(entry.next.split, request) / STATES_PER_NODE) - entry.next.spent;
    if (allowed > 0) {
      try {
        return small.search(request.start, JSON.stringify({ ...options, maxNodes: allowed }));
      } catch (error) {
        if (!String(error).includes(NODE_LIMIT)) throw error;
      } finally {
        entry.next.spent += small.nodes();
      }
    }
    // Out of budget (or the big tables are built already): search with the big plan from now on
    upgrade(entry, request, key);
  }
  return entry.solver.search(request.start, JSON.stringify(options));
}

// Run each request and post back its moves, or the error
scope.onmessage = async ({ data }: MessageEvent<SearchRequest>) => {
  await ready;
  try {
    scope.postMessage({ id: data.id, moves: search(data) });
  } catch (error) {
    scope.postMessage({ id: data.id, error: String(error) });
  }
};
