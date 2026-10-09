# puzzly — engine roadmap (context for new chats)

Start a new chat with: "Read PLAN.md, then do Part N." Do **one part per chat**, then tick it below and commit.

## Progress

- [x] Part 1 — Groups + centers
- [x] Part 2 — Offsets
- [x] Part 3 — Methods (step list) + keep previous
- [x] Part 4 — Alternatives
- [x] Rust search worker (one worker per session, twips tables kept between searches; done outside the numbered parts)
- [x] Part 5a — Exact distance tables (Rust): goals that fit one table, answered without searching
- [x] Part 5b — Split tables + IDA* (Rust): goals too big for one table
- [x] Part 5c — Rank combos by exact distance + table lifecycle (IndexedDB, idle stop)
- [ ] Part 5d — Table files: option to download (export) a method's tables and load them back
- [x] Part 6 — Lookahead across steps (pseudo-slotting, multislotting)
- [x] Part 7a — Whole-state check "Solvable with" moves (2-gen CP, any "these moves can finish it" goal)
- [x] Part 7b — Pieces solved relative to each other anywhere (pair joined anywhere, FMC pseudo-blocks)
- [x] Part 7c — BLD: untouched pieces, buffer tracing, parity, repeated steps
- [x] Part 8a — Benchmark harness + faster search nodes
- [x] Part 8b — Spot classes, exact size estimates, twist parity (sharper tables)
- [x] Part 8c — Inverse and symmetric lookups on the same tables (rotated copies share one table; inverse lookups measured, not kept)
- [x] Part 8d — Anytime method search (method-optimal branch-and-bound, Kociemba-style)
- [x] Part 8e — Method lower bounds: prune the method search with the goals of all later steps, not just the next one
- [ ] Part 8f — Table capacity: 2-bit tables, smarter planner, memory-based budget (only if the benchmark says tables are the limit)
- [ ] Part 8g — Symmetry-reduced numbering (only if still needed)
- [ ] Part 8h — Parallel search (only if still needed)
- [ ] Part 9 — Hand-written tables for specific goals (last resort)

## Goal of the project

A 3x3 step solver where **end users configure methods with plain inputs** (pieces, options), not code.
The engine must stay method-agnostic: it never knows what "cross" or "pseudo-slotting" is.
Every step compiles to: **masked target patterns × grips × offsets (× alternatives)**, one twips search each, shortest answer wins.

## Current state (commit 2233c8a "Orientation/permutation roles and grips")

- Stack: TypeScript, cubing.js **0.63.8**, barely-a-dev-server (esbuild). `npm run dev` → http://localhost:1234.
- `src/engine.ts` — all cube logic, no page code. `src/main.ts` — test bench page. `src/index.html`, `src/index.css`.
- **Goal text**: space-separated piece names with an optional role suffix:
  - `UF` = solved (home, oriented) · `UF:o` = oriented only (may swap with other `:o` pieces of its type) · `UF:p` = in place, any twist · not listed = ignored.
  - All 6 centers are always kept (`goalFromText`).
- **Masking** (`maskPattern`): ignored pieces → one shared id + `orientationMod` 1; `:o` pieces → another shared id, orientation kept; `:p` → own id, `orientationMod` 1.
  Shared ids are picked from the goal's piece numbers (not from spots) so start and target agree.
- **Grips** (color/slot neutrality): `gripRotations(bottoms, anyFront)` → rotations like `x2`, `z y`.
  `heldPattern(moves, rotation)` renumbers the cube so piece numbers = "home spot in that grip" (centers back home),
  using `netRotation(moves)` (grip found from where the centers are). So scrambles with rotations / wide / slice moves work.
  `solveStep` tries each grip, skips grips asking for the same physical pieces (unless a `:o` piece makes the frame matter),
  tightens `maxDepth` to "shorter than best so far", returns `{ solution (rotation + moves), rotation, searches }`.
- `goalOnCube(text, moves)` maps goal spots to physical pieces (used for the viewer mask).
- `reachesGoal(scramble, solution, pieces)` checks the result in the grip the solution ends in.
- `countMoves` ignores x/y/z rotations.
- UI: chips cycle solve → `:o` → `:p` → off; presets (Cross, XCross, First layer, EO, EOLine, CO, CP);
  "Bottom face" checkboxes + "any front (y turns)"; Offsets field + AUF/ADF picks; status says "best of N searches".

## Facts worth knowing (save re-checking)

- Search: `solveStep` calls `searchTwips(kpuzzle, start, { targetPattern, generatorMoves, maxDepth })` (engine.ts), which posts to one session-long worker (`src/search-worker.ts`)
  running the Rust `Searcher` (`search/src/lib.rs`, twips 0.12.3 crate). It rejects with `Error("No solution found!")` when nothing fits `maxDepth`. Duplicate piece ids + `orientationMod` work in twips.
  (`experimentalSolveTwips` is no longer used: it started 2 workers per search and never stopped them.)
- Piece numbers: EDGES `UF UR UB UL DF DR DB DL FR FL BR BL`, CORNERS `UFR UBR UBL UFL DFR DFL DBL DBR`, CENTERS `U L F R B D`.
- Orientation: corners judged by their U/D sticker; edges use F/B-axis EO (ZZ style). `orientationMod` 1 = ignore orientation.
- Viewer mask letters (`experimentalStickeringMaskOrbits`, per physical piece): `-` regular, `I` ignored, `O` only primary sticker, `P` primary dimmed, `D` dim, `X` invisible.
- Default colors: U white, D yellow, F green, B blue, R red, L orange.
- Testing that worked: copy the project to the scratchpad, junction `node_modules`, bundle a test with
  `node_modules/.bin/esbuild test.ts --bundle --platform=node --format=esm --packages=external` and run it with `node` (cubing/search works in Node).
  For the page, run a dev server on another port (1234 is usually busy) and use the built-in browser.
- Grip rule (Part 1): grip = `netRotation(scramble)` (centers) + only the x/y/z in `done` (earlier steps). Engine calls take `done` (`StepOptions.done`, `goalOnCube(text, scramble, done)`, `reachesGoal(scramble, done + solution, pieces)`). Part 3's `runMethod` must pass previous solutions as `done`, never fold them into the scramble.
- Roles are strings `solve | place | orientN | swapN` (`roleFromSuffix` / `roleSuffix`). Grips merge only when the goal pieces and the allowed moves (as turns of the cube body) match. A grip whose kept centers its moves can't bring home is skipped (quick check over center layouts) with a clear error.
- Testing: no Python on this machine (use the Edit tool). Hundreds of twips searches in one Node process ran out of memory, so split long test runs.
- Twips `maxDepth` is **exclusive** (it only finds answers shorter than `maxDepth`), so `solveStep` passes `maxDepth + 1`. Twips's error is a plain string (`"No solution found!"`); the worker client in engine.ts turns it into an `Error`.
- Offsets (Part 2): `StepOptions.offsets` (default `[""]`); `offsetsFromText("D D2 D'")` → `["", "D", "D2", "D'"]` (no offset always first; commas split multi-move offsets; x/y/z rejected).
  Target = `maskedTarget(goal, offset)` (solved cube + offset, masked). Combos = grips × offsets, flat loop, depth tightening across all.
  A combo is skipped when it repeats (same grip + same masked target) or (same `goalOnCube` + allowed moves + offset as cube turns via `movesKey(rotation, [offset])`), so y grips × `D D2 D'` = 4 searches.
  `StepResult.offset` = winner (solution excludes it; `invertMoves(offset)` undoes it). `reachesGoal(scramble, done, pieces, offsets)` accepts any offset. Page `Run` stores `offsets` + `offset`.
  Part 3: `runMethod` must pass each step's offsets to `reachesGoal`; a next step needs the same offsets or the undo moves first.
