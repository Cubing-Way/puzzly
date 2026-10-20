// Worker limits: table sizes and memory budgets, picked from the memory the device reports, and how many helpers the workers start

// This device's memory in GB as the browser reports it (Chrome and Edge round it and report at most 8), or null where it isn't reported (Firefox, Safari, Node)
const DEVICE_GB: number | null = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory ?? null;
// Biggest exact table to build for a whole goal, in states: up to 10M build in about a second, so a goal's first answer never waits on a bigger build
export const MAX_TABLE_STATES = 10_000_000;
// Sub-table limit of a split goal's big plan: 40M on devices with 8 GB or more (F2L-type plans then see 6 edges together: 3–4× fewer search nodes, but one method's
// big plans may hold ~350 MB), else 10M (20M was measured too: little gain, since the next useful tables are 21M and up)
const BIG_TABLE_STATES = DEVICE_GB !== null && DEVICE_GB >= 8 ? 40_000_000 : MAX_TABLE_STATES;
// Sub-table limit of a split goal's smallest plan: small tables build in a fraction of a second (the last fallback when bigger ones can't be built)
const SMALL_TABLE_STATES = 1_000_000;
// Sub-table limits of a split goal's plans, smallest first: a goal takes the biggest whose tables can be built (the smaller ones are fallbacks). It used
// to start small and move up after enough search nodes, which made a run's lists depend on what ran before it
export const PLAN_STATES = [...new Set([SMALL_TABLE_STATES, MAX_TABLE_STATES, BIG_TABLE_STATES])];
// Memory the kept solvers may hold; past it the least recently used ones are freed (with 40M big plans, enough for one method's whole set)
export const MAX_CACHE_MB = BIG_TABLE_STATES > MAX_TABLE_STATES ? 512 : 256;
// Twips's prune table size can't be read, so each Searcher counts as this much (most stay near 1 MB)
export const SEARCHER_MB = 2;
// Most helper workers for long searches, unless the app sets its own: each holds copies of the tables of the goals it helps with, so memory grows with them (3 helpers = 4 copies)
export const MAX_HELPERS = 3;
// Most scoring helpers, unless the app sets its own: each works out looks and writings ahead of the scoring worker
export const MAX_SCORING_HELPERS = 2;
// Devices reporting this many threads or fewer start no scoring helper: on 2 cores the page's search and the scoring worker already keep both busy, so
// helpers only share them out (measured on 2 cores, 4 threads: the same speed on level 2, 7% slower on level 3, ~70% more CPU). Above it, one helper per
// 2 threads more, up to MAX_SCORING_HELPERS
export const SCORING_HELPER_THREADS = 4;
// Tables each helper may hold (the goal being searched always fits, whatever its size); past it, the goals helped least recently are freed
export const HELPER_MB = MAX_CACHE_MB / 2;
// Tables with at least this many states (4 per byte, so ~25 KB) are stored in this browser: they take 0.1–0.8 s to build but load in a few ms (tinier ones build about as fast)
export const STORE_MIN_STATES = 100_000;
// IndexedDB database the tables are stored in, unless the app names its own
export const TABLE_DATABASE = "puzzly-tables";
