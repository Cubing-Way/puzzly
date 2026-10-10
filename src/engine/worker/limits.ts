// Search worker limits: table sizes and memory budgets, picked from the memory the device reports

// This device's memory in GB as the browser reports it (Chrome and Edge round it and report at most 8), or null where it isn't reported (Firefox, Safari, Node)
const DEVICE_GB: number | null = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? null;
// Biggest exact table to build for a whole goal, in states: up to 10M build in about a second, so a goal's first answer never waits on a bigger build
export const MAX_TABLE_STATES = 10_000_000;
// Sub-table limit of a split goal's big plan: 40M on devices with 8 GB or more (F2L-type plans then see 6 edges together: 3–4× fewer search nodes, but one method's
// big plans may hold ~350 MB), else 10M (20M was measured too: little gain, since the next useful tables are 21M and up)
const BIG_TABLE_STATES = DEVICE_GB !== null && DEVICE_GB >= 8 ? 40_000_000 : MAX_TABLE_STATES;
// Sub-table limit of a split goal's first plan: small tables build in a fraction of a second, which is all shallow steps (F2L pairs…) need
const SMALL_TABLE_STATES = 1_000_000;
// Sub-table limits of a split goal's plans, smallest first: it moves up one plan at a time (going straight from 1M to 40M kept goals on small tables
// for 20× as many nodes, and a warm XXXCross took 10× longer)
export const PLAN_STATES = [...new Set([SMALL_TABLE_STATES, MAX_TABLE_STATES, BIG_TABLE_STATES])];
// A search node with small sub-tables costs about as much time as filling this many table states (~3 µs vs ~0.15 µs, measured)
export const STATES_PER_NODE = 20;
// Memory the kept solvers may hold; past it the least recently used ones are freed (with 40M big plans, enough for one method's whole set)
export const MAX_CACHE_MB = BIG_TABLE_STATES > MAX_TABLE_STATES ? 512 : 256;
// Twips's prune table size can't be read, so each Searcher counts as this much (most stay near 1 MB)
export const SEARCHER_MB = 2;
// Most helper workers for long searches, unless the app sets its own: each holds copies of the tables of the goals it helps with, so memory grows with them (3 helpers = 4 copies)
export const MAX_HELPERS = 3;
// Tables each helper may hold (the goal being searched always fits, whatever its size); past it, the goals helped least recently are freed
export const HELPER_MB = MAX_CACHE_MB / 2;
// Tables with at least this many states (4 per byte, so ~25 KB) are stored in this browser: they take 0.1–0.8 s to build but load in a few ms (tinier ones build about as fast)
export const STORE_MIN_STATES = 100_000;
// IndexedDB database the tables are stored in, unless the app names its own
export const TABLE_DATABASE = "puzzly-tables";