- Methods (Part 3): `Method` / `StepConfig` types as in Part 3 below (`offsets` is text like the field, `moves` / `grips.bottom` are arrays, `maxDepth: null` = no limit, plus optional `firstFound`).
  `readMethod(data)` checks and fills every field in a fixed key order, so `JSON.stringify(readMethod(x), null, 2)` round-trips identically.
  `StepOptions.keep` is a `Goal` named in the grip the step starts in; `solveStep` renames it per grip with `rotateGoal(goal, rotation)` (piece on spot `turned.pieces[to]` moves to `to`) and merges `mergeGoals(kept, own)` (own wins).
  With `keep`, the step's own centers count only when typed (`goalFromText(text, false)`); no centers at all after the merge = all six.
  `runMethod` also passes `StepOptions.earlier` (every earlier step's pieces, keep or not). Only the grips where those cover the fewest own pieces (centers left out) are searched
  (`covers(kept, role)`: same role, kept solve, or kept place over a swap role), so `DFR FR` + any front = "easiest unsolved pair", an OLL step can't win with x2 or a sideways grip
  (that put solved pieces under its names), and a `pieces: ""` + keep step (ADF fix) still runs. If every grip only names done pieces, the step throws `NOTHING_NEW` instead of answering with a bare grip turn.
  (A user once read "Bottom face" as "the face the step works on" and picked U for OLL; that's what this catches.)
  `StepResult.pieces` = goal text actually solved, named in the end grip. `runMethod(scramble, method, { done, onStep })` passes earlier solutions as `done`, keeps `earlier` (every step's pieces, renamed through each winning rotation), and checks each step with `reachesGoal(scramble, after, result.pieces, offsets)`.
  Page: `src/method-store.ts` (examples from `src/example-methods.json`, localStorage key `puzzly.methods`, file export/import). Example timings: CFOP ~2 s, ZZ ~0.5 s, pseudo-slotting ~10 s (16 searches per pseudo pair).
- Alternatives (Part 4): goal text may hold several goals split by `|` or new lines; `splitAlternatives(text)` (blank ones dropped, none = `[""]`), `readAlternatives(text, needPieces)` also checks each ("Alternative 2: Unknown piece…").
  `StepConfig.pieces` stores them joined with `" | "` (a JSON list is read as alternatives too, so `String(list)` can't merge them into one goal). Page: the pieces box is a textarea, one alternative per line; chips, preset and viewer mask follow the caret's line; "+ Alternative" copies the line below.
  `solveStep` combos = alternatives × grips × offsets (one flat queue, easiest first). The covered-count filter runs per alternative, and an alternative whose pieces are all done in every grip is dropped.
  If every alternative is like that, only the as-held grip `""` is searched (the step is already done: 0 moves, or the offset fix; e.g. Pair 4 after an XCross). Without `""` among the grips it still throws `NOTHING_NEW` (OLL with only U bottom).
  Shorter wins; on a tie the alternative adding more new pieces wins (`fresh` = own pieces − covered), so those combos search with `maxDepth = bestLength` instead of `bestLength - 1` ("cross | XCross" takes a free XCross, in either order).
  `StepResult.alternative` = winner's index, `pieces` = winner + kept. `reachesGoal` accepts alternatives text (any one counts). Old method JSON gives identical solutions (checked on CFOP, ZZ, pseudo-slotting).
  Example "CFOP (cross or free XCross)": on 7 random scrambles a free XCross never came up (same moves as CFOP, ~1 s slower); greedy steps only take a bigger goal when it costs nothing, so the real payoff needs Part 6 lookahead.
- Rust search (before Part 5): `search/` crate (`Cargo.toml`, `src/lib.rs`: `Searcher` = one twips `IterativeDeepeningSearch` kept per target + moves), built by `npm run build-search`
  (wasm-pack, `wasm-opt -O3`) into `search/pkg` (git-ignored; the app build fails without it). `src/search-worker.ts` keeps up to 64 `Searcher`s (oldest freed with `.free()`);
  `script/build.js` loads `.wasm` imports as bytes (esbuild binary loader). The worker is started page-relative (`new Worker("search-worker.js")`), next to `index.html`.
  Measured in the built page (XXCross `DF DR DB DL DFR FR DFL FL`, D bottom + any front): first time 5.6–7.7 s (old cubing.js path 4.9–5.9 s), same goal on another scramble
  0.85–0.91 s (old 2.96 s); pseudo-slotting method 0.2–0.5 s per run (old 6.3–6.8 s); CFOP method 50–160 ms; worker memory 2–43 MB (37 tables). Same move counts as before everywhere.
  Twips's hash table: 1 byte per hashed slot (lossy), "building" it takes ~14 ms and it fills during the first search (~4.5 s of that XXCross); reusing a table grown by a deep search
  made later depth-limited grips slower (~760 ms vs ~230 ms with a fresh one). Its size bounds (`HashPruneTableSizeBounds`) are crate-private, so callers can't cap it.
  `IterativeDeepeningSearch::new(data, adaptations, Box<dyn PruneTable>)` accepts our own table (trait: `lookup(pattern) -> Depth` + `extend_for_search_depth`).
  Twips's exact table (`GraphEnumeratedDerivedPatternPuzzle`) keeps every state as a full KPattern in a HashMap: fine at cross size, too heavy for XCross.
  Toolchain: Rust 1.99 + `wasm32-unknown-unknown` + wasm-pack 0.15 (its bundled wasm-opt 117 rejects newer feature flags; `-O3` alone works). Windows Smart App Control blocks rustc
  and build scripts (turned off on this PC). First Rust build ~8 min, later ~1 s. In Git Bash run `export PATH="$HOME/.cargo/bin:$PATH"` first.
  Testing: `solveStep` now needs a browser (the worker), so the Node bundle test above no longer covers searches: `npm run build`, serve `dist/web` on another port with a small
  static server, and drive the page with the built-in browser (a hidden pane throttles page timers, so start a solve in one call and poll in short calls). Rust-only tests can load
  `search/pkg` in Node with `initSync`. To compare with the previous commit, `git archive HEAD` into the scratchpad and build it there.
- Exact tables (Part 5a): `search/src/coords.rs` (state numbering) and `search/src/table.rs` (`DistanceTable`, exported next to `Searcher`).
  `new DistanceTable(kpuzzleJson, targetsJson /* JSON list of patterns */, movesJson, maxStates)` throws ("Too big for one table (N states)", "Too deep…", layouts it can't number) so the caller can fall back;
  `.search(startJson, optionsJson)` has `Searcher.search`'s contract (exclusive `maxDepth`, `"No solution found!"`); `.states()`, `.bytes()`, `.depth()`. Answers by descent in ~0.1 ms.
  Numbering, all read from the masked targets: per orbit only *moving* spots (some turn permutes it, or twists it in a way that counts: face turns twist centers, but center twists are ignored);
  untouched spots are checked when reading a start (wrong = no answer). Pieces sharing an id form a class; the biggest twist-free class is left implicit. Orbit value = positions
  (each class's combination among the spots still free) × twists (per tracked piece, or per spot when every spot holds a twisted piece). Orbits with ≤ 65,536 layouts number only
  layouts reachable from the targets (six centers under M E S: 24 of 720). Twists no allowed turn changes (EO under U R L) leave the state and are checked on reading.
  No parity trick, so EO = 4,096 and CO = 6,561 states (not 2,048 / 2,187); tiny either way.
  Table index = outer positions × (outer twists × inner size) + outer twists × inner size + inner value: inner = smallest orbits up to 65,536 values, with one turn table;
  outer orbits get turn tables (positions, plus twist rows) only while filling, so each block's 18 neighbour blocks are lookups; they're freed after the fill.
  Fill: 4 bits per state (15 = unseen, so distances ≤ 14, deeper = error → twips), targets at 0; small layers as a list, then block scans forward, backward once unseen < 2 × layer.
  Several targets in one table work (pseudo cross with 4 offsets: one table 108 ms vs 4 tables 416 ms), but the engine still sends one target per request (5c folds offsets).
  Worker (`src/search-worker.ts`): `DistanceTable` when it fits `MAX_TABLE_STATES` (10M), else `Searcher`; cache keyed by moves + target, freed least recently used past `MAX_CACHE_MB` (256), a Searcher counted as 2 MB.
  Build times (Node, steady; a page's first table also pays worker start + JIT, cross ~400 ms there): EO ~45 ms · CO ~50 · ZZ left block with kept EOLine (U R L, 362,880) ~45 · EOLine (540,672) ~60 ·
  cross (190,080) ~80–200 · cross with M E S (4.6M) ~450 · cross + pair corner (4.6M) ~350 · cross + pair edge (3.0M) ~620 · Roux first block with M (5.3M) ~320 · XCross (73M) 5–7 s, 35 MB.
  Twips for comparison: XCross first search ~85 ms, then 1–7 ms; Roux block ~25 ms; cross ~5 ms. So a table only pays off over repeated solves (5c's IndexedDB makes builds one-time), and XCross stays on twips.
  Big builds are memory-bound: each layer touches ~18 × size / 128 random cache lines (36 MB table → ~10M misses per layer), single-threaded wasm. Tables with many small blocks
  (cross + pair edge: 95,040 blocks of 32 states) are slowed by per-block overhead instead (room to optimize in 5b).
  Checked: same move counts as twips on cross, EO, CO, EOLine, Roux block (M), pseudo cross (each ADF offset, and all offsets in one table), cross with M E S, `:p`/`:s` roles, cross + pair edge / corner, XCross;
  engine level (10 step kinds incl. "cross | XCross", any bottom + any front) and all 4 example methods × 4 scrambles give identical solutions to the twips-only worker; page check in the built app.
  Engine-level Node testing without a browser: set `globalThis.self = globalThis`, a fake `Worker` class whose `postMessage` calls `self.onmessage` (and `self.postMessage` back to the fake's `onmessage`),
  import the worker module, then the engine; bundle with `--loader:.wasm=binary`. Import the project's committed `src/search-worker.ts` by absolute path to compare old vs new.
- Split tables (Part 5b): `search/src/split.rs`, `SplitSearch` exported next to `DistanceTable`. `new SplitSearch(kpuzzleJson, targetsJson, movesJson, maxStates)` plans sub-tables (throws when nothing can be split);
  `.tables()`, `.targets(i)` (the JSON list `new DistanceTable` takes, also its cache key), `.states(i)` (estimate, upper bound), `.attach(i, table)` (shares the table's data through an `Rc`: `DistanceTable` now wraps
  `Rc<TableCore>`, so freeing the JS handle later is fine), `.search(start, options)` (twips's contract, plus `{"maxNodes": n}` → error `"Node limit reached"`), `.nodes()` (last search). Several targets work (goal check below).
  Items = the whole goal's classes from 5a's numbering (the biggest twist-free class stays out, frozen twists aren't items), puzzle orbit order (edges first), classes by first spot.
  Plan: seed = first item no sub-table covers yet (its twist too), then every other item in order while `estimate_size` (5a's sizes without the reachable-layout walk) ≤ budget, with its twist if that fits, else positions only.
  A sub-goal = the targets relabeled: kept classes keep their id (and twist), every other piece on a moving spot joins one twist-free rest class, then ids are renumbered by the first spot they fill in the first target,
  so equal sub-goals from different goals give equal JSON and share one table (XXCross reuses XCross's; CFOP's four pair steps, every grip, use the same 8 "cross + one slot piece" tables).
  Plans at 10M: XCross = cross + FR, cross + DFR · XXCross / XXXCross / F2L = cross + each piece · first layer = cross + each corner · DR = EO + E-slice (2.0M) and CO + E-slice positions (3.2M), found by the rule ·
  OLL with keep = 12 tables (27M states, 13 MB) · whole cube (PLL with keep) = 16 tables "4 U edges + one piece" (61M states, 29 MB, ~10–12 s to build).
  IDA*: per depth, each table's (outer `Units`, inner value), stepped with `TableCore::step` / `distance`. Move pruning: never one move twice in a row, commuting moves only in ascending order (commuting is checked
  on the KPuzzle transformations, so M/E/S and any move set work). Distances change by ≤ 1 per move, so a table is only looked up when its last exact distance plus the moves since could reach the bound;
  the table that last ruled a child out is checked first (both together ~40% faster, same nodes). Goal check = replay the path on the whole goal's numbering (`Coords` sizes now saturate instead of failing),
  so sub-tables needn't cover every piece. No maxDepth = up to 40 moves. ~3–4 µs per node with 4–8 tables.
  Coords: `Turn.group` (powers of one move), `OrbitCoord::new(…, reach)`. Twisted groups (`:o` with several pieces) now get turn tables: per (position, turn) a row id into deduplicated twist rows
  (digit permutation from re-sorting the group + gained twists, ≤ 1M entries, ≤ 16 digits), which replaced the singles-only delta/add tables. OLL-with-keep sub-tables: ~25 s → ~0.4 s each.
  Worker tiers (`src/search-worker.ts`): one table if it fits (10M), else a split goal starts on small sub-tables (`SMALL_TABLE_STATES` 1M, ~0.2–0.4 s to build) and keeps its big plan (`MAX_TABLE_STATES` 10M);
  searches on the small tables may use (missing big states / `STATES_PER_NODE` 20) nodes in total (~3 µs per node vs ~0.15 µs per filled state), then the goal switches to the big plan
  (at once when those tables exist already). Entries list the sub-table keys they use (`uses`); dropping a table drops the splits using it. Twips `Searcher` only when no split works.
  Budget test: 1M-only builds 5–10× faster but XXXCross searches take 3–16 s (vs 0.2–0.8 s at 10M); 4M gains little over 10M.
  Numbers (Node, wasm, direct API, 10M, 5 scrambles; twips in brackets): XCross build 1.1–1.4 s, 0–1 ms (1–29 ms) · XXCross 1.9–2.3 s, 2–28 ms (0.2–9.1 s) · first layer 1.8–2.0 s, 0–14 ms (0.06–8.9 s) ·
  DR 0.3–0.4 s, 1–27 ms (3–320 ms) · XXXCross 3.5–4.1 s, 0.23–0.8 s (twips > 10 min on one scramble) · OLL with keep 3.8–5.2 s, 0–196 ms (6 ms–12.8 s) · PLL whole cube (T, Ua, Ub) 10–12 s, 2–441 ms (T in 11, Ua in 9).
  Methods (tiered worker, 3 scrambles, first run / later runs; committed worker in brackets): CFOP 1.0 s / 37–95 ms (0.41 s / 62–73 ms) · pseudo-slotting 1.7 s / 0.2–0.57 s (1.36 s / 161–171 ms) ·
  ZZ 0.94 s / 12–19 ms (0.22 s / 19–25 ms) · CFOP + OLL, OLL step 3.0–3.4 s / 0.12–0.5 s (19.5–27 s every time) · XXCross any front 0.47–0.75 s / 32–85 ms (2.1–9.3 s) · first layer 15–360 ms (0.1–9.7 s) · DR 29–412 ms (0.13–0.33 s).
  Same move counts as twips on every step. Built page: first-layer preset 561 ms (9.7 s before), pseudo-slotting first run 1.13 s then 115 ms, CFOP 33–36 ms after it (shared tables).
  Slowest left: the first, unlimited combo of a pseudo last pair (~100k nodes on small tables) until that goal switches to big tables.
  Testing: `bench.ts` style scripts call the wasm API directly (`initSync`, masked start/target from `maskPattern`), check answers with cubing.js, and print nodes; method runs use the fake-Worker harness above.
- Ranking + table lifecycle (Part 5c): worker requests are `{ id, kind: "measure" | "search", kpuzzle, start, targets /* JSON list, one per offset */, moves, maxDepth? }`; a measure answers `{ bound, exact }`
  (`DistanceTable.measure(start)` = exact distance, `SplitSearch.measure(start)` = largest sub-table distance, `null` for twips, `Infinity` = unreachable); progress comes as `{ id, progress: { action: "build" | "load", finished, states? } }`
  (`states` 0 = couldn't build, e.g. the instant "too big" try before a split). Engine: `askWorker(request, onProgress)` replaced `searchTwips`; `StepOptions.onProgress` / `MethodOptions.onProgress` get `TableProgress`.
  `solveStep` combos = alternative × grip × offset group: `offsetGroups(offsets, moves)` folds every offset the allowed moves can make (each move allowed, or a power of an allowed quarter turn) with no offset into one
  targets list; any other offset is its own group (its target differs on spots the moves never touch, which `Coords::new` rejects: "Targets differ on spots the moves never touch"). Targets an offset can't change are dropped per grip.
  Flow: estimate order → repeat keys (now over the targets list / offsets list) → user-limit and centers filters → measure all (`Promise.all`) → sort by (bound, more fresh pieces) keeping estimate order on ties → search with the old
  depth tightening, skipping `bound > maxDepth`. The offset reached = the target `maskPattern(held.applyAlg(moves), goal)` matches. Twips `Searcher` now takes a targets list too (twips supports several; checked).
  Folding measured (Node, wasm, 6 scrambles, folded vs per-offset with tightening): pseudo XCross 0.1–1.3 ms vs 0.2–1.3 ms and 2 tables instead of 7; pseudo XXCross 0.5–11.5 ms vs 2.3–15 ms; pseudo XXXCross 11 ms–1.7 s vs 90 ms–4 s
  (folded usually 2–8× fewer nodes, at worst ~1.3× more); same move counts everywhere.
  Saved tables: `table.toBytes()` / `DistanceTable.fromBytes(kpuzzle, targets, moves, bytes)` (header: magic `PZT\0`, `TABLE_FORMAT` u32, states u64, depth u8, then the 4-bit distances; refused when the rebuilt numbering's size differs),
  `tableFormat()` exported — bump `TABLE_FORMAT` in `table.rs` whenever `coords.rs` numbers states differently. Load = numbering + inner turn table: 1–40 ms vs 46–800 ms to build (EO 4k … Roux block 5.3M states).
  IndexedDB (worker): database `puzzly-tables`, store `tables`, key `${tableFormat()}/${moves}/${targets}` (same moves + targets text as the cache key), value = bytes; tables with ≥ `STORE_MIN_STATES` (100k, ~50 KB) are stored
  (the plan's ~1 MB threshold stored nothing: shallow methods never leave the 1M-state small plans). On start the worker lists stored keys (they count as built for the small/big switch, so a fully stored big plan
  is used at once) and deletes keys of other formats. No IndexedDB (Node, private window) = everything still works, nothing stored. Requests run one at a time through a promise queue (loads are async).
  Idle stop: `WORKER_IDLE_MS` 60 s after the last answer `stopSearchWorker()` terminates it; any request clears the timer, the next one starts a fresh worker.
  Numbers (Node fake-Worker harness, 4 scrambles, first run / later runs; before 5c in brackets): pseudo-slotting 0.87 s / 52–69 ms (1.43 s / 95–861 ms), searches 38 (180); pseudo cross any bottom + any front 0.22 s / 35–48 ms
  (0.54 s / 62–78 ms), searches 4 (82); CFOP, ZZ, CFOP + OLL, XXCross any front about the same time, CFOP searches 38 (43). After a "reload" (new process, file-backed fake IndexedDB): XXCross any front 549 → 228 ms,
  pseudo-slotting 1009 → 370 ms, CFOP 554 → 205 ms, CFOP + OLL 3.26 → 0.69 s (13 tables loaded, 0 built); stored set after those 4: 33 tables, 6.1 MB.
  Testing: the fake Worker must use `setImmediate`, not `setTimeout` (Windows' ~15 ms timer tick added ~30 ms per round trip and made the 2-request flow look slow). A replay mode (solve each step from the old run's
  state) compares move counts when ties pick other answers. `harness/fakeidb.ts` style: a tiny file-backed `indexedDB` (open / transaction / objectStore get, put, delete, getAllKeys) set before importing the worker.
  On 2026-10-07 the built-in browser refused to open localhost, so storage and idle stop were checked in Node only (see 5c's Done).
- Lookahead (Part 6): Rust `DistanceTable.list(start, options)` / `SplitSearch.list(start, options)` = every answer shorter than `maxDepth`, shortest first, up to `maxAnswers` (`maxNodes` as in search), as a JSON list of move texts.
  One IDA* driver, `deepen()` in `split.rs`, serves search (first answer) and list; an exact table runs it as its only table (`TableCore` now keeps `goals` + `follow` / `groups` for the goal check and move pruning, `move_pruning()` shared).
  Listing never extends a path that is already at the goal (that answer + goal-keeping moves, e.g. cross + U, is dominated: the next step can make those moves itself), checked per node only in list mode (every table at 0, then the whole goal).
  Worker: request kind `"list"` (+ `maxAnswers`) goes through the same small → big tier flow as search (`ask()`); twips answers a list with its one answer.
  Engine: `solveStep` = `stepCombos` (combos measured, closest first) + `searchCombos` (the greedy loop) + `stepResult`. `stepCandidates(scramble, pieces, { ...StepOptions, extraMoves, maxCandidates })` = solveStep's answer first,
  then each combo's list up to shortest + `extraMoves` (within `maxDepth`), kept once per end state (grip + whole held pattern), sorted by length, more fresh pieces, combo order, capped at `MAX_CANDIDATES` (64). A 0-move step gives only itself.
  `StepConfig.lookahead` / `extraMoves` (`readStep` fills 0, placed after `firstFound`); 0 = greedy, identical to before (checked: 7 methods × 4 scrambles, same solutions, offsets and search counts).
  `runMethod`: a step with lookahead N (capped at the steps left) judges each candidate by its moves + the next N steps' own shortest answers, all candidates at once (`Promise.all`); fewest total wins, ties keep the first (greedy's answer).
  Greedy solves are cached per run (`solveOwn`, key = step index + done + earlier pieces text) and shared with the real run, so a greedy step right after a lookahead step is usually free. `MethodStepResult.lookahead = { candidates, steps, total } | null`.
  Answer counts (4 scrambles): cross shortest 1–7 (pseudo cross 3–19), +1 move 17–190 (51–512), +2 223–3,800 (806–11,000); XCross +2 77–2,060, pseudo XCross 252–4,926. So the cap of 64 is hit at +1 on crosses and almost always at +2;
  past the cap, the DFS move order picks which longer answers make it (within one length: more fresh pieces, then closer combos first). Listing time: under 1 ms (shortest), 0.2–11 ms (+1 cross), 10–180 ms (+2 pseudo XCross).
  Page: method panel "Lookahead [n] steps, up to [n] extra moves" (`step-lookahead`, `step-extra`); results table "Lookahead" column `candidates → total` (details on hover); status "lookahead compared N candidates", live " · looking ahead".
  Testing: `harness/la.ts` style runs (fake Worker; env `LA`, `EXTRA`, `ONLY` = step index set the steps' lookahead), and a direct-wasm list check (each answer reaches a target, never passes one, within the limit, once, shortest first;
  exact-table list = forced-split list on cross / pseudo cross / XCross / pseudo XCross; a start already at the goal lists `[""]`). TypeScript isn't in node_modules: `npm install typescript` in a scratch folder for `tsc --noEmit`.
- Solvable with (Part 7a): `StepConfig.solvableWith` (moves text, `readStep` tidies it with `solvableFromText`, key placed after `offsets`; x/y/z refused), `StepOptions.solvableWith` (moves). The goal also counts when only those moves are needed to finish it = its targets closed under them.
  The engine sends targets as `{"targets": [...], "solvableWith": ["R", "U"]}` (a plain list when there are none; the worker treats it as opaque text, so cache and IndexedDB keys include the moves; `TABLE_FORMAT` unchanged).
  Rust `search/src/solvable.rs`: `read_targets` (list or object), `close` (breadth-first on flat bytes from every target, targets first so the first target stays first; cap `MAX_TARGETS` 100k; every closed target must match on spots no allowed turn touches,
  else a clear error), `closed_targets` (used by `DistanceTable` setup / `fromBytes` and `Searcher`), `table_targets` (a sub-table's JSON: a plain list when the moves add nothing, so it shares keys with ordinary goals).
  `Searcher` refuses more than `MAX_TWIPS_TARGETS` (1,000) closed targets: twips compares them one by one (29,160 targets: no answer after 7 min). `SplitSearch` numbers and goal-checks the closed targets, but its sub-tables relabel the targets as sent
  (relabeling commutes with the moves) and close their own; with moves it also adds one positions-only table per orbit that fits (all 8 corners = 40,320 states), the only kind of sub-table that sees a 2-gen corner permutation.
  Goal checks (`GoalCheck.goals`, `TableCore.goals`) are `HashSet<(Units, Units)>` now (`Units` derives `Eq`, `Hash`). Engine: the per-piece `estimate` gives 0 / 0 with these moves (pieces may end on other spots, so it's no lower bound);
  the repeat key adds `movesKey(rotation, solvableWith)`; `solvableIndex` (breadth-first in "cells" = piece × 256 + mod × 16 + twist per spot, cap 100k, earliest target wins so a redundant U offset reports none) serves `reachesGoal(…, offsets, solvableWith)`
  and the offset reached; `StepResult.settled` = goal pieces every mix of the moves leaves alone (`keepsCell`: a per-spot walk over (source spot, twist gained), no closure needed), and `piecesAfter` keeps `settled` instead of `pieces`
  (CP line → `DL DFL DBL`; `:o` edges under R U stay). `MethodStepResult.solvableWith`. Page: "Solvable with" field under Offsets (picks None / R U), in the step form, summary, runs and method rows.
  Numbers (Node): CP line `DL DFL DBL UFR:p UBR:p UBL:p UFL:p DFR:p DBR:p` + R U: 120 closed targets, one table of 8.7M states (depth 8, 1.7 s), answers 4–6 moves in ~0.1 ms; split 1M / 10M and twips give the same lengths.
  Same goal with corners solved (not `:p`): 29,160 closed targets, too big for one table, split 7 / 6 tables, ≤ 2 ms, same lengths. Whole cube + R U: refused (> 100k).
  Testing: `harness/solvable.ts` (fake worker; `ONLY` = sections 1–5) checks each CP line by solving all corners + DL with R U alone afterwards; `harness/direct.ts` compares table / split / twips lengths on the wasm API.
- Half-turn-only moves (after 7a): the engine always took them (`"R2"` in a step's moves = only R2: Rust `enumerate_turns` and TS `pieceMoves` stop at the first power that is back to solved), only the page couldn't pick them
  (and `stepToForm` dropped them). Page: a second row of move boxes `U2 … S2` (`chosenMoves()` drops `X2` when `X` is ticked too; `showMoves()` ticks `X` for `X` / `X'` and `X2` for `X2` / `X2'`) and quick picks *Face turns*, *R U*, *DR* (`U D R2 L2 F2 B2`).
  Separate U / U' boxes would mean nothing: a move's powers are always all used (U' alone = U). DR phase 2 after a DR step (every piece, keep, DR moves), Node, 12 scrambles: finishes of 11–15 moves, shortest within those moves; first solves 2–10 s
  (small, then big split tables), then 11–13 move finishes 14–131 ms and 14–15 move ones 0.4–4.7 s (generic split tables, no Kociemba-style phase 2 tables). Built page: a 10-move DR-only scramble solved in 10 moves, 1.82 s with 13 table builds.
- Relative groups (Part 7b): role suffix `:r` / `:r2`… = role `relativeN` (`GROUP_ROLES` maps o / s / r; `relativeGroup(role)` gives N, 0 for other roles). `maskPattern` treats them like solved pieces (own id, twist counts); the targets carry the "anywhere".
  `goalTargets(goal, offset)` (engine.ts, TS only, Rust unchanged) = `maskedTarget` when there are no groups, else one target per mix of the groups' placements: each group as `ALL_GRIPS` turns the solved cube (24, "as held" first,
  so all groups at home is target 0 and wins ties), skipping mixes where two groups share a spot; `placedPatterns` puts the moved pieces down, refuses to push off a `solve` / `place` piece, and fills the spots they left with the
  pushed-off pieces (ignored, `:o` twist 0, `:s`) in every distinct class order (`arrangements`); then the offset is applied (goal met, then off by the offset) and masked; cap `MAX_RELATIVE_TARGETS` 10k per offset.
  `reachableTargets(targets, moves)` drops targets the worker would refuse (Coords::new): different from target 0 on a spot no allowed move changes, or, in a type no move twists (edges under U R L), a piece with another twist.
  stepCombos: per offset `reachableTargets(goalTargets(…), generatorMoves)`, `Combo.offsets` has one entry per target (repeats), dedupe by `cellsKey` (was `isIdentical`, same result), `estimate` takes each offset's targets (a state counts when any target accepts it),
  the repeat key uses each offset once. `reachesGoal` checks every offset's `goalTargets` (unfiltered). Counts: a pair 24 targets, cross + pair 16, cross + two pairs 200.
  `mergeGoals(base, over)` renumbers base's relative groups past over's highest (keep + own, and `piecesAfter`), so each earlier group stays its own; `covers` counts any relative role as covering a relative role
  (so "join the easiest pair" with any front skips joined pairs). Page: role picker `:r` / `:r2`, preset "Cross + front-right pair joined anywhere", relative pieces drawn in full color; chip role tags now show
  (the CSS looked for a `data-role` the page never set; it uses `data-tag` now).
  Testing: `harness/rel.ts` style checks (fake worker) compare with a raw-cube "rigid image of solved under one of the 24 grips" check, and `harness/twips.ts` re-solves the engine's last search request with twips `Searcher` (same lengths);
  example methods old vs new: identical solutions, offsets and search counts (5 × 4 scrambles), pseudo-slotting time within noise after making `mergeGoals` loop-based (the `flatMap` version cost ~5%).
- BLD (Part 7c): `StepOptions` / `StepConfig` fields:
  - `untouched` (every unlisted piece must end exactly as it is now),
  - `buffer` (piece name; implies untouched, pieces must be `""`),
  - `targetsPerStep` (default 2),
  - `parity` (piece names),
  - `StepConfig.repeat` (run the step again until a round has 0 moves, or NOTHING_NEW after round 1; rows named `Name 1`, `Name 2`…; cap `MAX_REPEATS` 60).

  `readStep` key order: … `solvableWith, untouched, buffer, targetsPerStep, parity, moves, …, extraMoves, repeat`. New role `free` (`:x`): the spot may change in untouched steps, same as unlisted elsewhere (`dropFree` in `maskPattern`, `stepCombos`, `reachesGoal`). Exports: `bufferFromText`, `parityFromText`, `dropFree`; `MethodOptions.onStart(index, round)`.

  Engine (TS):
  - `untouchedCombos` (from `stepCombos`) builds a `Wanted` per grip × alternative: `set` spots with a piece and a twist (null = any), `free` spots (any leftover piece, any twist), `swap` spots (pieces swap among themselves keeping their twists).
    - Manual goals use `untouchedWanted`: listed pieces go home; spots a listed piece leaves, and `:x` spots, are free; only solved / `:p` / `:x` roles are allowed.
    - Buffer steps use `traceWanted`: follow the cycle, one goal per cycle-break choice. At a step's start with the buffer home, also one goal per pair of pieces twisted in place (flip / twist algs).
  - `completions` lists every end state, keeping those whose `changeOf` (per orbit: permutation parity, twist sum) lies in `reachableChanges(moves)`, the group the moves' own changes generate. That makes it exact for face turns, with M and centers too. Cap `MAX_UNTOUCHED_TARGETS` 5k.
  - If none is reachable and the step has parity pieces: `withParity` (clean swap first, then any twist). Otherwise PARITY_NEEDED / UNTOUCHED_OUT.
  - Each end state W becomes a combo with `held = relabel(cube, W)` (piece renamed to its spot in W, twist counted from W's; moves act on spots, so answers are unchanged), target = `maskedTarget(wholeGoal())`, `Combo.cube` = the real held cube (for `stepCandidates`' end-state key), `Combo.untouched = { pieces, changed }`.
  - `StepResult.changed` lists the spots the step may change. `reachesGoal(…, untouched?: { from, changed })` also checks every other spot against `heldPattern(scramble, from)` (`from` = moves before the step + its rotation).
  - `knownAnswers` (engine memory, 5k) remembers untouched answers by moves + relabeled start, since a case doesn't depend on the scramble. `searchCombos` takes known ones first, so they bound the rest.

  Rust: targets JSON may be `{"targets": [...], "orbitTables": N}` (`solvableWith` now optional in the object, `read_orbit_tables`). `SplitSearch` then adds per orbit one table of all its items, the last twisted one placed only, when ≤ N. The engine sends N = `ORBIT_TABLE_STATES` (100M) for untouched combos only, so other goals keep their exact plans and keys. On the cube that is all corners: 88,179,840 states, depth 11, ~7 s. Worker: `attachTables` builds each sub-table with `max(MAX_TABLE_STATES, split.states(i))`.

  Numbers (Node, warm tables; bound → length):
  - 3-cycles: 0–20 ms.
  - Parity (edge swap + clean UFR/UBR swap): bound 10 → 13–14, 2 ms–6 s. Without the corner table: bound 6–7, 43–115 s.
  - 2 corner twists: 40–500 ms.
  - 2-edge flips: bound 6–8 → 13–14, 3.5–53 s. Tried and dropped: two 6-edge tables (42.6M each, needed `TABLE_LIMIT` 1<<24, ~8 s each), 1.5–2× fewer nodes; "EO of all edges + 4 edges" (48.7M), bound 6–7.
  - Method "3-style BLD", 12 random scrambles: 81–116 moves, all rounds checked, cube solved. First run ~11 s with 18 builds; later runs 0.1–2.8 s, one first-time flip 26 s.

  Checked:
  - Corners first with edge parity `UF UR`, OP-style (1 target per step, every round parity), M slices, lookahead 1, solved cube (0 moves).
  - CFOP "easiest pair" with repeat stops after 4 pairs.
  - The 5 old example methods give identical solutions, offsets and search counts (4 random scrambles each, vs the pre-7c engine and worker).
  - Built page: a single BLD step was 10 moves in 9.1 s (18 builds), and the example method gave 96 moves in 7.3 s, all ✓.

  Testing: `bld.ts` / `edge.ts` style harnesses (fake Worker). Scrambles need a real PRNG: an LCG's `seed % 6` only gave F U L moves.
- Benchmark + faster nodes (Part 8a): `bench/` in the repo (see README *Benchmark*), bundled by `npm run bench-build` into `bench/out` (git-ignored).
  - `record.js` (fake Worker, `bench/setup.ts`, mulberry32 scrambles): scenarios dr-finish (DR, then every piece + keep with `U D R2 L2 F2 B2`, 4 scrambles), xxxcross (D bottom, 4), cfop-oll-pll (CFOP example + OLL + PLL with keep, 3),
    pseudo-lookahead (example, 2), bld-flip (2 pure 2-edge flips made with cubing's solver, buffer UF); pass 1 records every worker request (1,356), pass 2 is warm.
  - `replay.js` sends them to the wasm API directly, each goal on its big plan (10M; tables cached in `bench/out/tables`), and prints per scenario / kind: ms, nodes, µs per node, bound gap (answer − start bound). `compare.mjs`: answer / node diffs and ratios.
    The bundle carries its wasm, so keep a copy (`replay-before.js`) before a Rust change. Old code = `git archive HEAD` into a scratch folder, `npm run build-search` there (~5 min first time, ~1 min later).
  - Search loop (`Ida::dfs`, split.rs): per node, each sub-table that can rule children out looks up every child still in at once (child indices, then all distances), the ones that ruled any out go first next time;
    a sub-table's pieces are only moved along the path when a lookup needs them (`current` per depth × table, `ensure` replays the path's turns); `TableCore::child_index` ranks a child straight from its parent
    (`Part::rank_after`) when every outer orbit is "singles" (each class one piece, twists per piece: no re-sort), else apply + rank into a scratch. Same children in the same order, so answers and node counts are identical.
  - Profile before (named build: `CARGO_PROFILE_RELEASE_STRIP=none`, wasm-bindgen `--keep-debug`, wasm-opt `-g`, `node --cpu-prof`): moving pieces 44%, re-ranking 27%, the loop 28%. After: loop + table reads 41%, `rank_after` 35%, moving pieces 20%.
    Per node 16–27 child lookups over 3.5–5.5 sub-tables; nodes sit 5–8 moves from the goal (almost none within 3), so tricks near the goal don't pay. Batching lookups alone (no lazy pieces) was 0.8–1.4×; fixed-size `dest` / `add` rows
    without bounds checks gained nothing on the full replay (dropped). This PC: i5-3210M, 3 MB L3, a random read in a 30 MB array 25–55 ns; the Claude app keeps ~2 threads busy, so compare builds back to back.
  - Numbers (replay, 10M plans, old → new, same answers and nodes): dr-finish 6.5 → 3.4 s (7.7 → 4.0 µs/node, 845k nodes), xxxcross 13.1 → 6.1 s (8.7 → 4.0, 1.5M), cfop-oll-pll 203 → 101 s (12.3 → 6.1, 16.4M; PLL with keep is nearly all of it),
    pseudo-lookahead search + list 0.52 → 0.30 s, bld-flip 214 → 88 s (14.0 → 5.7, 15.3M); whole replay 441 → 203 s. Tables: 62, 300M states, 143 MB, 75 s to build once.
    Bound gap (avg / max): bld-flip 6.3 / 7, xxxcross 4.0 / 5, dr-finish 3.4 / 7, cfop-oll-pll 2.4 / 6, pseudo 1.3–1.5 / 5: the tables are now the limit (8b, 8c).
    Method runs (record.js, old → new, same moves in all 30 runs): first pass 739 → 297 s, warm pass dr-finish 24.0 → 12.2 s, xxxcross 27.6 → 6.3 s, cfop-oll-pll 230 → 99 s (PLL 8–53 s per scramble), pseudo 6.4 → 4.6 s, bld-flip 48 → 24 s.
- Spot sets + twist parity (Part 8b): `orbit_coords` (coords.rs) splits an orbit's moving spots into the sets the turns connect (union-find over each turn's permutation) and makes one `OrbitCoord` per set
  (same orbit name; the first one keeps the untouched-spot checks). When the targets hold different pieces in some set (e.g. relative-group placements across sets) the orbit stays one pool, as before.
  - Per set: its own classes, left-out class (`OrbitCoord.implicit`), frozen twists and per-spot twists. `Part::read` now checks exact class counts and that every spot holds the set's own ids, so a start with a piece in another set reads as unreachable (`None`).
  - Twist parity: a per-spot set whose turns keep the twist sum (Σ `add` ≡ 0 for every turn) and whose targets share one sum leaves out the last spot's digit (`parity`, `twist_sum`, `spot_digits`, `last_twist`); `read` refuses a start with another sum.
  - split.rs: items come from every set of an orbit (sets by first spot, one item per id), Relabel's moving ids from every set. `estimate_size` multiplies the same sets (still no reachable-layout walk while sizing). `TABLE_FORMAT` 2.
  - Sizes (old → new): EO 4,096 → 2,048, CO 6,561 → 2,187, EOLine 540,672 → 270,336; DR's two sub-tables EO + E-slice 2.03M → 1.01M and CO + E-slice positions 3.25M → 1.08M (same plan, same nodes);
    R U finish (whole cube, R U) 441M → 147M (5,040 · 120 · 243), split plan unchanged (5 × 5.4M); DR phase 2 (whole cube, `U D R2 L2 F2 B2`) 19.3 trillion → 39.0B (8! · 8! · 4!), its plan 12 tables of 7 edges, or a corner + 6 edges
    (57M states) → 7 tables "all 12 edges + one corner" (7.7M each, 54M). Face-turn goals without per-spot twists (cross, F2L, OLL / PLL with keep, BLD) number exactly as before.
  - Replay (1,356 requests, 10M plans, 8a → 8b): every answer identical (move text: IDA* takes the first shortest answer in move order, whatever its tables). dr-finish searches 3.5 s → 0.18 s (845k → 40k nodes, bound gap avg 3.38 → 2.75, max 7 → 6).
    Other scenarios: identical nodes and time within noise (3 alternating runs: xxxcross 5.9–6.8 s → 5.2–6.0 s; the same old code varies ~10% between runs). Tables 62 (300M states, 143 MB) → 57 (294M, 140 MB), ~72 s to build once.
  - Example methods (all 6, 4 scrambles each, BLD 3): identical solutions and offsets. DR + finish (12 scrambles, fake worker, first / second pass): 37.7 / 27.2 s → 11.1 / 12.3 s, identical solutions.
    The worker searches on the small (1M) tables until it has spent the big plan's cost in nodes (54M / `STATES_PER_NODE` = 2.7M), so the switch came in the second pass (one 15-move finish 9.7 s, building the 7 big tables);
    on small tables 12–13 move finishes 15–91 ms, 14–15 moves 0.3–2.4 s; after the switch 7–204 ms (Facts before: 14–131 ms and 0.4–4.7 s).
  - `bench/compare.mjs` counts bound changes apart (higher / lower) instead of as answer differences.
- Rotated tables (Part 8c): `search/src/symmetry.rs`. `Symmetry::new(kpuzzle, closed targets, turns)` only for identity goals: one closed target, and per orbit either every piece its own id (twists all counted and 0, or none counted)
  or one shared id with no twist (whole cube: PLL / finish with keep, every relabeled BLD goal, DR finish). Rotations = the group x and y generate (24 on the cube), kept when R⁻¹ · turn · R is an allowed turn
  for every turn (compared on tracked orbits, twists as far as the goal counts them): face turns 24, DR moves 8, R U 2.
  - `SplitSearch.slots` = (sub, rotation). A planned table whose pieces (`Shape` = (orbit, home, twist), plus a set's left-out piece when every other item of the set is held) are a rotation's image of an
    earlier table's becomes a slot on that table, not a new sub-table (`tables()` counts sub-tables only, so the worker builds fewer). A slot reads its table on `symmetry.rotate(start, r)` (R⁻¹ · state · R)
    and maps turns through `Rotation.turns`; IDA* `Slot { table, turns: Option<Vec<u8>> }` (None = plain; rotated turns are mapped into a small buffer first, so the lookup loop keeps one inlined call:
    a two-branch version was ~10% slower on XXXCross). `measure` reads every slot. `TABLE_FORMAT` unchanged (same numbering).
  - Tables: PLL with keep and BLD flips 16 "4 U edges + one piece" → 4 (U corner, D corner, E edge, D edge), DR finish 7 "12 edges + one corner" → 1.
    Replay (1,356 requests, 8b → 8c): identical answers, nodes and start bounds; tables 57 → 39 (294M → 202M states, 140 → 96 MB); times within noise (XXXCross, 3 alternating runs: 6.3–7.0 s before, 6.3 s after).
  - Example methods (all 6, 4 scrambles, BLD 3): identical solutions; 3-style BLD first run 59 → 33 s (fewer builds). DR + finish (12 scrambles, fake worker) identical solutions, first / second pass
    11.1 / 12.3 s → 6.4 / 1.1 s: the big plan is now one 7.7M table, so the worker switches to it after a few solves (first solves 1.2–1.6 s, then 6–263 ms).
  - Measured, not kept (subset: 8 DR finishes / one PLL with keep, 1.39M nodes / one BLD flip, 0.83M nodes; 8b: 171 ms / 6.8 s / 4.4 s):
    - Inverse lookups (every slot also read on the inverse state, worked out from the whole state kept spot by spot per depth; an inverse distance can jump by more than one per move, so no carried
      bounds and every child left is read): nodes −7% / −37% / −22%, µs per node ×1.8–3, so slower (280 ms / 13.3 s / 10.3 s). Only the view that ruled last checked per node: nodes −1–4%, still slower
      (keeping the whole state per depth alone costs ~40% per node). The fast inverse index matched cubing's `invert` (then rotated) on ~290k random states per goal, 0 mismatches.
    - Extra rotated lookups (each table on every rotated copy whose pieces no slot reads yet; PLL / BLD 16 → 96 slots, DR 7 → 8): nodes −8% / −50% / −51%, ×1.2–2.8 per node (189 ms / 9.7 s / 4.9 s).
      Both together: nodes −60% / −66%, 4–5× slower.
    - Lookups are random reads in 2–8 MB tables (this PC: 3 MB L3), so each extra lookup costs about what it saves. No start bound rose (a PLL's inverse is a PLL, a 2-edge flip is its own inverse).
- Method search (Part 8d): `searchMethod(scramble, method, { done, budgetMs, stop, onBetter, onProgress })` → `MethodSearchResult { best, seed, optimal, states, ms }` (engine.ts; `METHOD_SEARCH_MS` 30 s default).
  - Seed = `runMethod` (the steps' own lookahead), then a depth-first branch and bound. A node is a step start: `SearchLevel` = step index + round + its `stepCombos` queue (measured, closest first); pruned when used + queue[0].bound ≥ best.
    A non-last step lists its answers length by length from that bound, combo by combo in queue order, in pages of `SEARCH_PAGE` (100). For each page, every answer's next level is measured at once (`Promise.all`; the worker answers back to back),
    sorted by bound (stable) and visited while used + length + bound < best. The last (non-repeat) step is `searchCombos` with maxDepth best − used − 1.
  - LB(rest) = the next step's closest combo bound only. The plan's "any later step that keeps" bound wasn't done: a later step's goal depends on the grips taken in between. Taking only the earlier pieces plus that step's own
    (min over 24 rotations × offsets) gives nothing for CFOP / pseudo-slotting (pair 4 alone = the next pair's bound); following the steps in between too (CFOP: F2L) is Part 8e.
  - Visited: key = step / round / earlier-pieces id (`piecesId`, interned `goalToText`) / `cellsKey` of the held cube, value = fewest moves; cap `MAX_VISITED` 1M (past it, new keys aren't added).
  - Rules: answers never pass through the step's goal (the list rule), maxDepth is hard, firstFound is ignored (levels run with `firstFound: false`). A repeated step gets a level per round: an answer with moves goes to the next round (MAX_REPEATS);
    a later round with 0 moves goes to the next step without a row; NOTHING_NEW on a later round skips to the next step (`levelAt`). A step already at its goal only takes its 0-move answer. The offset the last step leaves isn't counted.
  - `optimal` = not halted (time or `stop()`, checked per visit and page) and complete: twips combos (`Combo.twips`, set when the measure gives null) only list their one answer, and lengths past `MAX_SEARCH_LENGTH` (40) are never listed.
  - Rust paging: `read_options` returns `SearchOptions` (+ `minDepth`, `after` = move text). In list mode `deepen` starts its bound at minDepth; at the depth of `after` it skips children before that path (`resume`, `resuming`) and the answer itself,
    so pages continue in turn order. Search mode ignores both. Checked: pages of 37 = one big page = the old full list filtered to that length (cross, pseudo cross with 4 targets, XCross, DR; 3 scrambles × 3+ lengths).
    Replay (1,275 requests of xxxcross, dr-finish, pseudo-lookahead; 8c → 8d): identical answers and nodes, times within noise.
  - Engine speed-ups (same answers): `remember` caches (cleared at `MAX_REMEMBERED` 10k) for `solvedAfter(moves)` (grips, offsets, the scramble's net rotation), the scramble held per grip (`scrambledInGrip`), `heldPattern` results (`heldAfter`;
    the search seeds each child's with `noteHeld` = combo's held cube + answer), `offsetGroups`, `movesKey`, `pieceMoves`. `rotationsIn` skips parsing without x / y / z; `maskPattern` copies arrays instead of `structuredClone`;
    `dropFree` returns the goal itself when nothing is `:x`; `parseGoalText` uses `PIECE_INDEX`. In the search, a page's earlier pieces (the same for every answer of a combo) are worked out once, and step results are only made for a run being recorded.
    Per measured step start ~3 ms → ~0.7 ms (≈ 1,500 per second in Node). Regression: 7 methods (6 examples + DR + finish) × 3 scrambles give identical solutions, offsets, alternatives and searches to 8c; the CFOP lookahead example 0.8 → 0.45 s.
  - `MethodStepResult.step` = the method step's index; `methodRow` / `methodTotals` are shared by `runMethod` and the search. A found run's `ms` = time since the search started, its steps' ms 0.
  - Page: method panel *Search fewest moves* + *for up to [30] s*, *Stop search* outside the locked editor (`stopRequested`), rows replaced on each `onBetter` (`Run.untimed` shows "—"), final status "the fewest this method can do" when optimal.
  - Testing: `harness/search.ts` style (fake worker; SCEN small = 2-step methods vs an exhaustive check with `stepCandidates` + `solveStep`; dr / cfop / pseudo / zz / zzcp / bld with BUDGET seconds after one warm-up `runMethod`),
    `harness/paging.ts` (worker messages straight to the fake worker), `harness/regress-{old,new}.ts` (the old engine imported by the project's absolute path). Built page checked in the browser pane (search, Stop, Run method).
- Method lower bounds (Part 8e): engine.ts only (TS); the worker and Rust are unchanged.
  - `gripGoals(pieces, rotations, keep, earlier)`: a step's goal per alternative × grip, with the covered-grip filter and NOTHING_NEW, no cube needed. `stepCombos` now uses it, and plain runs are identical (7 methods × 3 scrambles).
  - `laterGoals(steps, index, earlier)`: the goal walk.
    - Walk states are (grip from the start, earlier pieces, moves used so far). They follow each step's `gripGoals` and `piecesAfter` (now takes `{ rotation, settled }`).
    - Per later step, its goals are deduped by the goal named in the start's grip, `movesKey`, the grip (orient roles only), the offsets and the solvable-with moves.
    - It only returns the steps the next step doesn't keep, plus the last step reached, since a step that keeps asks for more. So CFOP gives F2L only, pseudo-slotting the ADF step's exact F2L, ZZ both blocks, ZZ with CP the whole cube.
    - It stops: at once for a repeated or untouched current step; before an untouched step; after a repeated step's first round; before a step with more than `MAX_LATER_GOALS` (64) goals; past `MAX_WALK_STATES` (256) states.
  - Moves for a later goal = every move the steps from the start up to it may use, renamed into that step's grip.
    - `moveInGrip` renames by conjugating with the grips (R in grip y is B as held). `turnName` drops the prime of quarter turns. `distinctTurns` drops a half turn whose quarter turn is there. `movesForGrip` takes a step's own list when it's the same turns, so tables are shared.
    - Measuring with the step's own moves would be wrong: pseudo's ADF step (D only) can't reach F2L.
  - `measureLater`: held cube via `heldInGrip` (turned through its transformation, not replayed; checked equal to `heldPattern` on 200 cases), the centers filter, one measure per offset group. Exact null = Infinity, split null = 0, errors = 0. `laterBound` = the largest, over steps, of each step's closest goal.
  - `searchMethod`:
    - `SearchNode.bound` = max(next step's closest combo, later bound). The later bound is measured only for children the next step's bound doesn't prune, and cached per (step, earlier id) for the walk and per start key for the bound.
    - Children are still visited in 8d's order (next step's bound), ties by the rest's bound; children are skipped by the rest's bound.
    - Root bound: `MethodSearchResult.bound`, `onBound`. `optimal` is also true when the best ≤ the root bound (`proven` stops the search at once).
  - Page: live status "…, at least N moves"; final status "any run needs at least N moves" when not proven.
  - Gap per level on the best runs (moves left: 8d bound → 8e bound). Never above the moves left on 24 best runs (8d's and 8e's).
    - CFOP after the cross 20: 3 → 5 and 17: 3 → 3; pseudo 17: 3 → 5 and 16: 0 → 4.
    - ZZ right-block start 12: 8 → 10, 9: 7 → 9, 6: 1 → 5; ZZ with CP 22: 9 → 10, 20: 7 → 10, 7: 3 → 7.
    - Roots +0–2 (whole-cube or F2L goals). DR + finish gets only a root bound (7–8, DR's own 4–7).
  - The F2L bound is weak: the worker measures it on its small (1M) sub-tables, since measures never switch a goal to its big plan, and even "cross + one piece" tables take a max over pieces.
    - Forcing big tables gave CFOP / pseudo +3 per level (3 → 6 after the cross).
    - Letting a measure switch once the big plan's tables all exist changed nothing in 30 s (the pair steps stay on small tables), so it wasn't kept.
  - Search, Node, 30 s after a warm-up run, same seeds as 8d. Today's 8d run first (this PC was faster than in 8d's notes), 8d → 8e:
    - CFOP 26 → 20 and 23 → 23. ZZ 20 → 16 and 17 → 17 (0.45 s vs 1.1 s). ZZ with CP 26 / 27 the same.
    - Pseudo 22 / 23 the same (22 at 4.7 s vs 5.8 s). DR + finish identical.
    - Step starts per second up (CFOP 414 / 720 → 803 / 921, ZZ ~2,900 → 3,300–4,000): pruned children skip their pages.
    - The first later goals build tables once (whole cube with face moves ~1.3 s, EOLine + blocks ~2.4 s, whole cube with U R L ~3 s), which delays ZZ with CP's first improvement from 0.1 s to 4 s.
  - Visiting children by the rest's bound alone (tried first): CFOP 23 → 25 and ZZ 17 → 24 in 30 s, so the next step's bound stays the visiting order.
  - Exhaustive 2-step cases (9 short + 9 full scrambles): all match. On full scrambles "2 edges then cross" is proven in 8 / 1 / 1 step starts instead of 4,415 / 667 / 1,681 (1.4 s → 0.17 s); "cross then a pair" is unchanged (its bound 6 is one under the best, 7).
  - Testing: harnesses in the scratchpad: `search.ts` (8d's, with `PATHS` saving best runs), `gap.ts` (MODE probe / gap, on a copy of engine.ts with `export { laterGoals, … }` appended), `regress.ts`. Built page checked in the browser pane (ZZ, 8 s: "at least 7 moves").
---

## Part 1 — Groups + centers

**Why:** one `:o` group per piece type can't express domino reduction / Kociemba phase 1 (U/D edges and E-slice edges are two separate swap groups), Thistlethwaite, E-slice placement, ZZ phasing. Roux needs some centers ignored (M moves).

**Do:**
- Numbered groups: `:o2`, `:o3`… (oriented, swappable within the group; `:o` = `:o1`) and a swap group with orientation ignored (suggestion `:s` / `:s2`). Each group gets its own shared id in `maskPattern`, distinct from other groups and from ignored pieces.
- Centers in goal text: if any center (`U L F R B D`) is listed, keep only those; if none, keep all 6 (current behaviour). Ignored centers → shared id + `orientationMod` 1.
- Chips: cycle may need a way to pick a group number (e.g. a group selector next to the chips).
- **Pitfall:** `netRotation` / `heldPattern` find the grip from all 6 centers. With M/E/S moves allowed and some centers ignored, centers move during the solution, so the grip detection (and `reachesGoal` / continue) must use only the kept centers, or skip renumbering. Test this carefully.

**Test:** DR goal (all corners `:o`, U/D edges `:o1`, E-slice edges `:o2`) from a scramble, verified from raw cube state; a Roux first block with `M` in the move set; old presets give the same results as before.

## Part 2 — Offsets

**Why:** "solved up to a layer turn" goals: pseudo-cross, pseudo-slotting, AUF/ADF, CMLL up to AUF, Roux M offset.

**Do:**
- `StepOptions.offsets?: string[]` (default `[""]`). For each grip × offset: target = `maskPattern(solved.applyAlg(offset), goal)`. Keep depth tightening across all combos; skip combos whose masked target is identical.
- The solution does not include the offset (the user fixes it later, e.g. final ADF). Result reports which offset won.
- `reachesGoal` must accept any of the step's offsets; store offsets in the run record.
- UI: offsets field (e.g. `D D2 D'`) with quick presets (none / AUF / ADF), and show the search count (grips × offsets) before solving.
- Note for chaining: the next step needs the same offsets, or it has to undo the offset.

**Test:** pseudo-cross (offsets `D D2 D'`) is never longer than the normal cross; scramble = a PLL alg + `U` → PLL with AUF offsets finds the PLL without the final U.

## Part 3 — Methods (step list) + keep previous

**Why:** users build a whole method as data.

**Do:**
- Types: `Method = { name, steps: StepConfig[] }`, `StepConfig = { name, pieces, keep?, grips: { bottom, anyFront }, offsets, moves, maxDepth }`.
- Engine: `runMethod(scramble, method)` runs steps in order; each starts from scramble + all previous solutions. `keep: true` = goal also includes every earlier step's pieces (this step's role wins on conflicts).
- UI: step list editor (add / remove / reorder / edit), "Run method" showing each step's solution and move count, save/load as JSON (file + localStorage).
- Ship a few example methods **as JSON data only** (CFOP cross + 4 pairs, ZZ EOLine, pseudo-slotting) — no method code in the engine.

**Test:** CFOP example ends with F2L solved; pseudo-slotting example uses offsets; a saved JSON reloads identically.

## Part 4 — Alternatives

**Why:** "any of these goals counts": XCross or double XCross, any of several blocks.

**Do:** a step can hold several goal texts; combos = alternatives × grips × offsets, shortest wins; result says which alternative won. UI: multiple goal lines per step.

**Test:** with alternatives "cross" and "xcross", the result is never longer than either alone.

**Done:** see "Alternatives (Part 4)" in Facts. Checked on 9 scrambles (D bottom, and any front): always min(cross, XCross); ties go to the XCross.

## Part 5a — Exact distance tables (Rust)

**Why:** twips's table is a lossy hash that fills during the first search, so every new goal pays seconds (XXCross first time 5.6–7.7 s, see Facts), and a reused big table
prunes worse. With the old cubing.js path the OLL step took ~6 s with bottom D (~30 s with any front) and a whole-cube PLL step minutes (re-measure at the start).
An exact table gives the distance to the goal directly: a goal that fits one table needs no search at all.

**Do:**
- New Rust modules in `search/src/` (e.g. `coords.rs`, `table.rs`), exported from `lib.rs` next to `Searcher`.
- State numbering read from the **masked target**, so Rust needs no role knowledge: a piece with its own id is tracked (spot, plus twist unless `orientationMod` is 1);
  pieces sharing an id form a group (which spots the group fills, plus their twists unless ignored); the ignored shared id isn't tracked.
  So solve / place / `orientN` / `swapN` all fall out of today's masks. Index = rank of the tracked spots (k of n; a combination for groups) × twist digits.
- Move tables: coordinate × move → coordinate, built once per (tracked pieces, moves) from the KPuzzle definition (R, R2, R' are separate moves, like `pieceMoves`).
- Breadth-first from **every accepted state at once**: all of the step's offsets (and alternatives) start at distance 0, so one table answers "distance to the goal up to any offset".
  Store 4 bits per state (`Vec<u8>`, two states per byte).
- Size budget: build only when the state count fits (start with ~100M states ≈ 50 MB); otherwise fall back to today's twips `Searcher`.
- Answer by descent: from the start, take any move that lowers the distance until it reaches 0 → a shortest answer in about that many lookups; then check which offset /
  alternative the end state matches. Distance > `maxDepth` = "No solution found!". First-found needs nothing special (the descent is already shortest).
- Slice moves (M/E/S): fine when they move no kept center; otherwise add the kept centers' spots to the state (small), or fall back to twips.
- Worker cache: key by (masked targets, moves); limit by memory (MB) instead of `MAX_SEARCHERS`, since tables range from 2 KB to ~50 MB.
- Engine side: simplest start keeps today's one request per combo (the worker reuses the table); folding offsets into one request comes with 5c.

Sizes (states): EO 2,048 · CO 2,187 · cross 190,080 · EOLine 270,336 · Roux first block 5.3M · cross + pair edge 3.0M · cross + pair corner 4.6M ·
XCross 73M (36 MB at 4 bits) · XXCross 21.5 billion (too big → 5b).

**Test:** same move counts as twips on cross, XCross, EO, EOLine, CO, Roux first block (with M), pseudo cross with ADF and an alternatives step.
Report table build time, memory and solve time, first time and repeated (benchmark heavy goals like XCross / pseudo pairs, not only cross / EO).

**Done:** see "Exact tables (Part 5a)" in Facts. Same move counts (and the same solutions) as twips everywhere tested. The 100M budget didn't hold up: an XCross table takes 5–7 s
and 35 MB to build while twips answers XCross in ~85 ms, so the worker builds tables up to 10M states (all under ~0.6 s) and leaves bigger goals to twips.
Pseudo pairs and every F2L pair with keep are XCross-size or bigger, so they still search with twips until 5b.

## Part 5b — Split tables + IDA* (Rust)

**Why:** XXCross, first layer, DR and steps with keep (F2L pairs, OLL, PLL) don't fit one table.

**Do:**
- Split the tracked pieces into sub-tables that each fit the budget; h = max of their distances (still a sure lower bound, much sharper than twips's lossy hash).
  Generic rule (no method knowledge): fill a sub-table with as many tracked pieces as fit (edges first), start the next one with the same edges plus the next pieces; tune by benchmark.
  Examples: XXCross = 6 edges (42.6M) + 2 corners (504), or cross + pair k for each pair (≈ 73M each); first layer = cross + 2 corners, twice (96M each);
  DR = CO + E-slice (1.08M) and EO + E-slice (1.01M) (Kociemba phase 1).
  Budget note from 5a: a 73M table takes 5–7 s to fill (memory-bound), so prefer sub-tables ≲ 10M (e.g. cross + pair edge 3.0M and cross + pair corner 4.6M per pair, ~0.4–0.6 s each)
  unless 5c's IndexedDB makes a one-time big build worth it. 6 edges (665,280 layouts) is too big for 5a's positions turn table (4M entries cap), so raise it or split positions.
- With keep, the merged goal differs per grip and per run, so build sub-tables from reusable pieces (cross edges, each pair, last-layer pieces…) instead of one table per whole goal.
  Sub-tables share 5a's cache, so an XXCross step reuses the tables an XCross step built.
- IDA* in Rust on the sub-table coordinates (each updated through its move table, no KPattern work per node), with move pruning (no same face twice, opposite faces in one fixed order).
  Same contract as twips: shortest answer within `maxDepth`, first-found option.
- Whole-cube goals (PLL with keep): Korf-style tables (corners 8!·3⁷ ≈ 88M states ≈ 44 MB at 4 bits, plus edge tables) are heavy for a browser.
  Decide in that chat: build them once and store them (5c's IndexedDB), or offer a fast non-shortest option for whole-cube steps (`solveFull`, two-phase). Until then, split PLL into corners, then edges.
- cubing.js's Kociemba (min2phase) tables don't help masked goals: they measure distance to DR / solved over every piece (only whole-cube steps via `solveFull` and a DR step).
- Retire the twips `Searcher` for everything 5a / 5b cover; keep it only as the fallback.
- Part 6 (several answers per search) and Part 7 (IDA* with a check function) reuse this IDA*.

**Test:** same move counts as twips on XXCross (D bottom + any front), first layer, DR, the CFOP + OLL method and the pseudo-slotting method; compare with the numbers in Facts.

**Done:** see "Split tables (Part 5b)" in Facts. Same move counts as twips on every step of the 4 example methods, CFOP + OLL, XXCross (any front), first layer and DR; the heavy goals are 10–1000× faster after a
one-time build (XXCross 2–28 ms vs up to 9 s, OLL with keep ~0.1–0.5 s vs ~20 s every time, XXXCross 0.2–0.8 s where twips didn't finish in 10 min).
The 10M-only version made first runs of shallow methods slow (CFOP 6.3 s, pseudo-slotting 7.3 s of table builds, vs 0.4 / 1.4 s with twips), hence the small-then-big tiers (CFOP 1.0 s, pseudo 1.7 s).
Whole-cube decision: no Korf tables and no automatic non-shortest answer. The generic split handles PLL with keep (16 tables, ~10–12 s once, then ms per case), so whole-cube steps go through it like
everything else; 5c's IndexedDB makes that build one-time. A random full-cube state (not a last-layer step) is still out of reach (`solveFull` remains the way to solve a whole cube).

## Part 5c — Rank combos by exact distance + table lifecycle

**Why:** with exact distances (5a) or sharp lower bounds (5b) known before searching, most alternative × grip × offset combos never need a search;
big tables should survive a reload, and memory should go back to Windows when nothing runs (WebAssembly memory never shrinks).

**Do:**
- `solveStep`: ask the worker for every combo's distance (5a) or bound (5b) first; sort by it (replacing `estimate` as the main key, keeping the fresh-pieces tie rule),
  skip combos whose bound can't beat the best, and with exact tables descend only the winner(s). Offsets fold into one request (the table already covers them all).
- One table for every grip: turn the held cube into the goal's frame (by the grip rotation) instead of renaming the goal per grip, so keep goals don't need a table per grip.
  Check that the covered-pieces filter and `NOTHING_NEW` still behave.
- First-time builds: the worker posts progress, the status shows "Building tables…".
- Store tables above ~1 MB in IndexedDB, keyed by (masked targets, moves, table-format version), so XCross-size tables load instead of rebuilding after a reload.
- Stop the search worker after ~60 s without searches so its memory is released; the next search starts a fresh worker (stored tables load from IndexedDB).
- From 5b: split goals start on small sub-tables and switch to big ones when their searches cost about as much as building them (`STATES_PER_NODE`). Big sub-tables already in IndexedDB count as built,
  so a stored goal goes straight to its big plan; store the big sub-tables (1.5–2.3 MB each), not the small ones (cheap to rebuild). For combo ranking, a split goal's bound = the largest sub-table distance
  at the start (no search). `SplitSearch` already takes a targets list, so folding offsets needs the sub-tables built with every offset's target, plus a check that the goal check still matches each target.

**Test:** method runs give the same solutions as before 5c with fewer searches (report search counts); after a reload the first solve uses stored tables (time before / after);
the worker disappears from DevTools → Threads after the idle time and the next solve still works.

**Done:** see "Ranking + table lifecycle (Part 5c)" in Facts. Every combo is measured first (exact distance or split lower bound), searched closest first, and skipped when it can't beat the best; a grip's offsets
share one table and one search. Replaying the new engine from the old runs' states gave the **same move count on all 112 steps** (7 methods × 4 scrambles: the 4 examples, CFOP + OLL, XXCross any front, pseudo cross
any bottom), with fewer searches (pseudo-slotting 180 → 43, pseudo cross any bottom 82 → 4, CFOP 43 → 38). Methods without offsets give identical solutions; with offsets, equal-length ties between offsets may now
pick another offset (the folded table's descent heads for whichever target comes first), so pseudo-slotting runs differ from before after the first tie (totals 29/23/27/… vs 33/22/30/…, either way).
Possible follow-up (fits Part 6): on equal length prefer no offset (saves the final ADF), e.g. a shortest-path walk in the folded table that tries the first target first.
Tables of 100k states and up are stored in IndexedDB and load after a reload or idle stop (CFOP + OLL 3.26 s → 0.69 s); the worker stops after 60 s idle and the next solve starts a new one (checked with a
fake Worker in Node: terminated once after 61 s, the next solve worked). First-found mode now stops at the closest combo (e.g. a 6-move cross where it used to stop at a 7-move one).
**Not done, on purpose:** "one table for every grip". With keep, a step's goal in each grip is a different physical goal (the new pair goes in another slot relative to the kept pieces), so turning the cube
into the start grip's frame only moves which pieces look fixed; it doesn't reduce tables. Without keep (or with a symmetric keep: cross, F2L, first layer) the grip-frame target is already one table for every grip,
and 5b's canonical sub-tables are already shared across grips and steps (a whole CFOP run built the cross table + 8 "cross + one slot piece" tables). The covered-pieces filter and `NOTHING_NEW` are unchanged (checked).
Not checked in a real browser (the browser pane refused localhost this time): run the built page, watch the status line say *building tables…* on a first XCross, reload, see *loaded N stored tables*, and check
DevTools → Threads after 60 s idle.

## Part 5d — Table files (export / import option)

**Why:** tables depend only on the goal (masked targets) and the allowed moves, never on the scramble, so a table built once can be saved and loaded anywhere. Big ones take seconds
to build (XCross-size 5–7 s; PLL's whole-cube corner / edge tables likely 10–20 s). The engine only offers the option to save tables to a file and load them back;
which tables to prebuild, host or hand out is up to an app that uses the engine (nothing is hardcoded or shipped with the engine).

**Do:**
- Table file format (Rust): a header (magic, table-format version, puzzle name, allowed moves, masked targets, state count, layout numbers that must match the numbering code) + the 4-bit distances.
  5c already added `table.toBytes()` and `DistanceTable.fromBytes(kpuzzle, targets, moves, bytes)` (header: magic, `TABLE_FORMAT`, states, depth; the numbering is rebuilt and its size checked) and `tableFormat()`;
  a file wraps those with the extra header fields (moves and targets, so a file can be imported without knowing them first).
  Any change to `coords.rs` numbering bumps the format version, so old files are refused (rebuilt instead), never misread. One file may hold several tables (a method's whole set; with 5b, its sub-tables).
- Key: the same (masked targets, moves, format version) key as 5c's IndexedDB store; loaded tables go into that store, so the worker finds them like self-built ones.
- Engine API (no page code): `methodTables(method)` lists the table keys a method needs (every step × alternative × grip × offset target, 5c's dry run, no search) and which are built;
  `buildTables(method, { onProgress })` builds the missing ones without solving; `exportTables(keys)` → bytes (one file); `importTables(bytes)` → which keys loaded, or a clear error per table.
- Test bench page: on the method panel, "Download tables" (builds what's missing, then saves one file with every table the method uses) and "Load tables" (file picker → import),
  plus a line saying how many of the method's tables are built / missing and their size.

**Test:** an imported table gives identical answers to a self-built one; a file from another format version or another goal is refused with a clear message and the table is rebuilt;
export from one browser profile, import in another, and the first run builds nothing (report time vs building).

## Part 6 — Lookahead across steps

**Why:** each method step takes its own shortest answer, so a method never accepts a slightly worse step that sets up the next ones.
Pseudo-slotting ("advanced keyhole": the corner and edge of a pair go into different slots, one D turn at the end lines them up), multislotting and keyhole choices only pay off across steps.
The goal side already works: offsets `D D2 D'` mean "D-layer pieces one D turn off, middle-layer edges home", which is exactly a pseudo pair. But on
`B D2 R' F R' L2 F' D' L' D2 F2 D2 L B2 U2 R' D2 L' U2 B'` the pseudo-slotting example picked offset "none" in every step and matched plain CFOP move for move (35 moves).
(Merging cross + first pair into one XCross step is **not** pseudo-slotting; don't "fix" the example that way.)

**Do:**
- `solveStep` can return several candidates instead of one: the best answer per grip × offset (today depth tightening cuts the other combos short), optionally also answers up to best + N moves.
- Optional `lookahead` per step in `StepConfig` (0 / missing = today's greedy behaviour, so old JSON keeps working): for each candidate of step i, run the next `lookahead` steps greedily
  and keep the candidate with the lowest total; then continue from that candidate for real. Beam search (keeping several partial solves) later if it's worth it.
- Candidates include each alternative (Part 4), so "cross | XCross" with lookahead can take a slightly longer XCross that saves a whole pair step.
- Cost ≈ candidates × the next steps' time, so it needs Part 5a–5c's speed. Twips returns one answer per search; listing several answers per grip × offset needs Part 5b's IDA* (it can keep going after the first hit)
  or 5a's exact tables (every move that lowers the distance starts another shortest answer).
- Results show, per step, how many candidates were compared and the total they were judged by; the step editor gets a lookahead field.
- Still no method code: lookahead is a generic search setting.

**Test:** with lookahead 1, step 1 + step 2 is never longer than greedy's step 1 + step 2 (same scramble); on the scramble above and several random ones, the pseudo-slotting example
ends some pair steps with a D offset and is at most as long as greedy overall in most runs (report the numbers); old method JSON without `lookahead` gives the same results as before.

**Done:** see "Lookahead (Part 6)" in Facts. Candidates = every shortest answer of every alternative × grip × offset, plus answers up to `extraMoves` longer (at most 64), so "best per grip × offset" became "all of them within the window".
Totals on 8 scrambles (the one above + 7 seeded), greedy → lookahead 1 → lookahead 1 with 1 extra move → lookahead 2: pseudo-slotting 218 → 197 → 183 → 192 (2 extra moves: 187, but ~3 s per run);
CFOP 227 → 211 → 188; ZZ 202 → 184 (1 + 1); "cross | XCross" with lookahead 1 + 2 extra on that step only 219 → 199 (XCrosses up to 2 moves longer than the cross now win when they save the pair).
The scramble above: greedy pseudo-slotting is now 32 (5c's folded offsets already left D' on the cross; the 35 was before 5c), lookahead 1 → 23, with D2 left on the cross and pair 1. D offsets show up in many pair steps.
Lookahead 1 on step 1 only: step 1 + step 2 never longer than greedy's (24 checks: CFOP cross, pseudo cross, pseudo pair 1 with 1 extra move; 10 of them shorter). Lookahead on every step is still greedy per window, not optimal overall:
pseudo-slotting 1 + 1 was 1 move longer than greedy on 1 of 8 scrambles (lookahead 2: also 1 of 8), shorter or equal on the rest.
Times (Node fake worker; first run with table builds / later runs): pseudo-slotting 1 + 1 4.8 s / 0.5–1.3 s; CFOP 1 + 1 5.2 s / 0.4–0.9 s; "cross | XCross" 1 + 2 4.4 s / 0.5–0.7 s.
Examples: pseudo-slotting now has lookahead 1 + 1 extra move on the cross and every pair, "CFOP (cross or XCross, lookahead)" has 1 + 2 on its first step; CFOP and ZZ stay greedy as baselines.
On the harness's own 4 scrambles the two examples went 105 → 90 and 113 → 98 moves.
5c's follow-up (prefer no offset on ties) needs no rule of its own: pair 4 with lookahead 1 counts the ADF step, so an offset pays for its fix there.
Not done: beam search (keeping several partial solves); candidates are only judged by greedy runs of the next steps. Not checked in a real browser (the pane refused localhost again): the page changes are type-checked and built.

## Part 7 — Named whole-state checks (later, one per chat)

**Why:** some goals aren't a pattern at all, so config can't express them:
- 2GR / ZZ-CT "CP solved" (corners solvable with only R and U), "solvable with M and U only", BLD parity.
- Pieces solved relative to each other anywhere (F2L pair joined anywhere, FMC pseudo-blocks).

**Do:** each becomes a built-in named check a user can tick in a step. Twips takes one target pattern, so each check needs its own search (Part 5b's IDA* with a check function) or a precomputed table (Part 5a). Still no method code: these are new building blocks, not methods.

**Done (7a, "Solvable with"):** see "Solvable with (Part 7a)" in Facts. Instead of a check named "2-gen CP", one generic step field: *Solvable with* moves (e.g. `R U`), the goal counting when those moves alone can finish it.
That covers 2GR / ZZ-d CP (`DL DFL DBL` + the other corners `:p`, solvable with R U), "solvable with M U" style goals, and any other "finish with these moves" goal whose closed targets stay ≤ 100k, with the same tables and IDA* (still shortest answers).
Checked: each CP line on 8 scrambles leaves corners that R U alone solve (the plain line did on 5 of 8 by luck); any front / any bottom grips; U offsets (within the moves: offset none) and D offsets (CP line up to a D turn, 2–4 moves instead of 5–6);
errors (x in the field, M with face turns while centers are kept, whole cube + R U). The 4 example methods × 4 scrambles give identical solutions, offsets and search counts to before.
New example "ZZ (left block + CP, then R U only)": EOLine, left block + CP (U R L, solvable with R U, lookahead 1 + 1), right block and last layer with R U only. On 8 scrambles 36–43 moves, first run 0.9 s (table builds), then 20–170 ms;
without the CP check, 5 of 6 scrambles fail at the R U last layer ("No solution found!"); lookahead on the CP step made 2 of 6 runs shorter. Built page (the built-in browser opened localhost this time): CP line step 6 moves in 1.55 s with its one table build;
the example method 41 moves in 1.46 s (15 tables built), after a reload 709 ms (12 loaded from IndexedDB, 3 small ones rebuilt).
Limits: later steps only keep the pieces the moves can't disturb (`settled`), so a later step that uses other moves can undo a CP; that's the method's choice, as in real 2GR / ZZ-d.

**Done (7b, relative groups):** see "Relative groups (Part 7b)" in Facts. Not the x y z closure suggested after 7a: that makes the whole goal relative (and needs a "no centers" goal), so it can't say "cross solved, pair joined anywhere".
Instead a role, `:r` / `:r2`…, marks groups of pieces solved relative to each other, and the engine sends every placement of the groups as targets (TS only; the tables and IDA* were unchanged and stay shortest).
Checked (Node, fake worker): pair joined anywhere 2–3 moves (2–5 into its slot), cross + pair joined 6–7 (cross 5–7, XCross 7–9), ~10 ms after a ~0.35 s first build; cross + two pairs (`:r`, `:r2`, 200 targets) 7–8 in ~90 ms; pseudo 2x2x2 (corner + 3 edges) 5–6 vs 6–7 at home;
twips on the same requests gives the same lengths; R U only, ZZ moves with EO kept (`:o` edges pushed around), ADF offsets and any front work; every answer is a rigid image of solved on the raw cube.
Methods: two "join the easiest pair" steps with keep pick different pairs and keep both joined (`:r`, `:r2`), an insert step after them keeps the other pair joined; lookahead 1 on the second join made one run 17 → 13 moves (free insert).
Pseudo 2x2x2 then 2x2x3 (the same group plus 3 pieces, no keep) extends the same block: 10–13 moves on 4 scrambles vs 11–13 at home. Old example methods: identical solutions, offsets and search counts. Built page: the new preset 7 moves in 381 ms with 3 table builds.
On the question whether relative checks could speed up ordinary steps: no. Answers are already shortest, and a "joined" table is a valid but weak lower bound (being in the slot implies joined, and joining takes only a few moves), so the cross + piece sub-tables almost always give the larger bound.
Limits: more than 10k placements per offset (3+ groups) is refused; with restricted moves a group already joined in a spot the moves never touch isn't recognized (that placement is dropped so the worker accepts the list).

**Done (7c, BLD):** see "BLD (Part 7c)" in Facts.
- Not the parity coordinate planned after 7b: BLD steps aren't "a state with even parity". They are "these pieces home, everything else exactly as it is now", which no goal could say.
- A step option makes unlisted pieces *untouched*. A *buffer* traces the cycle; cycle breaks and twisted-in-place pairs become alternatives, and the shortest wins.
- *Parity pieces* swap only when the targets left are odd, which the parities / twist-sums check detects. *Repeat until done* makes one step a whole BLD phase.
- Relabeling every end state to the solved cube makes all BLD steps one shared goal, with one whole-orbit table (all corners) added in Rust.
- Answers stay shortest: optimal commutators (8–10), parity 10–14, flips 13–14.

Limits:
- First-time 2-edge flips take seconds to a minute (no table that fits sees them).
- Twists of in-place pairs only start a step with the buffer home.

## Part 8 — Faster search before hand-written tables (8a–8h, one per chat)

**Why:** steps are optimal now; the next goal is near-optimal *methods* in a few seconds, e.g. a method "DR, then finish with `U D R2 L2 F2 B2`" behaving like Kociemba's two-phase solver
(that method *is* two-phase: phase 1 answers by length, each followed by a phase 2 bounded by best − phase 1; compare with `solveFull`, cubing.js's two-phase). Two things stand in the way:
- The finish step is slow (Facts, "Half-turn-only moves": 11–13 move finishes 14–131 ms, 14–15 move ones 0.4–4.7 s), while Kociemba calls its phase 2 thousands of times per second.
- Lookahead isn't a real search: at most 64 candidates (`MAX_CANDIDATES`), later steps greedy (`movesAhead`), no overall bound, nothing shared between branches.

Hand-written tables (Kociemba's coordinates) would bend the "engine never knows a step" rule, so first get everything generic out of the tables and the search; Part 9 only for the gap the benchmark still shows.

Checked while planning (2026-10-08):
- `OrbitCoord::new` (coords.rs) numbers all of an orbit's moving spots as one pool, so under DR moves the 8 U/D edges count as if they could reach all 12 spots. (8b: one numbering per spot set now.)
- `estimate_size` is an upper bound: the reachable-layout walk (`keep_reachable`) only runs for orbits of ≤ `REACH_LIMIT` (65,536) layouts, and never while sizing. (8b: exact per spot set, the walk still never runs while sizing.)
- No parity trick, no symmetry; 4-bit distances; outer turn tables are freed after the fill, so the search steps outer coordinates from spot lists (~3–4 µs per IDA* node). (8b: twist parity; no permutation parity, no symmetry. 8c: rotated copies of a table share it; inverse lookups measured, not kept.)

**Order:** 8a → 8b → 8c → 8d are the core (Kociemba-like methods), then 8e (better bounds for the method search). Re-run 8a's benchmark after each part; do 8f–8h only when its numbers point at them.

### Part 8a — Benchmark harness + faster nodes

**Do:**
- A Node harness (direct wasm API + fake-Worker method runs, as in Facts) over heavy goals, fixed seeded scrambles: DR phase 2 after a DR step, XXXCross, OLL and PLL with keep, a BLD 2-edge flip,
  pseudo pairs with lookahead, the DR-then-finish method.
- Per goal: start bound vs real length (bound gap: tables too weak), nodes, µs per node (search loop too slow), table build time and size. Keep the output as the baseline for 8b–8h.
- Profile `deepen` / `TableCore::step` / `distance`. Likely cost: recomputing indices from spot lists on every lookup. Options: keep per-orbit turn tables during searches when they're small (memory cap),
  incremental ranking, no allocations per node.

**Test:** same move counts on every goal; µs per node and total time before / after.

**Done:** see "Benchmark + faster nodes (Part 8a)" in Facts. The harness is `bench/` (record, replay, compare), with the old code's numbers as the baseline. The search loop now ranks children straight from their parent
and only moves a sub-table's pieces when a lookup needs them: about 2× faster per node everywhere (2.0–2.4× on the heavy searches, identical answers and node counts), method runs 1.4–4.4× faster warm.
Not done: per-orbit turn tables kept for searches (a 5-edge orbit needs ~14 MB of turn tables and each lookup becomes another random read, no better than ranking ~5 pieces). The PLL-with-keep step (8–53 s) and BLD flips
(5–19 s) are still slow because their bounds are 2–7 moves short, which is 8b / 8c's job.

### Part 8b — Spot classes, exact estimates, twist parity

**Do:**
- `OrbitCoord::new`: split the moving spots into the sets the turns connect (orbits of the turns' permutations on spots) and number each set on its own (a class only takes combinations within its set).
  DR moves: edges = 8 + 4 spots, so all 12 edges = 8!·4! = 967,680 states (not 12!), corners + E-slice edges = 40,320 · 24; R U: 7 edge spots, 6 corner spots.
- `estimate_size` uses the same sets, so it's exact for positions and the planner fits bigger sub-tables in the same budget. Check that the planner finds "all edges" and "corners + E-slice edges"
  for DR phase 2 by itself (those are Kociemba's phase-2 tables).
- Twist parity: when every piece of an orbit is tracked with its twist and the turns keep the twist sum (face turns), the last twist is implied (EO 2,048, CO 2,187).
- Bump `TABLE_FORMAT` (the worker deletes other formats' stored tables on start).

**Test:** same move counts as before 8b on 8a's set and the example methods; DR phase 2 times vs the Facts numbers; table sizes for DR phase 2, R U finish, EO, CO.

**Done:** see "Spot sets + twist parity (Part 8b)" in Facts. Identical answers on all 1,356 replayed requests, the 6 example methods and 12 DR + finish runs. DR phase 2 searches are 19× faster (21× fewer nodes) on big tables;
EO, CO, EOLine and DR's sub-tables are a half to a third of their old size with the same distances; every other goal numbers exactly as before.
The planner doesn't find Kociemba's two phase-2 tables by itself: it fills each table edges first, so it finds "all edges" (plus one corner) and repeats it once per corner, never seeing the corners together (moved to 8f).
Not checked in a real browser: with `TABLE_FORMAT` 2 the worker deletes every stored format-1 table on its next start and rebuilds what it needs, once.

### Part 8c — Inverse and symmetric lookups

**Do:**
- Inverse lookups: when the goal is the whole cube solved (PLL with keep, DR phase 2, every relabeled BLD step), a state and its inverse need the same number of moves, so each table may also be
  looked up on the inverse state; bound = the larger. Detect it from the targets (one target, every piece its own id, twists counted), never from step names.
- Symmetric lookups: find the cube symmetries (24 rotations; mirrors only if they can be expressed on the KPuzzle) that map the move set and the target set to themselves, look each table up on the
  conjugated states too, and build fewer distinct tables (whole cube: one "4 U edges + one piece" table serves several).

**Test:** same move counts; bound gap and nodes on PLL with keep, DR phase 2 and BLD flips (Facts: 3.5–53 s).

**Done:** see "Rotated tables (Part 8c)" in Facts. The symmetric part as planned: a planned sub-table that is a rotated copy of another (by a rotation that keeps the moves) is read through it, so whole-cube goals
build far fewer tables (PLL with keep and BLD 4 instead of 16, DR finish 1 instead of 7, 140 → 96 MB on the replay) with identical answers, nodes and speed; first runs got faster (BLD example 59 → 33 s,
DR + finish 11 → 6 s, then ~1 s warm). The lookups that would sharpen bounds (inverse, and rotated copies no planned table covers) did cut nodes (up to 37% and 51%) but cost more per node than they saved
on every heavy goal, so neither is kept; the bound gap is unchanged (bld-flip 6.3 / 7, cfop-oll-pll 2.35 / 6, dr-finish 2.75 / 6). Detection works from the targets only (one target, each piece its own id).
Not checked in a real browser (`TABLE_FORMAT` is unchanged, so stored tables still load; the worker just asks for fewer).

### Part 8d — Anytime method search

**Do:**
- A new method run mode next to lookahead (lookahead stays as is): depth-first branch-and-bound over the steps, seeded with the lookahead (or greedy) total as the best so far.
- Each step lists its answers by length, no cap, up to best − used − LB(rest). The last step needs no list (its measure / search is its cost).
  LB(rest) = the largest bound to any later step's goal that keeps this step's pieces (min over that step's grips); without keep, the next step's bound only.
- Visited table keyed by (step index, held cube, earlier pieces) → fewest moves used to get there (extends `stepCandidates`' per-step end-state dedupe to the whole run).
- Run the loop inside the worker (or batch requests): thousands of list + bounded-search calls per second can't each be a round trip.
- Anytime: a time budget and Stop; each shorter total shows as it's found; "optimal for this method" only when the search finishes.
- Method rules, decide and write down: offset fixes (ADF / AUF) count; `repeat` rounds are searched like steps; `firstFound` / `maxDepth` are hard limits (or ignored); the covered-grip filter stays.
- If it runs long, split it: 2-step methods first (DR + finish), N steps next.

**Test:** never longer than lookahead on the same scrambles; small 2-step cases match an exhaustive check; DR + finish vs `solveFull` (length, time to reach 20 / 19 moves);
CFOP F2L and pseudo-slotting: time to the first improvement and to the proof (report it even when the proof is too slow).

**Done:** see "Method search (Part 8d)" in Facts. One generic search for N steps (2-step methods needed nothing special), run from the engine with batched worker requests instead of inside the worker:
after the engine's per-step-start work got cheaper (~3 → ~0.7 ms, mostly cached alg parsing), the worker round trips weren't the limit. Seeded with the plain run, so never longer than lookahead. Numbers (Node, 30 s after a warm-up run):
- Exhaustive check: 9 two-step cases (2 edges then the cross, cross then a pair with any front, pseudo cross then ADF; 3 full scrambles each) all match an enumeration of every step-1 answer shorter than the best + step 2's shortest,
  all proven optimal in 5 ms–4 s (up to 4,415 step starts). Cross then a pair: 9–12 move plain runs → 7 (an XCross plus a 0-move pair).
- DR + finish (4 scrambles): plain 19 / 23 / 22 / 25 → 19 / 17 / 20 / 20; `solveFull` 19 / 20 / 20 / 21 (74–695 ms). Time to 20: seed / 1.3 s / 16 s / 1.4 s; to 19: seed / 1.75 s / not in 30 s / not in 30 s.
  The limit is listing long DR answers (every 12-move DR: ~9 s on small tables, ~2,300 answers; 13 moves: 41k answers in ~2 min), i.e. 8a's ~4 µs per node vs Kociemba's coordinate tables (Part 9).
- CFOP: 31 → 26 (first improvement 0.5 s, last 11 s), 31 → 23 (4.7 s, 10 s). Pseudo-slotting (seed already with lookahead): 23 → 22 at 12.7 s, and 23 → none in 30 s. ZZ: 23 → 21, 28 → 17 (2 s); ZZ with CP: 36 → 26, 42 → 27.
  No proof in 30 s for any whole method: under a 6-move cross, every cross answer up to best − (pair bounds) is still open.
- BLD example: works (rounds as levels) but its flip / parity searches take seconds each, so 30–40 s gave no improvement.
- Built page: ZZ with CP 41 → 29 in 10 s (with 14 table builds), Stop ends it at once with the best run.
Not done: a lower bound from later steps (see Facts; now Part 8e), running the loop inside the worker (not needed after the engine speed-ups), proofs for whole CFOP / DR runs.

### Part 8e — Method lower bounds (pruning before per-node speed)

**Why:** 8d prunes a step start with the next step's bound only. After a CFOP cross that is one pair (~7 moves) while ~25 really remain, so almost nothing is pruned. The tree grows ~13× per move of gap between the bound
and what really remains, so a sharper bound cuts it exponentially; faster nodes (8f–8h, Part 9's hand-written tables, ~10–40×) only buy about one move of depth.
Decided after 8d (2026-10-09): bounds first, hand-written tables only for the gap left afterwards (DR + finish, where the bound is already Kociemba's and only per-node speed is missing).
Expect better runs sooner, not proofs: a whole CFOP or DR run likely stays unprovable either way (even two-phase solvers don't prove).

**Do:**
- Measure first: per 8d scenario (CFOP, pseudo-slotting, ZZ, ZZ with CP, DR + finish; same seeds), the bound at the root and after each step on the best run's path vs the moves that really remain (gap per level). Keep it as the baseline.
- Goal walk (TS, no search): from the earlier pieces at a step start, follow the later steps' goal texts through their grips (and alternatives) with the same goal algebra the run uses (`rotateGoal`, `mergeGoals`, the covered-grip filter, `piecesAfter`),
  giving the goals each later step can have; dedupe them and cap the count (e.g. 64; past it, fall back to the next step's bound). CFOP with any front: every pair order ends at the same goal, F2L.
- Bound for the rest = the largest, over later steps j that keep earlier pieces, of the smallest measured distance among j's possible goals (with its offsets' targets, as a normal measure). Sound because step j's goal holds every piece
  kept so far whatever happens in between, and fewer pieces can only need fewer moves; steps that don't keep only bound themselves (the next step's bound, as now). Keep the larger of this and the next step's bound.
- Solvable-with steps count only their settled pieces; untouched (BLD) steps keep the next step's bound (their goals depend on the cube).
- Cost: the extra goals' tables are ordinary split goals (cached, stored); measure them only when the next step's bound doesn't already prune, and remember measures per (held cube, goal) within a search.
- Show the root bound in the search's status ("at least N moves"), so a run that reaches it is known to be the fewest without finishing the search.

**Test:** never a bound above what really remains (check every level of the best runs found: used + bound ≤ best); the exhaustive 2-step cases still match and prove faster; per scenario, gap before / after,
time to the first improvement and the best after 30 s vs 8d's numbers (same seeds); step starts per second (the extra measures' cost).

**Done:** see "Method lower bounds (Part 8e)" in Facts. The goal walk and the bound as planned (TS only), with every move the steps in between may use (renamed per grip), and only the steps whose goal the next step doesn't keep are measured.
- The bound is sound on every level of 24 best runs, and the exhaustive 2-step cases match (some now proven at the root, 4,415 → 8 step starts).
- In 30 s: CFOP 26 → 20 and ZZ 20 → 16 on one scramble each; every other scenario equal to 8d (DR + finish unchanged: its only later goal is the root's).
- Plain runs are identical.
- The gap is still large: after a CFOP cross ~20 moves remain and the bound is 3–5. A bound made of "cross + one piece" tables can't add up four pairs; even big tables give only ~6.
- Kept 8d's visiting order (by the rest's bound found worse runs in time).
- Not kept: measures switching to big plans (no effect).
- Not done: a whole-run proof (as expected). Sharper F2L-type bounds are a table question (8f: e.g. a planner that tries "cross + a pair" tables, with sampling).

### Part 8f — Table capacity (only if 8a–8c show the bounds are the limit)

**Do:**
- 2-bit tables: distance mod 3; the exact distance is recovered once at the start, children follow from parent ± 1 (`deepen` already tracks each table's last exact distance). 2× states per MB.
- Planner tries a few candidate splits (whole-orbit groups, per piece, mixed) and keeps the best mean bound on a small sample of random states.
  From 8b: DR phase 2 gets 7 tables "all 12 edges + one corner" (edges first, then whatever fits), so the corners are never seen together. One candidate to try: fill a table with its seed's own orbit first
  (counted by hand, not built: all edges + UFR 7.7M, then all corners + UF UR FR 9.0M, 2 tables instead of 7); it also changes first layer, XXCross… plans, hence the sampling.
- From 8c: extra rotated lookups (a table read on rotated copies no planned table covers) halve PLL / BLD-flip nodes, but all 80 of them cost ~2.5× per node; keeping the few that raise the bound most on the sample
  could pay off. Inverse lookups cut nodes 7–37% at ~2–3× per node (the whole state per depth is the fixed cost); worth a retry only if lookups get cheaper (8g / 8h).
- Budget from `navigator.deviceMemory` instead of a fixed 10M.
- From 8e: the method search's later-goal bounds (F2L after a CFOP cross) are measured on small 1M sub-tables, since measures never spend nodes or switch plans. Forced big tables gave +3 per level (3 → 6 after a cross), still far from the ~20 moves left.
  - A planner candidate with "cross + one pair" tables (XCross, 73M) would see pairs whole.
  - Or let measures switch once a goal has been measured many times. Measure the gain with 8e's gap check (`gap.ts`) first.

**Test:** same move counts; bound gap and nodes vs 8c.

### Part 8g — Symmetry-reduced numbering (only if still needed)

**Do:** one entry per symmetry class (up to 16× for DR goals, 48× for the whole cube), canonical form per lookup (symmetry move tables for the coordinate). Biggest table gain, hardest change.

**Test:** same move counts; table sizes and nodes vs 8f.

### Part 8h — Parallel search (only if still needed)

**Do:** split the first moves' subtrees over several workers (each loads the tables from IndexedDB, so memory × workers) or wasm threads (SharedArrayBuffer, needs COOP / COEP headers); parallel table builds the same way.

**Test:** same move counts; speedup per core count on long searches (BLD flips, XXXCross, 8d's proof).

## Part 9 — Hand-written tables (last resort)

**Why:** hand-written coordinates (Kociemba's phase 1 / phase 2) can still beat generic ones on per-node cost and symmetry; only worth it for gaps Part 8's benchmark still shows (likely DR phase 2 per-node speed).
From 8d: the method search on DR + finish is held back by listing DR (phase 1) answers, ~4 µs per node (every 12-move DR ~9 s), not by the finishes. Do this after 8e, and only for what its numbers still show.

**Do:**
- A Rust registry that matches the compiled goal (masked targets + moves, the table key), never step names; a match uses a hand-written generator with the same calls as a generic table
  (distance, step), so measure / search / list / lookahead / 8d work unchanged; anything else falls back to the generic builder.
- Say in the results when a step used one: a goal that almost matches (an offset, a `:p`, M allowed) silently falls back to generic speed.

**Test:** identical move counts to the generic path on every matched goal; time before / after.
- `knownAnswers` lives as long as the page; it could be stored like the tables if repeated flips matter.