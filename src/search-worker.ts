// Search worker: answers every step search from an exact distance table when the goal is small enough, from split tables + IDA* when it's bigger,
// else with twips, keeping each goal's solver (and every table) for later searches; tables of 100k states and up are also stored in this browser (IndexedDB),
// so after a reload (or in a fresh worker) they load in a few ms instead of being rebuilt

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { DistanceTable, Searcher, SplitSearch, tableFormat } from "../search/pkg/puzzly_search.js";
// The compiled Rust code, bundled in as bytes
import wasmBytes from "../search/pkg/puzzly_search_bg.wasm";

// One request from the engine: puzzle and start as JSON, targets as a JSON list (one pattern per offset the goal counts up to, any one counts);
// "measure" asks how far the start is (exact distance, or a lower bound), "search" asks for the moves, "list" for every answer shorter than maxDepth (up to maxAnswers)
interface Request {
  id: number;
  kind: "measure" | "search" | "list";
  kpuzzle: string;
  start: string;
  targets: string;
  moves: string[];
  maxDepth?: number;
  maxAnswers?: number;
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
// Tables with at least this many states (2 per byte, so ~50 KB) are stored in this browser: they take 0.1–0.8 s to build but load in a few ms (tinier ones build about as fast)
const STORE_MIN_STATES = 100_000;
// IndexedDB database and object store holding the stored tables (key: table format / moves / targets, value: the table's bytes)
const DB_NAME = "puzzly-tables";
const DB_STORE = "tables";

// Worker-side global (tsconfig only has the page's DOM types)
const scope = self as unknown as Worker;

// Kept solvers and tables by moves + targets, least recently used first (a Map keeps insertion order)
const solvers = new Map<string, Entry>();
// Memory the kept solvers hold, in MB
let cacheMb = 0;
// Keys (moves + targets) of the tables stored in this browser for the current table format
const stored = new Set<string>();
// Request being answered, so table progress can name it
let current = -1;

// The stored-tables database, or null when this browser can't open one (private window, blocked storage, Node tests…)
const database = openDatabase();
// Load the Rust code, then list the stored tables
const ready = init({ module_or_path: wasmBytes }).then(listStored);

// An IndexedDB request as a promise
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Open (or create) the stored-tables database; null when IndexedDB isn't there or refuses
function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Key of a table in the database: the table format first, so tables saved by an older format are never read as current ones
function storeKey(key: string): string {
  return `${tableFormat()}/${key}`;
}

// Note which tables are stored, deleting the ones saved by another table format (they'd never be read again)
async function listStored(): Promise<void> {
  const db = await database;
  if (!db) return;
  try {
    const prefix = storeKey("");
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    for (const key of await result(store.getAllKeys())) {
      if (String(key).startsWith(prefix)) stored.add(String(key).slice(prefix.length));
      else store.delete(key);
    }
  } catch {
    // Unreadable database: tables are built as if nothing was stored
  }
}

// Store a built table's bytes (in the background: a full disk or blocked storage only means it's built again next time)
async function storeTable(key: string, bytes: Uint8Array): Promise<void> {
  const db = await database;
  if (!db) return;
  try {
    await result(db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(bytes, storeKey(key)));
    stored.add(key);
  } catch {
    // Not stored: nothing else to do
  }
}

// Tell the engine a table is being built or loaded (finished = false), or is done (true, with its states; 0 = it couldn't be built or loaded), for a "Building tables…" status
function progress(action: "build" | "load", finished: boolean, states = 0): void {
  scope.postMessage({ id: current, progress: finished ? { action, finished, states } : { action, finished } });
}

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

// Cache key of a table or a goal's solver: moves + targets (sub-tables use the same format, so equal sub-goals share one table)
function tableKey(request: Request, targets: string): string {
  return `${request.moves.join(" ")}/${targets}`;
}

// A table stored in this browser, loaded (null when it isn't stored, or its bytes don't fit this goal any more)
async function loadTable(request: Request, key: string, targets: string): Promise<DistanceTable | null> {
  const db = await database;
  if (!db || !stored.has(key)) return null;
  progress("load", false);
  try {
    const bytes = await result<Uint8Array>(db.transaction(DB_STORE).objectStore(DB_STORE).get(storeKey(key)));
    const table = DistanceTable.fromBytes(request.kpuzzle, targets, JSON.stringify(request.moves), bytes);
    progress("load", true, table.states());
    return table;
  } catch {
    // Missing or stale bytes: build it again (and store the new one)
    stored.delete(key);
    progress("load", true);
    return null;
  }
}

// Build a table now (throws when it's too big or too deep for one), storing it in this browser when it's big
function buildTable(request: Request, key: string, targets: string): DistanceTable {
  progress("build", false);
  let table: DistanceTable;
  try {
    table = new DistanceTable(request.kpuzzle, targets, JSON.stringify(request.moves), MAX_TABLE_STATES);
  } catch (error) {
    progress("build", true);
    throw error;
  }
  progress("build", true, table.states());
  if (table.states() >= STORE_MIN_STATES) void storeTable(key, table.toBytes());
  return table;
}

// The table for these targets: kept, stored in this browser, or built now; returns its cache key
async function tableFor(request: Request, targets: string): Promise<string> {
  const key = tableKey(request, targets);
  if (solvers.get(key)?.solver instanceof DistanceTable) return key;
  // Something else under this key (a goal that fell back to twips): replace it
  drop(key);
  const table = (await loadTable(request, key, targets)) ?? buildTable(request, key, targets);
  keep(key, { solver: table, mb: table.bytes() / 2 ** 20 });
  return key;
}

// Give a split search its sub-tables, from the cache, this browser's store, or built now; returns their cache keys
async function attachTables(split: SplitSearch, request: Request): Promise<string[]> {
  const uses: string[] = [];
  for (let index = 0; index < split.tables(); index++) {
    const key = await tableFor(request, split.targets(index));
    split.attach(index, solvers.get(key)!.solver as DistanceTable);
    uses.push(key);
  }
  return uses;
}

// Estimated states of a split's sub-tables that would have to be built (kept and stored ones count as built)
function missingStates(split: SplitSearch, request: Request): number {
  let states = 0;
  for (let index = 0; index < split.tables(); index++) {
    const key = tableKey(request, split.targets(index));
    if (!solvers.has(key) && !stored.has(key)) states += split.states(index);
  }
  return states;
}

// A split search planned with this sub-table limit (null when the goal can't be split)
function plannedSplit(request: Request, maxStates: number): SplitSearch | null {
  try {
    return new SplitSearch(request.kpuzzle, request.targets, JSON.stringify(request.moves), maxStates);
  } catch {
    return null;
  }
}

// A split goal's solver: small sub-tables first, with the big plan kept for later (dropped when it has the same tables);
// when the big plan's tables are all kept or stored already, it starts on the big plan
async function newSplit(request: Request): Promise<Entry | null> {
  let small = plannedSplit(request, SMALL_TABLE_STATES);
  let big = plannedSplit(request, MAX_TABLE_STATES);
  // Same sub-tables either way: only one plan is needed
  if (small && big) {
    const smallTargets = new Set(Array.from({ length: small.tables() }, (_, index) => small!.targets(index)));
    if (Array.from({ length: big.tables() }, (_, index) => big!.targets(index)).every((targets) => smallTargets.has(targets))) {
      big.free();
      big = null;
    }
  }
  // Big plan with nothing left to build: no need for the small one
  if (small && big && missingStates(big, request) === 0) {
    small.free();
    small = null;
  }
  // Start with whichever plan exists, the small one first
  const first = small ?? big;
  if (!first) return null;
  try {
    const uses = await attachTables(first, request);
    return { solver: first, mb: 0, uses, next: small && big ? { split: big, spent: 0 } : undefined };
  } catch (error) {
    first.free();
    if (first !== big) big?.free();
    throw error;
  }
}

// A new solver for this goal: an exact table if it fits (stored or built), else split tables + IDA*, else twips
async function newSolver(request: Request, key: string): Promise<Entry> {
  try {
    const table = (await loadTable(request, key, request.targets)) ?? buildTable(request, key, request.targets);
    return { solver: table, mb: table.bytes() / 2 ** 20 };
  } catch {
    // Too big for one table (or a layout it doesn't handle): try sub-tables
  }
  try {
    const split = await newSplit(request);
    if (split) return split;
  } catch {
    // A sub-table that can't be built (too deep…): twips instead
  }
  return { solver: new Searcher(request.kpuzzle, request.targets, JSON.stringify(request.moves)), mb: SEARCHER_MB };
}

// This goal's solver, built on first use; the least recently used entries are freed past the memory limit
async function entryFor(request: Request, key: string): Promise<Entry> {
  // Reuse a kept one (moved to the newest end) or make it now
  let entry = solvers.get(key);
  if (entry) touch(key);
  else {
    entry = await newSolver(request, key);
    keep(key, entry);
  }
  // A split search's sub-tables count as just used too
  for (const used of entry.uses ?? []) touch(used);
  trim(new Set([key, ...(entry.uses ?? [])]));
  return entry;
}

// Switch a split goal to its big plan (loading or building its missing sub-tables); if one can't be built, it stays on the small plan
async function upgrade(entry: Entry, request: Request, key: string): Promise<void> {
  const big = entry.next!.split;
  entry.next = undefined;
  try {
    entry.uses = await attachTables(big, request);
  } catch {
    big.free();
    return;
  }
  entry.solver.free();
  entry.solver = big;
  trim(new Set([key, ...entry.uses]));
}

// How far the start is: the exact distance from a table, a lower bound from split tables (their largest distance), or null for twips (unknown);
// Infinity = no allowed moves reach the goal
async function measure(request: Request): Promise<{ bound: number | null; exact: boolean }> {
  const { solver } = await entryFor(request, tableKey(request, request.targets));
  if (solver instanceof DistanceTable) return { bound: solver.measure(request.start), exact: true };
  if (solver instanceof SplitSearch) return { bound: solver.measure(request.start), exact: false };
  return { bound: null, exact: false };
}

// Ask a solver for the request's answer (search), or for every answer as a JSON list of move texts (list; twips can only give its one answer)
function ask(solver: Solver, request: Request, options: object): string {
  const text = JSON.stringify(options);
  if (request.kind !== "list") return solver.search(request.start, text);
  if (solver instanceof DistanceTable || solver instanceof SplitSearch) return solver.list(request.start, text);
  return JSON.stringify([solver.search(request.start, text)]);
}

// Answer one search or list: a split goal on small sub-tables may use as many search nodes as building its big plan's missing tables would cost, then switches
async function search(request: Request): Promise<string> {
  const key = tableKey(request, request.targets);
  const entry = await entryFor(request, key);
  const options = {
    ...(request.maxDepth === undefined ? {} : { maxDepth: request.maxDepth }),
    ...(request.maxAnswers === undefined ? {} : { maxAnswers: request.maxAnswers }),
  };
  if (entry.next) {
    const small = entry.solver as SplitSearch;
    const allowed = Math.floor(missingStates(entry.next.split, request) / STATES_PER_NODE) - entry.next.spent;
    if (allowed > 0) {
      try {
        return ask(small, request, { ...options, maxNodes: allowed });
      } catch (error) {
        if (!String(error).includes(NODE_LIMIT)) throw error;
      } finally {
        entry.next.spent += small.nodes();
      }
    }
    // Out of budget (or the big tables are kept or stored already): search with the big plan from now on
    await upgrade(entry, request, key);
  }
  return ask(entry.solver, request, options);
}
// Answer one request and post back its bound, moves or list of answers, or the error
async function answer(request: Request): Promise<void> {
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

// Requests run one at a time, in order (loading a stored table waits, and the next request mustn't start meanwhile)
let queue = Promise.resolve();
scope.onmessage = ({ data }: MessageEvent<Request>) => {
  queue = queue.then(() => answer(data));
};
