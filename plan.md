# puzzly — tables for specific goals (context for new chats)

Start a new chat with: "Read plan.md, then do Part N." Do **one part per chat**, then tick it below and commit.

This plan is Part 9 of `plan-engine.md` (hand-written tables) worked out for the example methods. Two other plans are still open:
- `plan-engine.md`: the 3x3x3 engine and its search. Its *Facts* section is still the reference for how the search works; its 5d (table files) and 8h (parallel table builds) stay there.
- `plan-puzzles.md`: more puzzles (12 parts, none started). To go on with it: "Read plan-puzzles.md, then do Part N."

## Progress

- [ ] Part 1 — Method benchmark: every example method, step by step, first run and warm
- [ ] Part 2 — Case tables: a slow step's answer is remembered per case and stored in the browser
- [ ] Part 3 — Case sheets: a step's cases solved ahead of time and shipped as files (the short ones)
- [ ] Part 4 — Room for hand-written tables in the Rust search (no behaviour change)
- [ ] Part 5 — The cube by hand: coordinates, turn tables, the 16 symmetries with mirrors
- [ ] Part 6 — Phase 1 table: exact distance to domino reduction
- [ ] Part 7 — Phase 2 tables: the domino finish (only if Part 6's numbers ask)
- [ ] Part 8 — Long sheets: ZBLL, TTLL, the whole last layer (hours of solving, run outside the chat). ZBLL with face turns done (2026-10-18) as an alg set, see Part 8

**Order:** 1 first. Then two lines that don't depend on each other: 2 → 3 → 8 (case tables) and 4 → 5 → 6 → 7 (hand-written tables). Do 2 and 3 before 4: they cover the slow steps of about 12 of the 19 methods; the hand-written line helps one (Two-phase), and mostly its method search.
**How hard:** 1 easy · 2, 3 medium · 4 medium-hard · 5, 6 hard (each may take two chats) · 7 medium · 8 medium, plus a long run. About 10 chats in all; the hand-written line alone (4–7) is 4 to 6.

## Goal

Every example method (`src/demo/example-methods.json`: 19 methods, each from scramble to solved) runs with no step slower than a few seconds, and the method search (plan-engine 8d) gets through domino-type methods like a two-phase solver.

**The engine still never knows a step by name.** A table for a specific goal is picked from what the search worker receives (the masked targets, the allowed moves, the start), never from a step's or a method's name. A goal that doesn't match exactly falls back to the generic tables, and the result says which kind answered.

Rules for every part:
- Same lengths as the generic path on every step, and identical answers where the part says so.
- The benchmark replay (`bench/replay.ts`) gives the same answers and node counts whenever the part doesn't touch what it measures.
- Say how long the part will take before starting, test what the part asks, then stop.
- When a part is done: tick it, add what was found to *Facts*, update the README.

## What the first numbers say (2026-10-10)

It isn't one set of tables per method. The 19 methods share their steps' goals, and those fall into five families:

| Family | Steps | Today | What it needs |
| --- | --- | --- | --- |
| Blocks, pairs, orientation steps | cross, pairs, Roux / Petrus / ZZ blocks, EOLine, EO, corners first | 2–160 ms warm, 0.1–5 s on the first run (table builds) | nothing |
| Last pieces with face turns, everything else kept | OLL, PLL, CLL, ELL, COLL, EPLL, ZBLL, CMLL, 6CP, L5EP, top corners, last 3 corners | by answer length: up to 11 moves under 0.1 s warm, 12 moves 0.25–10 s, 13 moves 6–30 s, 14 moves 26–73 s (warm too) | case tables (Parts 2, 3, 8) |
| Last pieces with fewer moves | ZBLL and TTLL with `U R L`, last layer with `R U`, last six edges with `M U`, half-turn finish | under 6 s on the first run, 5–110 ms warm | nothing |
| Blindfolded rounds (whole cube, relabeled) | 3-cycles, one-target swaps, flips | first round 12–15 s (builds), then 3 ms–6 s each | already remembered while the page is open; Part 2 stores them |
| Domino steps | DR, half-turn reduction, domino finish | plain runs 0.2–2 s; the method search is held back by listing long DR answers (every 12-move DR about 9 s, plan-engine 8d) | hand-written tables (Parts 4–7) |

Why hand-written coordinate tables (Kociemba's) are only planned for the domino family:
- They measure how far a state is from an axis' domino group. A PLL lies inside the U/D one (distance 0) and near the other two, and most last-layer states are close to all three. The generic piece tables already give 9–11 there.
- A lookup is already at memory speed: a search node is ~3 µs for 16–27 lookups (plan-engine 8a), about 0.15 µs each, on tables bigger than this PC's cache. Hand-written numbering can't make a cache miss cheaper.
- What they do give is an **exact** distance for the whole DR goal (the generic split is two tables, each a lower bound), which turns "list every DR of n moves" from a search into a walk.

What last-pieces steps have instead is **few cases**: the answer depends only on the pieces left, not on the scramble. Counted by hand (Part 3's tool prints the real numbers), each count with the turned copies and the solved case:

| Step (everything else kept) | Cases |
| --- | --- |
| Top cross (EO of the last layer) | 8 |
| The beginner method's other top steps: edges, corners in place, corners turned | 24, 12, 27 |
| EPLL | 12 |
| L5EP | 60 |
| ELL | 96 |
| OLL | 216 |
| 6CO | 243 |
| PLL | 288 |
| CLL, COLL, CMLL | 648 each |
| 6CP | 720 |
| ZBLL | 7,776 |
| Whole last layer | 62,208 |

## Current state (2026-10-10)

- `main`, commit 824d416 "modularization". Layout: README, *Folder layout*.
- `src/demo/example-methods.json` was rewritten in the same session as this plan: 19 methods, each ending with the cube solved (it held 6, most stopping at F2L). **If the file still holds 6 methods, stop and ask for the new one before Part 1.**
  The same change makes `bench/record.ts` take its CFOP + OLL + PLL scenario straight from example 0 and cut the pseudo-slotting example back to its first 6 steps, so the recorded requests stay the same.
- Where things are: the worker picks a solver in `src/engine/worker/solvers.ts` (exact table, split tables, twips) and stores tables through `table-store.ts`; the engine remembers blindfolded answers in `src/engine/step/combo.ts` (`knownAnswers`, `searchCombo`);
  Rust tables are `search/src/table.rs` (`TableCore`), the IDA* reads them through `Slot` in `search/src/split/driver.rs` and `split/ida.rs`, rotations are `search/src/symmetry.rs`.
- This PC: i5-3210M, 2 cores / 4 threads, 6 GB (the browser reports 4, so plans stop at 10M states).

## Facts worth knowing (checked 2026-10-10, save re-checking)

### The example methods and where each spends its time

One seeded scramble each (`bench/setup.ts`, the first scramble of `random(7)`; methods 7, 9, 11 and 12 of `random(21)`), a fresh Node process per method, so every time includes its table builds. Three methods ran at once on two cores, so read the times as upper bounds. Every run ended with the cube solved (`experimentalIsSolved`, any orientation).

| # | Method | Moves | First run | Slowest steps (moves) |
| --- | --- | --- | --- | --- |
| 0 | CFOP (cross, 4 pairs, OLL, PLL) | 51 | 13 s | OLL 7.4 s (builds), PLL 3 s (10) |
| 1 | CFOP (cross or XCross, lookahead) | 46 | 21 s | PLL 10 s (12) |
| 2 | Pseudo-slotting (CFOP up to ADF, lookahead) | 48 | 45 s | PLL 33 s (14) |
| 3 | CFOP with ZBLL (last pair + EO, then one look) | 47 | 35 s | ZBLL 26 s (14), last pair + EO 6.4 s |
| 4 | CFCE (cross, 4 pairs, CLL, ELL) | 52 | 8.6 s | CLL 4.6 s (12), ELL 1.8 s (9) |
| 5 | Beginner (layer by layer) | 62 | 17 s | top corners turned 4.3 s (12) |
| 6 | Roux (blocks, CMLL, last six edges) | 41 | 4.4 s | CMLL 2.7 s |
| 7 | ZZ (EOLine, blocks, ZBLL) | 42 | 7 s | ZBLL 6 s (17, `U R L`) |
| 8 | ZZ (left block + CP, then R U only) | 40 | 3.3 s | left block + CP 2.2 s |
| 9 | ZZ-CT (EOLine, F2L minus a pair, TSLE, TTLL) | 40 | 8.2 s | TTLL 5.6 s (15, `U R L`) |
| 10 | Petrus (2x2x2, 2x2x3, EO, F2L, COLL, EPLL) | 49 | 37 s | COLL 30 s (13), EO 5 s |
| 11 | Heise (blocks, EO, edges + 2 corners, last 3 corners) | 42 | 15 s | edges + 2 corners 8.9 s, last 3 corners 3 s (12) |
| 12 | LEOR (left block, EO stripe, right block, ZBLL) | 41 | 9 s | EO stripe 4.1 s, ZBLL 3.9 s (16, `U R L`) |
| 13 | Mehta (FB, 3QB, EOLE, 6CO, 6CP, L5EP) | 42 | 9.4 s | L5EP 3.1 s (11), 6CP 2.3 s |
| 14 | Corners first (corners, left edges, right edges, middle slice) | 36 | 15 s | right edges 8.7 s |
| 15 | Two-phase (domino reduction, then finish) | 25 | 2.9 s | finish 2.1 s (15) |
| 16 | Four-phase (EO, domino, half-turn reduction, finish) | 32 | 1.5 s | half-turn reduction 0.8 s |
| 17 | 3-style BLD | 106 | 14 s | first round 12 s (builds), one 13-move cycle 1.7 s |
| 18 | One target at a time BLD | 238 | 28 s | first round 15 s (builds), swaps up to 6.4 s |

Warm (more scrambles in the same process):
- CFOP: cross and pairs 4–82 ms, OLL 17–76 ms, PLL 8 ms (11 moves) and **51 s (14 moves)**.
- ZZ, ZZ-CT and LEOR with `U R L` last steps: whole runs 24–135 ms.
- Beginner: everything under 160 ms except top corners turned, 10 s (13 moves).
- Heise: last 3 corners 6.2 s (13 moves).

Found while writing the methods:
- **`U R L` instead of face turns** for a last step after ZZ-type edge orientation: on two scrambles the same ZBLL took 14 moves in 69–73 s with face turns and 15–17 moves in about 6 s with `U R L`, table builds included (a 13-move TTLL took 24 s with face turns). The three ZZ-type examples use `U R L`; "CFOP with ZBLL" keeps face turns.
- **A repeated step stops at its first round with 0 moves**, so "the easiest piece, any front, repeat" ends early when one of its pieces is already home by luck (the beginner method's middle edges stopped after round 1 with three edges unsolved). The examples use four explicit steps instead. `method/run.ts`, the `!finished.moves` break; the README says such a step runs "until F2L is done".
- Half-turn reduction is a plain step: all corners solved, the edges as three swap groups (`UF:s UB:s DF:s DB:s`, `UR:s2 …`, `FR:s3 …`), *solvable with* `U2 D2 R2 L2 F2 B2`, moves `U D R2 L2 F2 B2`: 96 end states, 10 moves in 0.8 s.
- Centers take roles too: Roux's edge orientation step is `U:s D:s UF:o UR:o UB:o UL:o DF:o DB:o` with `M U` (the U and D centers on the U / D spots in either order).
- Wide moves work in a step's moves (`Rw` in Roux's second block).
- Testing: a long search blocks the Node process (the worker runs in it), so a time limit has to come from outside (`timeout 240 node …`, one process per method), with a line printed when each step starts (`MethodOptions.onStart`, `writeSync`).

### Numbers for the hand-written line (well known, to confirm when built)

- Phase 1 (domino reduction on one axis): flip 2,048 × twist 2,187 × E-slice positions 495 = 2,217,093,120 states, deepest 12.
  Under the 16 symmetries that keep the axis, flip × slice (1,013,760) falls into 64,430 classes: table 64,430 × 2,187 = 140,908,410 entries, 35.2 MB at 2 bits.
- Phase 2 (domino finish, `U D R2 L2 F2 B2`): 8! · 8! · 4! / 2 = 19,508,428,800 states, deepest 18. Corner permutations 40,320 fall into 2,768 classes: table 2,768 × 40,320 U/D-edge permutations = 111,605,760 entries, 27.9 MB at 2 bits.
- cubing.js's order and twists (plan-engine *Facts*): EDGES `UF UR UB UL DF DR DB DL FR FL BR BL`, CORNERS `UFR UBR UBL UFL DFR DFL DBL DBR`, corners judged by their U/D sticker, edges by the F/B axis. That is Kociemba's convention for the U/D axis.
- The left-right mirror isn't in the KPuzzle (plan-engine 8g), so the generic code only has the 24 rotations. By hand a mirror is a permutation of the pieces with corner twists negated.
- Today's generic DR plan is two lower-bound tables, flip × slice (1.01M) and twist × slice positions (1.08M) (plan-engine 8b); the generic domino finish takes 6–260 ms (3k–10k nodes).

### How a table reaches the search today (read in the code)

- The IDA* takes `&[Slot]`, a `Slot` being `{ table: Rc<TableCore>, turns: Option<Vec<u8>> }` (a table, and a turn map when it is read through a rotation). It calls `TableCore::step`, `child_index`, `value` and `distance`.
- Tables hold each state's distance mod 3 in 2 bits; the search carries exact distances from parent to child (a neighbour is one less, equal or one more). A hand-written table stored the same way fits that bookkeeping.
- `SplitSearch::new` plans the sub-tables, the worker builds the missing ones (`attachTables`), keeps them up to `MAX_CACHE_MB` and stores those of 100k states or more in IndexedDB under `tableKey` (format / moves / targets).
- A worker request is `{ kind: "measure" | "search" | "list", start, targets, moves, maxDepth?, … }` with `start` already masked by the goal, so **moves + targets + start is the whole case**: two scrambles that leave the same last-layer case send the same request.

## Part 1 — Method benchmark

**Why:** the numbers above are one scramble per method, run three at a time. The benchmark in `bench/` has five scenarios and none of the new methods. The order of Parts 2–8 should rest on a real table.

**Do:**
1. `bench/methods.ts` (added to `bench/build.mjs`): one example method by index, on 5 seeded scrambles, two passes in one process (first run with builds, then warm). It prints a line when each step starts and when it ends: moves, ms, ok.
2. A small runner that starts one process per method with a time limit and collects the lines (a search can't be stopped from inside the process).
3. For the slow steps, the recorded requests through `bench/replay.ts`: nodes, µs per node, start bound against the answer's length.
4. Write the table into *Facts* (per method: first run, warm, worst step) and the families' numbers into *What the first numbers say*. Change the order of Parts 2–8 here if the table says so.

**Test:** every method ends with the cube solved on every scramble, every step ok.

**Size:** easy; about 30 minutes of running.

## Part 2 — Case tables

**Why:** a 14-move PLL takes up to a minute every time it comes up, and there are only 288 PLL starts. The engine already remembers blindfolded cases while the page is open (`knownAnswers`); this does it for every slow search and keeps it across reloads.

**Do:**
1. In the worker (it sees every request and owns IndexedDB): a `search` that took longer than a limit (say 200 ms) stores its answer under a key made of the moves, the targets text (with its options) and the start. A second IndexedDB store, `cases`, with a memory map in front and a cap (oldest dropped).
2. A stored case answers at once: its moves when they fit `maxDepth`, "No solution found!" when they don't (the stored answer is the shortest, so nothing shorter exists). A search that failed under a depth limit stores nothing.
3. `measure` gives a stored case's length as an exact distance, so the method search prunes those steps exactly.
4. `list` requests aren't remembered.
5. `knownAnswers` moves into this (one mechanism), keeping "already at the goal = no moves".
6. The reply says where the answer came from (table, search, remembered case); the page shows it in the status line and the runs table.

**Test:** every example method on the same scrambles twice: identical solutions, the second pass's slow steps near 0 ms. On fresh scrambles, the share of remembered cases per step. A reload keeps them (the file-backed fake IndexedDB of plan-engine 5c). The replay is unchanged with case tables off.

**Size:** medium, TypeScript only.

## Part 3 — Case sheets (the short ones)

**Why:** a remembered case still costs its first search. A sheet is every case of a step solved ahead of time, shipped as a small file and loaded into the case table the first time that step's goal comes up.

**Do:**
1. Engine helper `stepCases(method, index)`: the step's goal and what the earlier steps keep, worked out without a cube (as `gripGoals` and `laterGoals` do). Then every arrangement of the pieces the earlier steps don't pin, made per piece type from the kept roles
   (a kept `:o` piece keeps its twist, a kept `:p` piece its place), joined under the cube's parity and twist rules, masked by the step's goal, each start once. It says the count first and refuses past 100,000.
   First version: steps with one grip and one alternative.
2. `bench/sheet.ts`: solves every case of a step through the in-process worker (`CORES` for helpers), writes as it goes and can go on from where it stopped. It prints the count, how many answers of each length, and the time.
3. Sheets to make, every step up to 720 cases: the beginner method's four top steps, EPLL, L5EP, ELL, OLL, 6CO, PLL, CLL, COLL, CMLL, 6CP. Estimate from Part 1 before starting each (PLL: 288 searches, some of them a minute).
4. Loading: an index of sheet keys; when a request's moves + targets match one, the worker fetches that sheet into the case table. The app says where sheets are (an option of `runSearchWorker`, like `wasm` and `helper`); the demo ships them in `dist/web/sheets/` (`script/build.js`).

**Test:** every sheet answer replayed with `reachesGoal`; 20 random cases per sheet give the same length in a fresh search; the case counts against the table above; methods 0, 4, 5, 6, 10 and 13 on fresh scrambles with sheets: their last steps answer on the first run.

**Size:** medium. The solving runs in the background (minutes for most sheets, up to an hour or two for PLL and COLL).

## Part 4 — Room for hand-written tables in the Rust search (no behaviour change)

**Why:** the IDA* only reads `TableCore`. A hand-written table needs its own state (a few coordinates stepped by turn tables) behind the same calls, a way to be picked from the compiled goal, and the same life cycle as any table (build, store, load, progress).

**Do:**
1. `search/src/hand.rs`: what a hand-written table must offer: read a pattern into its state, step a state by a turn, a state's stored value (distance mod 3), its exact distance by walking down, bytes out and in, and whether it is exact for the whole goal.
2. `Slot` becomes "a generic table or a hand-written one"; the IDA* keeps a hand-written slot's coordinates per depth the way it keeps `(Units, u64)` now, with the same mod-3 bookkeeping.
3. A registry: given the closed targets and the turns, the hand-written tables whose goal this is, in whichever of the 24 rotations (`Rotations`). `SplitSearch` adds them next to its own views, so the bound is the larger of the two and never worse than today.
   When one is exact for the whole goal: `measure` is exact, `search` walks down, `list` deepens with no dead ends.
4. Worker: hand-written tables are built, stored and loaded like sub-tables (their own key, the same progress messages, counted in the memory budget), and helpers get their bytes.
5. The reply names the tables a search used (Part 2's field), so a goal that almost matches (an offset, a `:p`, another move) visibly falls back to generic speed.
6. The proof, as the first registered tables: flip × E-slice positions (1,013,760) and twist × E-slice positions (1,082,565) for the DR goal with face turns. They are the two tables the generic planner already builds for it, so the bound is the same.

**Test:** the DR step on 100 seeded scrambles: identical answers and node counts with the registry on and off; time per node both ways (what stepping by turn tables is worth against generic ranking, written into *Facts*). The replay is identical with the registry empty.

**Size:** medium-hard.

## Part 5 — The cube by hand

**Why:** phase 1 and phase 2 tables only fit in memory because of symmetry classes with mirrors, which the generic code can't express.

**Do:**
1. `search/src/hand/cube.rs`: the cube as pieces (8 corners with twists, 12 edges with flips), read from a pattern and written back in cubing.js's order; the 18 face turns; multiply and invert.
2. Coordinates with turn tables: twist (2,187), flip (2,048), E-slice positions (495), corner permutation (40,320), U/D-edge permutation (40,320), E-slice permutation (24).
3. The 16 symmetries that keep the U/D axis (quarter turns about it, a half turn about another axis, the left-right mirror) as cubes; conjugating a cube and a turn by one.
4. Symmetry classes: flip × slice → class + symmetry, with its turn table (64,430 × 18) and the twist's conjugation table (2,187 × 16); corner permutation → class + symmetry (2,768) with the U/D-edge conjugation table (40,320 × 16).
5. Nothing is registered in this part: it ends with tests.

**Test:** class counts 64,430 and 2,768. On 1,000 random walks, coordinates stepped by the tables equal coordinates read from the pattern cubing.js gives. A state and its 16 images land in one class. The class turn table equals "turn, then classify".

**Size:** hard; the classes are the fiddly part. Stop after item 2 with its tests passing if it runs long, and do 3–4 in a second chat.

## Part 6 — Phase 1 table

**Why:** the exact distance to domino reduction. It makes the DR step a walk down and lets the method search list every DR of a length without dead ends, which is what holds "DR, then finish" back today (plan-engine 8d).

**Do:**
1. The table: (flip-slice class, twist) → distance mod 3, 140,908,410 entries, 35.2 MB. Filled breadth-first from the solved class, forward then backward as `table/fill.rs` does; a class with symmetries of its own marks every image of the twist.
2. Registered for the DR goal with all 18 face turns. Check what the three axes' requests really look like (the engine holds the cube so the goal is as written, but a rotated EO goal is written differently, see plan-engine 8g) and match each.
3. `measure` exact, `search` a walk down, `list` and its pages with the exact bound.
4. Measure the build in wasm (aim: under 2 minutes, with progress) and the memory while it fills. If it's too slow for a first run, the table becomes a file to fetch (plan-engine 5d).
5. A sample, not wired in: the table read on all three axes as a bound for whole-cube goals (PLL, ZBLL, blindfolded flips), against the generic start bound on 40 states each. Expected to lose (see *What the first numbers say*); keep it only if the sample says otherwise.

**Test:** the DR step on 100 seeded scrambles: same lengths as the generic path. States per depth add up to 2,217,093,120, deepest 12. Every 12-move DR of one scramble: same answers as before, time against the ~9 s it takes now.
The method search on Two-phase (example 15), same seeds as 8d: time to reach 20 and 19 moves against 8d's numbers and `solveFull`.

**Size:** hard.

## Part 7 — Phase 2 tables (only if Part 6's numbers ask)

**Why:** once DR answers come for free, the method search on Two-phase spends its time in finishes (6–260 ms each on generic tables).

**Decide first:** from Part 6's last test, the share of the time spent in finishes. Under a third: tick this part as not needed.

**Do:**
1. Tables: corner-permutation class × U/D-edge permutation (111,605,760 entries, 27.9 MB), and corner permutation × E-slice permutation (967,680). The bound is the larger.
2. Registered for the whole cube with `U D R2 L2 F2 B2`, next to the generic views.
3. Budget: with Part 6 that is 63 MB of hand-written tables; say on the page when they are being built, and never build them for a method that doesn't ask.

**Test:** domino finishes on 100 DR states: same lengths (none over 18), nodes and time against the generic plan. The Two-phase method search against Part 6's numbers.

**Size:** medium once Parts 5 and 6 are in.

## Part 8 — Long sheets

**Why:** ZBLL has 7,776 starts and the whole last layer 62,208, each a search of up to a minute today. That is hours of solving, done once, for a file of a few hundred KB.

**Do:**
1. Rotation classes in the sheet tool: cases that are copies of each other under the rotations keeping the moves and the targets share one search, the answer renamed through the turn map (`Rotations`). With Part 5 done, the mirror too, and for whole-cube goals the inverse.
   A sheet answer is then a shortest answer, but maybe not the one a fresh search would pick first: say so in the README.
2. Estimate before each run: 30 random cases, then hours = classes × mean time. Write it down and start the run outside the chat; it goes on from where it stopped.
3. [x] ZBLL with face turns (CFOP with ZBLL). [ ] ZBLL and TTLL with `U R L` (ZZ, LEOR, ZZ-CT) if Part 1 shows them slow at all.
   Done 2026-10-18 another way: not solved by the engine but taken from a published alg database (`@moishy/algsets`, MIT, algs from SpeedCubeDB) by `bench/zbll-sheet.ts`,
   each alg checked on the cube. `src/engine/algs/zbll.ts` holds the 472 cases (1,896 algs, 86 KB) and the `ZBLL` alg set adds the 21 PLLs: `"algs": "ZBLL"` answers any
   last layer with its edges oriented, its algs ranked by speed. A goal that solves every edge and corner looks its algs up (`alg-step.ts`), so a ZBLL step takes about 3 ms;
   `node bench/out/alg-sets.js` checks every alg and all 7,776 states. Its answers are known algs, not shortest ones: the U R L steps (rank by moves) still search.
4. The whole last layer, if the estimate fits a night or two: one sheet then answers every last-layer step. For a step that keeps everything outside the top layer, any answer is itself a last-layer case,
   so the engine goes through the sheet's answers shortest first and takes the first that reaches the step's goal. Part 3's last-layer sheets (OLL, PLL, CLL, ELL, COLL, EPLL, top cross) are then no longer needed.

**Test:** lengths against fresh searches on 50 random cases per sheet; PLL lengths equal Part 3's; every answer replayed. The longest last-layer answer against the known maximum (believed 16 face turns; confirm before relying on it).

**Size:** medium to write; the runs take hours.

## Left for later (not planned)

- Sharper F2L bounds for the method search (a whole CFOP run proven shortest): no table of a size a browser can hold sees four pairs together (plan-engine 8e).
- A whole-cube optimal solver ("Full cube" keeps cubing.js's two-phase).
- Methods left out of the examples: M2 blindfolded (its parity is a slice turn, which parity pieces can't say), and the less common ones (PCMS, Belt, SSC, ECE, Tripod, the Francisco methods, APB, Nautilus, 8355): each is expressible, none adds a new kind of goal.
- The repeated-step rule (see *Facts*): a round of 0 moves that still added a piece should go on to the next round.
- plan-engine's 5d (table files) and 8h (parallel table builds).
