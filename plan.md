# puzzly — engine roadmap (context for new chats)

Start a new chat with: "Read PLAN.md, then do Part N." Do **one part per chat**, then tick it below and commit.

## Progress

- [x] Part 1 — Groups + centers
- [x] Part 2 — Offsets
- [x] Part 3 — Methods (step list) + keep previous
- [x] Part 4 — Alternatives
- [x] Rust search worker (one worker per session, twips tables kept between searches; done outside the numbered parts)
- [x] Part 5a — Exact distance tables (Rust): goals that fit one table, answered without searching
- [ ] Part 5b — Split tables + IDA* (Rust): goals too big for one table
- [ ] Part 5c — Rank combos by exact distance + table lifecycle (IndexedDB, idle stop)
- [ ] Part 5d — Table files: option to download (export) a method's tables and load them back
- [ ] Part 6 — Lookahead across steps (pseudo-slotting, multislotting)
- [ ] Part 7 — Named whole-state checks (later, one check per chat)

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

**Test:** method runs give the same solutions as before 5c with fewer searches (report search counts); after a reload the first solve uses stored tables (time before / after);
the worker disappears from DevTools → Threads after the idle time and the next solve still works.

## Part 5d — Table files (export / import option)

**Why:** tables depend only on the goal (masked targets) and the allowed moves, never on the scramble, so a table built once can be saved and loaded anywhere. Big ones take seconds
to build (XCross-size 5–7 s; PLL's whole-cube corner / edge tables likely 10–20 s). The engine only offers the option to save tables to a file and load them back;
which tables to prebuild, host or hand out is up to an app that uses the engine (nothing is hardcoded or shipped with the engine).

**Do:**
- Table file format (Rust): a header (magic, table-format version, puzzle name, allowed moves, masked targets, state count, layout numbers that must match the numbering code) + the 4-bit distances.
  `DistanceTable.to_bytes()` and `DistanceTable.from_bytes(kpuzzle, targets, moves, bytes)`: rebuild the numbering from the same inputs (cheap), check the header matches, attach the distances.
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

## Part 7 — Named whole-state checks (later, one per chat)

**Why:** some goals aren't a pattern at all, so config can't express them:
- 2GR / ZZ-CT "CP solved" (corners solvable with only R and U), "solvable with M and U only", BLD parity.
- Pieces solved relative to each other anywhere (F2L pair joined anywhere, FMC pseudo-blocks).

**Do:** each becomes a built-in named check a user can tick in a step. Twips takes one target pattern, so each check needs its own search (Part 5b's IDA* with a check function) or a precomputed table (Part 5a). Still no method code: these are new building blocks, not methods.