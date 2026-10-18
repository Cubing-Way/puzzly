// The search worker's solvers: per goal an exact distance table when it's small enough, split tables + IDA* when it's bigger (always its biggest plan,
// so a goal searches the same way whatever came before), else twips. Every solver and table is kept for later searches; the least recently used are freed past a memory limit

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import { DistanceTable, Searcher, SplitSearch } from "../../../search/pkg/puzzly_search.js";
// Table sizes and memory budgets
import { MAX_CACHE_MB, MAX_TABLE_STATES, PLAN_STATES, SEARCHER_MB, STORE_MIN_STATES } from "./limits";
// Requests as the engine sends them
import type { SearchRequest } from "./protocol";
// Tables stored in this browser
import { forgetStored, isStored, readStored, storeTable } from "./table-store";

// What every solver offers: same search contract (twips-style options, "No solution found!" when nothing fits), and freeing its memory
interface Solver {
  search(start: string, options: string): string;
  free(): void;
}

// A kept solver, the memory it holds, and the cache keys of the sub-tables it uses (split searches)
export interface Entry {
  solver: Solver;
  mb: number;
  uses?: string[];
}

// Who hears about the solvers: table builds and loads as they start and finish (states: 0 = it couldn't be built or loaded),
// and split searches about to be freed (whoever holds copies of them frees those too)
interface SolverListeners {
  progress: (action: "build" | "load", finished: boolean, states?: number) => void;
  freed: (split: SplitSearch) => void;
}

// Kept solvers and tables by moves + targets, least recently used first (a Map keeps insertion order)
const solvers = new Map<string, Entry>();
// Memory the kept solvers hold, in MB
let cacheMb = 0;
// The sub-table limit each split search was planned with (helpers plan it again the same way)
const planLimits = new WeakMap<SplitSearch, number>();
// The search worker's listeners (none until it starts)
let listeners: SolverListeners = { progress: () => {}, freed: () => {} };

// Set who hears about table work and freed split searches
export function watchSolvers(next: SolverListeners): void {
  listeners = next;
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

// Free a solver, telling the listeners first when it's a split search (helpers may hold a copy)
function release(solver: Solver): void {
  if (solver instanceof SplitSearch) listeners.freed(solver);
  solver.free();
}

// Free an entry, and the split searches that use it (they hold its memory too)
function drop(key: string): void {
  const entry = solvers.get(key);
  if (!entry) return;
  solvers.delete(key);
  release(entry.solver);
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
export function tableKey(request: SearchRequest, targets: string): string {
  return `${request.moves.join(" ")}/${targets}`;
}

// The kept table under a cache key (a split search's sub-table, by one of its entry's `uses`)
export function tableOf(key: string): DistanceTable {
  return solvers.get(key)!.solver as DistanceTable;
}

// The sub-table limit a split search was planned with
export function planLimit(split: SplitSearch): number {
  return planLimits.get(split)!;
}

// A table stored in this browser, loaded (null when it isn't stored, or its bytes don't fit this goal any more)
async function loadTable(request: SearchRequest, key: string, targets: string): Promise<DistanceTable | null> {
  if (!isStored(key)) return null;
  listeners.progress("load", false);
  try {
    const table = DistanceTable.fromBytes(request.kpuzzle, targets, JSON.stringify(request.moves), await readStored(key));
    listeners.progress("load", true, table.states());
    return table;
  } catch {
    // Missing or stale bytes: build it again (and store the new one)
    forgetStored(key);
    listeners.progress("load", true);
    return null;
  }
}

// Build a table now (throws when it's too big or too deep for one), storing it in this browser when it's big
function buildTable(request: SearchRequest, key: string, targets: string, maxStates = MAX_TABLE_STATES): DistanceTable {
  listeners.progress("build", false);
  let table: DistanceTable;
  try {
    table = new DistanceTable(request.kpuzzle, targets, JSON.stringify(request.moves), maxStates);
  } catch (error) {
    listeners.progress("build", true);
    throw error;
  }
  listeners.progress("build", true, table.states());
  if (table.states() >= STORE_MIN_STATES) void storeTable(key, table.toBytes());
  return table;
}

// The table for these targets (built with up to maxStates states): kept, stored in this browser, or built now; returns its cache key
async function tableFor(request: SearchRequest, targets: string, maxStates = MAX_TABLE_STATES): Promise<string> {
  const key = tableKey(request, targets);
  if (solvers.get(key)?.solver instanceof DistanceTable) return key;
  // Something else under this key (a goal that fell back to twips): replace it
  drop(key);
  const table = (await loadTable(request, key, targets)) ?? buildTable(request, key, targets, maxStates);
  keep(key, { solver: table, mb: table.bytes() / 2 ** 20 });
  return key;
}

// Give a split search its sub-tables, from the cache, this browser's store, or built now; returns their cache keys
// (each may be as big as planned: a BLD goal's whole-orbit table, e.g. all 8 corners, is past the usual limit)
async function attachTables(split: SplitSearch, request: SearchRequest): Promise<string[]> {
  const uses: string[] = [];
  for (let index = 0; index < split.tables(); index++) {
    const key = await tableFor(request, split.targets(index), Math.max(MAX_TABLE_STATES, split.states(index)));
    split.attach(index, tableOf(key));
    uses.push(key);
  }
  return uses;
}

// A split search planned with this sub-table limit (null when the goal can't be split)
function plannedSplit(request: SearchRequest, maxStates: number): SplitSearch | null {
  try {
    const split = new SplitSearch(request.kpuzzle, request.targets, JSON.stringify(request.moves), maxStates);
    planLimits.set(split, maxStates);
    return split;
  } catch {
    return null;
  }
}

// A split goal's solver: planned with the biggest sub-tables the device allows (kept, stored in this browser, or built now), else the next smaller plan
// when its tables can't be built. Always the biggest, so a search or a list reaches as far whatever was searched before it: a goal that started on small
// tables and moved up after enough search nodes listed other answers within the same node budget on a later run (null when the goal can't be split)
async function newSplit(request: SearchRequest): Promise<Entry | null> {
  let lastError: unknown = null;
  let planned = false;
  // Biggest limit first
  for (const limit of [...PLAN_STATES].reverse()) {
    const plan = plannedSplit(request, limit);
    if (!plan) continue;
    planned = true;
    try {
      return { solver: plan, mb: 0, uses: await attachTables(plan, request) };
    } catch (error) {
      // A sub-table that can't be built: the next smaller plan
      plan.free();
      lastError = error;
    }
  }
  if (planned) throw lastError;
  return null;
}

// A new solver for this goal: an exact table if it fits (stored or built), else split tables + IDA*, else twips
async function newSolver(request: SearchRequest, key: string): Promise<Entry> {
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
export async function entryFor(request: SearchRequest, key: string): Promise<Entry> {
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
