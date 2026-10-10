# puzzly — more puzzles (context for new chats)

Start a new chat with: "Read plan.md, then do Part N." Do **one part per chat**, then tick it below and commit.

The earlier roadmap (the 3x3x3 engine and its search, Parts 1–9) is now `plan-engine.md`, unchanged. Three of its items are still open (5d table files, 8h parallel table builds, 9 hand-written tables).
To go on with it: "Read plan-engine.md, then do Part N." Its *Facts* section is still the reference for how the search works.

## Progress

- [ ] Part 1 — Puzzle description: everything 3x3x3-only behind one object (no behaviour change)
- [ ] Part 2 — Grips without centers + 2x2x2
- [ ] Part 3 — Test bench built from the puzzle description + `puzzle` in method files
- [ ] Part 4 — Pyraminx and Skewb
- [ ] Part 5 — Megaminx and Kilominx
- [ ] Part 6 — 4x4x4 (identical pieces, wings, inner slices)
- [ ] Part 7 — 5x5x5 to 7x7x7
- [ ] Part 8 — FTO and the other geometry puzzles (derived names and grips)
- [ ] Part 9 — Custom puzzles from a puzzle-geometry description (shape + cuts)
- [ ] Part 10 — Custom puzzles from a KPuzzle definition (JSON)
- [ ] Part 11a — Square-1 in the engine: bonded pieces, legal moves, notation
- [ ] Part 11b — Square-1 in the Rust search
- [ ] Part 12 — Clock

**Order:** 1 → 2 → 3 are the base and must go in that order. After 3, Parts 4–7 don't depend on each other (6 before 7). 8 gives the generic naming that 9 and 10 need. 11 and 12 can come any time after 3.
**How hard:** 1 hard · 2, 3, 4 medium · 5 medium-hard · 6 hard · 7, 8, 9, 10 medium · 11 hard (two chats, maybe three) · 12 medium-hard. About 14 chats in all.

## Goal

The same engine for any twisty puzzle: a user picks a puzzle (or enters their own) and sets up steps and methods with plain inputs, exactly as on the 3x3x3 today.

**A puzzle is data, like a step is data.** The engine never knows a puzzle by name: no `if (puzzle.id === "square1")` anywhere. Whatever makes a puzzle different (its piece names, its rotations,
pieces that are glued together, moves that commute) is a field of its description, so a puzzle typed in by a user gets the same treatment as a built-in one.

Rules for every part:
- 3x3x3 answers never change: `npm run check` (added in Part 1) must print the same lines before and after.
- Each new puzzle is checked on seeded scrambles: every answer replayed by `reachesGoal`, and compared with a known number where one exists (see each part's **Test**).
- Say how long the part will take before starting, test what the part asks, then stop (no extra benchmarks).
- When a part is done: tick it, add what was found to *Facts*, update the README.

## Current state (2026-10-10)

- Branch `modularize`, **not committed yet**: the code was split into `src/engine/` (the reusable engine), `src/demo/` (the test bench) and Rust submodules, with identical answers.
  **Commit it before Part 1**, so each part has a clean before and after. The state before the split is saved as `refs/backup/pre-modularize`.
- Layout: README, *Folder layout*. How an app uses the engine: README, *Using the engine in another app* (`loadEngine({ searchWorker })`, `runSearchWorker({ wasm, helper })`, `runSearchHelper({ wasm })`).
- cubing.js **0.63.8**, twips 0.12.3 (Rust crate). One search worker, tables in IndexedDB, helper workers for long searches.

## Facts worth knowing (checked 2026-10-10, save re-checking)

### What is 3x3x3-only today

| Where | What |
| --- | --- |
| `core/cube.ts` | `PIECE_NAMES`, `ORBIT_BY_LENGTH` (1 letter = center, 2 = edge, 3 = corner), `BOTTOM_TURNS`, `FRONT_TURNS`, `ALL_GRIPS` (24, from x y z), `normalizeName` (sorts a name's letters) |
| `core/moves.ts` | `FACE_MOVES`, `ROTATIONS` = x y z (used by `countMoves` and `rotationsIn`) |
| `core/puzzle.ts` | `cube3x3x3.kpuzzle()`; the grip is judged by where the `CENTERS` are (`gripByCenters`, `centerLayout`, `netRotation`); `randomScrambleForEvent("333")` |
| `core/turns.ts` | `TURN_FAMILIES` (U R F D L B M E S Uw…); `turnName` / `distinctTurns` think in quarter and half turns |
| `goal/goal.ts` | `parseGoalText` picks the piece type from the name's length; "no center typed = all six kept" (`allCenters`, `goalFromText`, `goalToText`) |
| `goal/targets.ts` | `centersReachable` reads `CENTERS`; relative groups are placed by the 24 grips |
| `goal/untouched.ts`, `goal/bld.ts`, `goal/grips.ts`, `goal/targets.ts` | "the solved cube holds piece n on spot n" (`placedPatterns`, `untouchedWanted`, `traceWanted`, `relabel`, `goalOnCube`, `rotateGoal`): wrong when a piece type has identical pieces |
| `step/step.ts`, `step/check.ts` | `solveFull` and the full-cube check call cubing.js's 3x3x3 functions |
| `method/config.ts` | bottom faces must be U D F B R L; default moves are the six face turns |
| `src/demo/` | three chip boxes, bottom-face boxes, move boxes, presets and quick picks written in `page/index.html`; `TwistyPlayer({ puzzle: "3x3x3" })` in `viewer.ts`; the example methods |

Things that would break quietly with a second puzzle (Part 1 fixes them):
- **No puzzle in any table key.** The worker keeps solvers and tables by `moves/targets` (`worker/solvers.ts`, `tableKey`), IndexedDB by `format/moves/targets`, the helper pool by the same keys.
  Two puzzles with the same piece-type names and move names (4x4x4 and 6x6x6 corners, two custom puzzles) would read each other's tables.
- Caches that are never emptied: `puzzleJson` in `worker/client.ts` (made once), `knownAnswers` in `step/combo.ts`, `offsetGroupsMade` in `goal/offsets.ts`. The lookup caches of `core/cache.ts` are emptied on load already.

### The Rust search

- It works from the puzzle definition it is sent as JSON; no piece-type names in the code.
- Limits: 64 moving spots per piece type (`MAX_SPOTS`), 64 tracked pieces per part (`MAX_UNITS`), 16 piece types (`MAX_ORBITS`), piece ids and twists in a `u8`.
- `symmetry.rs` builds the rotation group from the moves named `x` and `y` only, at most 48 rotations (`MAX_ROTATIONS`). On a puzzle whose rotations have other names it finds only "no rotation":
  answers stay right, but rotated copies of a sub-goal no longer share one table.
- It assumes **every move can be made in every state** (wrong for Square-1) and searches move by move (wasteful for Clock, where order never matters).
- twips (the fallback when no table fits) is generic too, with the same two assumptions.

### cubing.js's puzzles (0.63.8)

Piece types are written `NAME count×twists`. *Frame* = pieces that never change place relative to each other, so they say how the puzzle is held (the 3x3x3's centers).

| Puzzle id | Piece types | Notes |
| --- | --- | --- |
| `3x3x3` | EDGES 12×2, CORNERS 8×3, CENTERS 6×4 | frame: CENTERS; rotations x y z |
| `2x2x2` | CORNERS 8×3 | **no frame**; moves U x y, the rest derived |
| `4x4x4` | CORNERS 8×3, EDGES 24×2, CENTERS 24×1 | **CENTERS are identical pieces** (4 per face share an id); no frame; inner slices `2R`, wide `Rw` |
| `5x5x5` | EDGES 24×2, EDGES2 12×2, CORNERS 8×3, CENTERS 24×1, CENTERS2 24×1, CENTERS3 6×4 | frame: CENTERS3 |
| `6x6x6` | CORNERS, 2 edge types of 24, 4 center types of 24 | no frame |
| `7x7x7` | 11 piece types | frame: CENTERS6 (6×4) |
| `40x40x40` | far more than 16 piece types | over the Rust limit: not offered |
| `pyraminx` | EDGES 6×2, CORNERS 4×3, CORNERS2 4×3 | CORNERS are the middle pieces (they only twist: the frame), CORNERS2 the tips; 12 rotations |
| `skewb` | CORNERS 8×3, CENTERS 6×4 | centers move: no frame |
| `megaminx` | CORNERS 20×3, EDGES 30×2, CENTERS 12×5 | frame: CENTERS; 60 rotations; face turns have 5 positions |
| `kilominx` | EDGES 30×2, EDGES2 30×2, CORNERS 20×3, CENTERS 12×5 | more piece types than a Kilominx has: find out what this definition is before promising it |
| `fto` | C4RNER 6×4, CENTERS 24×1 (identical), EDGES 12×2 | 24 rotations (octahedron) |
| `baby_fto`, `master_tetraminx`, `gigaminx`, `redi_cube` | — | gigaminx has piece types of 60 (limit 64) |
| `melindas2x2x2x2`, `loopover`, `tri_quad` | CORNERS 64×1 / SQUARES 25×3 / six small types | no faces or rotations in the usual sense |
| `square1` | WEDGES 24×9, EQUATOR 2×6 | see below |
| `clock` | DIALS 18×12, FACES 18×1, FRAME 1×2, HOUR_MARKS 18×4 | see below |

- **Rotation names.** Definitions made by puzzle geometry (everything but 3x3x3, 2x2x2, redi cube, Square-1, Clock and the last three) name whole-puzzle rotations `<face>v`: `Uv`, `Fv`, and on the megaminx also `U_F_Rv`, `U_Fv`… (31 of them).
  Cubes also take `x y z`; megaminx and pyraminx take `y`; Square-1 has none; Clock has `y2`, `z`, `x2`.
- **Moves.** The same definitions use puzzle-geometry move names (pyraminx `r 2r BL rv …`, skewb `D U Dv L UR …`), but the usual names parse too (`R` on both). Check per puzzle which names to show.
- **Solvers in `cubing/search`:** `experimentalSolve2x2x2`, `experimentalSolve3x3x3IgnoringCenters`, `solveSkewb`, `solvePyraminx`, `solveMegaminx`, and the generic `experimentalSolveTwips`. Nothing for 4x4x4 and up, Square-1 or Clock.
- **`cubing/puzzle-geometry`:** `getPuzzleGeometryByDesc`, `getPuzzleGeometryByName`, `getPG3DNamedPuzzles`, `parsePuzzleDescription`, `getPuzzleDescriptionString`, `EXPERIMENTAL_PUZZLE_BASE_SHAPES`, `EXPERIMENTAL_PUZZLE_CUT_TYPES`, `PuzzleGeometry`.
- **Square-1.** 24 wedge slots (0–11 top, 12–23 bottom); a corner is two neighbouring wedges, an edge is one. `U_SQ_` cycles the top 12 slots, `D_SQ_` the bottom 12, `_SLASH_` swaps slots 6–11 with 12–17 and turns half the equator.
  Alg text `(1, 0) / (3, -3) /` parses (to `U_SQ_ D_SQ_0 / U_SQ_3 D_SQ_3' /`). **The definition makes a slash even when it cuts a corner in two** (`(1, 0) /` on the solved puzzle gives a pattern, not an error),
  so which moves are legal is not in the definition: the engine has to know it.
- **Clock.** 18 dials (9 front, 9 back); a dial's twist is its hour. No pin move ever moves a dial, it only turns some (front +1, the back corners −1); `y2` turns the puzzle over, `z` turns it in place.
  All pin moves commute and come back after 12. Alg text `UR3+ DR2- ALL1+ y2 U4+` parses. The whole clock has 12^14 ≈ 1.3 × 10^15 states.

Not checked yet (do it in the part that needs it): that `TwistyPlayer` shows a custom puzzle from a description (`experimentalPuzzleDescription`), what it shows for Clock, and the exact puzzle-geometry call that gives a KPuzzle definition.

## Part 1 — Puzzle description (no behaviour change)

**Why:** everything else builds on this. Today the 3x3x3 is spread over about ten files as constants (see *Facts*); after this part it is one object, and a second puzzle is a second object.

**Do:**
1. **The check first, before touching the engine.** Add `bench/check.ts` and `npm run check`: a fixed list of scenarios on seeded scrambles, one printed line per result, plus a hash of every request the engine sent the worker.
   Scenarios (the list used to check the split into modules): the text helpers with their error messages; steps on two scrambles (cross, pseudo-cross in any grip, cross or XCross, XXCross, a relative pair, EO,
   a Roux block with M, the CP line solvable with R U, an untouched 3-cycle, a buffer step, a max depth that fails, first-found, a step after `done` with kept pieces); `stepCandidates`; every example method;
   `searchMethod` on a two-step method it can finish. Save its output as the baseline (66 lines, about 20 s).
2. `src/engine/puzzle/spec.ts`: the `PuzzleSpec` type. Fields: `id`, `name`; how to load the definition; piece names per type and the lookup from a typed name; the `frame` piece type (or none);
   faces, default moves, extra moves (slices, wide); rotation moves and the grips they give (with which face each grip puts on the bottom); scramble; full solver (optional); what the 3D viewer needs.
3. `src/engine/puzzle/cube3.ts`: the 3x3x3's description with exactly today's values (same names, same 24 grips in the same order, centers as the frame, `333` scrambles, cubing.js's solver).
4. `loadEngine({ puzzle, searchWorker })` (`puzzle` left out = the 3x3x3). One puzzle is active at a time; loading another empties every cache (the three in *Facts* too).
5. Replace each constant in the *Facts* table with a read from the active puzzle. The engine's exports stay usable by the test bench (which Part 3 rebuilds).
6. A puzzle id (a hash of the definition) in every table key: `tableKey`, the IndexedDB key, the helper pool's keys. Stored tables from before get new keys, so they are built once more.

**Test:** `npm run check` prints the baseline again (compare the request hash with the new puzzle field left out); `npm run build`; the page by hand (solve, run a method, method search, edit a step).
Rust untouched in this part.

**Size:** hard, one long chat. If it runs long, stop after item 5 and do item 6 in the next chat.

## Part 2 — Grips without centers + 2x2x2

**Why:** the engine reads the grip from where the centers are. The 2x2x2 has only corners, and so do several later puzzles (4x4x4, 6x6x6, Skewb).

**Do:**
1. The grip rule becomes a field of the description. With a `frame`: as today (the scramble is judged by its frame pieces, after that only rotation moves change the grip).
   Without one: the puzzle is taken as held, and only the rotation moves in the scramble and in *Done so far* change the grip. A user who wants "in any orientation" ticks every bottom face and *any front*, as today.
2. "No center typed = all six kept" becomes "no frame piece typed = the frame is kept"; nothing is added on a puzzle without a frame.
3. The whole-puzzle check without cubing.js's 3x3x3 function: solved in some grip of the puzzle.
4. `src/engine/puzzle/cube2.ts`: corner names as on the 3x3x3, moves R U F by default (L D B allowed), rotations x y z, no frame, `222` scrambles, `experimentalSolve2x2x2`.
5. Page: only a puzzle picker with the two puzzles, and whatever must change for the 2x2x2 to be usable (Part 3 does the rest).

**Test:** `npm run check` unchanged. 2x2x2 on 20 seeded scrambles: "all corners" with R U F (3,674,160 states: one exact table) never needs more than 11 moves and is never longer than cubing.js's answer;
a layer, a face, and an orient-everything step; every answer replayed by `reachesGoal`.

**Size:** medium.

## Part 3 — Test bench built from the puzzle description + `puzzle` in method files

**Why:** the page is still written for the cube (see *Facts*). After this part a new puzzle needs no page code.

**Do:**
1. Chips made from the puzzle's piece types (any number of types, long lists scroll); move boxes from its moves (the "half turn only" row only for moves that have one);
   bottom-face boxes from its faces, with *any front*; the viewer's puzzle and mask from the description.
2. Presets and quick picks out of `index.html` into data per puzzle (`src/demo/presets.json`): goal presets, offsets picks (AUF / ADF become "turns of the top / bottom face"), solvable-with picks, move picks, BLD picks.
3. Method files get `"puzzle": "2x2x2"` (left out = `3x3x3`, so every existing file still loads). `readMethod` checks a method against its own puzzle. Saved and example methods are listed for the picked puzzle.
4. Example methods for the 2x2x2 (layer then the rest; face, orient, permute both layers).
5. Switching puzzle on the page: keeps the runs table per puzzle, asks before dropping an unsaved method.

**Test:** the 3x3x3 page behaves as before (solve, alternatives, offsets, BLD fields, method run, method search, save / export / import); the 2x2x2 end to end; an old method file without `puzzle` loads.

**Size:** medium, almost all page code.

## Part 4 — Pyraminx and Skewb

**Why:** the first puzzles that aren't cubes inside: 12 rotations instead of 24 on the Pyraminx, turns with 3 positions, tips, and on the Skewb centers that move.

**Do:**
1. Grips worked out from the description's rotation moves instead of the `BOTTOM_TURNS` / `FRONT_TURNS` tables: every rotation they generate, each with its shortest name, grouped as "bottom face × front"
   (which face a rotation puts on the bottom is found by rotating the face turns, as `symmetry.rs` does). The 3x3x3 keeps its 24 grips, same names, same order.
2. Rust `Rotations::new`: the rotation moves come with the request instead of the fixed `x` and `y`; `MAX_ROTATIONS` 48 → 120 (the megaminx needs 60).
3. Turns with 3 positions: `turnName`, `distinctTurns`, `moveInGrip`, offset groups and the page's move boxes stop assuming quarter and half turns.
4. `pyraminx.ts`: frame = the middle pieces (CORNERS), tips as their own pieces (lower-case moves `u l r b`); `skewb.ts`: no frame. Piece names written by hand for these two.
5. Scrambles `pyram` and `skewb`; full solvers `solvePyraminx`, `solveSkewb`.

**Test:** `npm run check` unchanged, and the replay benchmark gives the same answers and node counts (item 2 touches the Rust side). 20 seeded scrambles each: the whole puzzle through the engine's own tables
(Pyraminx without tips 933,120 states, Skewb 3,149,280) never needs more than 11 moves; a first-layer step on each; every answer replayed.

**Size:** medium.

## Part 5 — Megaminx and Kilominx

**Why:** the big rotation group (60) and the first puzzle where table sizes and search width hurt: 12 faces × 4 turns each, about 44 choices per move instead of 15.

**Do:**
1. 60 grips as 12 bottoms × 5 fronts; the page's bottom-face picker with 12 faces.
2. Face names of two letters (`BL`, `DR`…): piece names joined with `_` (`U_F_R`), the way cubing.js writes its own corner rotations. Turns with 5 positions (`U`, `U2`, `U2'`, `U'`) in `turnName` and the move boxes.
3. Scrambles (`minx`; check that its `R++ D--` text parses into moves the definition takes), `solveMegaminx` as the full solver.
4. Measure before promising: a star (5 edges, about 547M states: split tables), an F2L-style pair, a last-layer step. Write time, memory and table sizes into *Facts*, and say on the page when a step is too deep to finish.
5. Kilominx only once it's clear what cubing.js's `kilominx` definition is (see *Facts*).

**Test:** `npm run check` unchanged. Megaminx on 5 seeded scrambles: the star and two pair steps, replayed by `reachesGoal`; the numbers from item 4.

**Size:** medium-hard; the code is small, the measuring isn't.

## Part 6 — 4x4x4

**Why:** the first puzzle with **identical pieces** (four centers per face share one id), which breaks the engine's "piece n lives on spot n" (see *Facts*), and the first with inner slices.

**Do:**
1. Goals name **spots**, and a spot's wanted piece comes from the solved pattern. Go through `placedPatterns`, `untouchedWanted`, `traceWanted`, `relabel`, `goalOnCube`, `rotateGoal`, `maskPattern` and `estimate`.
   On identical pieces "solved" means "a piece of the right kind is here"; roles that need single pieces (BLD buffers, `:r` groups) refuse them with a message.
2. Names in the usual big-cube way: wings `UFr` (two faces, then the side it leans to), centers `Ufr`. Inner slices `2R` and wide moves `Rw` on the page.
3. `cube4.ts`: no frame, `444` scrambles (check how long cubing.js takes to make one), no full solver.
4. Rust: check a piece type of 24 in six classes of four, and 24 + 24 + 8 tracked pieces against `MAX_UNITS` 64.
5. Steps to measure: one center, two opposite centers, all centers (24! / 4!^6 ≈ 3 × 10^15 arrangements: split by face), two wings joined (`UFr:r UFl:r`), a 3x3x3 stage with outer and wide moves.

**Test:** `npm run check` unchanged (item 1 is the risk). 5 seeded scrambles: one center, two centers, a joined wing pair, each replayed by `reachesGoal`; numbers into *Facts*. Not a full solve.

**Size:** hard. If it runs long, stop after item 2 (with the check passing) and finish in a second chat.

## Part 7 — 5x5x5 to 7x7x7

**Why:** more of Part 6: more piece types (11 on the 7x7x7, limit 16), more slices. 5x5x5 and 7x7x7 have a center frame again; 6x6x6 doesn't.

**Do:**
1. The Part 6 names for every piece type of bigger cubes (midges `UF`, wings by depth, `Uf` and `Ufr` centers, obliques), made by rule from the slices that move each piece, not written by hand.
2. Move boxes for many slices (`3R`, `3Rw`) without filling the page.
3. `cube5.ts`, `cube6.ts`, `cube7.ts`; scrambles `555`, `666`, `777`. The `40x40x40` is left out (over the limit) with a line saying why.
4. Memory: check the worker's budget with many small tables per step.

**Test:** `npm run check` unchanged. Per size, 3 seeded scrambles: a center step and a joined-wings step, replayed; numbers into *Facts*.

**Size:** medium once Part 6 is in.

## Part 8 — FTO and the other geometry puzzles

**Why:** everything left in cubing.js's list, and the generic naming that custom puzzles (Parts 9 and 10) need: after this part a puzzle needs no hand-written names or grips.

**Do:**
1. **Derived names.** A piece's name = the faces whose outer turn moves or twists it (in the puzzle's face order); if two pieces share that, the inner slices that move it, in lower case; if still shared, `#n`.
   It must give today's names on the 3x3x3 and Part 6 / 7's names on big cubes. `TYPE#n` (`EDGES#5`) is always accepted in goal text, on every puzzle.
2. **Derived grips** from whatever rotation moves a definition has; none = one grip, and the page hides the bottom-face boxes.
3. Descriptions with derived values for `fto`, `baby_fto`, `master_tetraminx`, `gigaminx`, `redi_cube`; `melindas2x2x2x2`, `loopover` and `tri_quad` get `TYPE#n` names and one grip.
4. A filter box over the chips (the gigaminx has 60 of a kind).

**Test:** `npm run check` unchanged with the 3x3x3's names derived instead of written. Per puzzle, 5 scrambles (cubing.js's where it has one, random moves otherwise) and one small step, replayed.
Write per puzzle what works, what is slow and what is refused into *Facts*. A puzzle that needs more than this (gigaminx speed, Melinda's) gets its own chat.

**Size:** medium.

## Part 9 — Custom puzzles from a puzzle-geometry description

**Why:** the easy way for a user to enter their own puzzle: a shape and its cuts, the text cubing.js's puzzle geometry reads (a base shape, then cuts by type and depth: the 3x3x3 is `c f 0.333333333333333`).
cubing.js turns it into a definition, and should draw it too (to check, see *Facts*).

**Do:**
1. Engine: `customPuzzle({ name, description })` gives a `PuzzleSpec`: definition from puzzle geometry, names and grips derived (Part 8), default moves = the outer face turns,
   scrambles = random moves (length is an option; there is no random-state scrambler for an unknown puzzle), no full solver.
2. Limits checked before anything is built, with plain messages: at most 16 piece types, 64 moving pieces per type, twists that fit a byte. A warning for big puzzles ("only small steps will be fast").
3. Page, a *Custom puzzle* panel: start from one of puzzle geometry's named puzzles (`getPG3DNamedPuzzles`) or build one (base shape, a list of cuts with type and depth), with a live 3D preview and a name.
   *Save* keeps it in this browser (`puzzly.puzzles`); *Export file* / *Import file* as JSON `{ name, description }`.
4. Method files: `puzzle` is a built-in id, or `{ name, description }` inside the file, so an exported method carries its puzzle.
5. Table keys already carry the definition's hash (Part 1): a custom puzzle's tables are stored like any other, and changing a cut gives a new id.

**Test:** the 3x3x3 entered as a description gives the same move counts as the built-in one on the check's step scenarios; two unusual puzzles (a corner-turning cube, one of the named list) with a small step each, replayed;
a description that can't be read and one over a limit each stop with a message.

**Size:** medium; the engine side is small after Part 8, the panel is most of it.

## Part 10 — Custom puzzles from a KPuzzle definition (JSON)

**Why:** for puzzles puzzle geometry can't describe: the user gives the definition itself (piece types, the solved pattern, each move as a permutation with twists).
It is what the engine and the Rust search already work from.

**Do:**
1. `customPuzzle({ name, definition, rotations?, pieceNames?, bonds? })`. With only a definition: names `TYPE#n`, default moves = every move not listed as a rotation, one grip unless rotations are listed, no frame.
2. Checks with plain messages: the JSON's shape, every permutation really is one, lengths match the piece counts, twists in range, each move comes back after a bounded number of turns, the Part 9 limits.
3. Page: a paste box and a file input in the *Custom puzzle* panel; optional fields for piece names and for which moves are rotations.
   No 3D picture for these: a table of each piece type's spots (what sits where, goal pieces marked) stands in for the cube.
4. Saved, exported and carried inside method files like Part 9's (`{ name, definition, … }`).
5. README, *Using the engine in another app*: custom puzzles from code.

**Test:** the 3x3x3's own definition exported and loaded back as a custom puzzle gives the check's move counts (names mapped to `TYPE#n`); a tiny hand-written puzzle (three pieces, two moves) whose distances are known by hand;
one broken definition per check in item 2.

**Size:** medium.

## Part 11 — Square-1 (two chats)

**Why it's hard:** the search assumes every move can be made in every state, and on the Square-1 a slash is only possible when no corner sits across the cut. The definition doesn't say so (see *Facts*),
and a masked start hides which wedges are the two halves of one corner. twips has the same blind spot, so it can't be the fallback here.

### Part 11a — In the engine

**Do:**
1. Two new fields of a puzzle description, usable by any bandaged puzzle (and by Part 10's custom ones): **bonds** (pairs of pieces that are one physical piece: the two wedges of each corner)
   and, per move, the **cuts** it makes (pairs of neighbouring spots it separates). A move is legal in a state when no cut separates a bonded pair.
2. Pieces the user names: 8 corners and 8 edges, each standing for its wedge or wedges; a role on a corner applies to both.
3. Masks keep the shape: wedges the goal ignores are hidden as "corner, first half / corner, second half / edge" (three shared ids instead of one), so legality can be read from any masked state.
   A shape-only goal (cube shape) is then every wedge in its shape group.
4. Legality on the TypeScript side: `reachesGoal` replays an answer and fails on an illegal move; the walks that try moves (solvable-with, reachable targets) skip illegal ones.
5. Notation `(x, y) /` in and out; one grip (no rotations). Decide what one move is and write it down here: the usual choice for shortest Square-1 answers is to count slashes (twist metric).
6. `square1.ts` with `sq1` scrambles; goal presets: cube shape, each layer's pieces in their layer, corners, edges.

**Test:** `npm run check` unchanged. Goal checks by hand on known algs (a parity alg, a cube-shape alg): `reachesGoal` true on legal ones, false when a slash is made illegal. No searches yet.

### Part 11b — In the Rust search

**Do:**
1. Requests carry the bonds and cuts. A turn is `(x, y)` followed by a slash; the table fill (`table/fill.rs`) and the IDA* run (`split/ida.rs`) skip turns that aren't legal in the state they start from.
   (Filling goes backward from the targets: a slash is its own inverse and is legal before exactly when it is legal after, layer turns are always legal, so backward and forward agree.)
2. Sub-tables: keeping the shape groups in every sub-table makes them exact about legality but bigger; leaving legality out keeps them small and still a lower bound. Measure both on cube shape and two more steps, keep the better.
3. Check the numbering: 24 wedges in one piece type, where two halves never part. If the tables come out far bigger than the states that exist, number bonded pieces as one.
4. No twips fallback for a puzzle with bonds: a goal too big for tables stops with a message.

**Test:** cube shape from 20 seeded scrambles, every answer replayed legally; compare the longest with the known maximum for cube shape (7 slashes, to confirm on Jaap's Square-1 page before relying on it).
Then a whole method as an example (cube shape, layers, corners, edges) as far as speed allows; numbers into *Facts*.

**Size:** hard: 11a and 11b one chat each, a third for speed if the numbers ask for it.

## Part 12 — Clock

**Why it's different:** nothing ever changes place, dials only turn, and all pin moves commute. It still fits "pieces with twists", so small goals can use today's tables,
but searching move by move is hopeless for the whole clock: about 330 turns to choose from (each pin move × 11 amounts), and their order never matters.

**Do:**
1. `clock.ts`: the 18 dials as pieces, named by side and place (front `UL U UR L C R DL D DR`, back the same with a prefix); "solved" = pointing at 12, the other roles are refused with a message.
   Grips = front or back up × four turns (`y2`, `x2`, `z`). Moves written as cubing.js does (`UR3+`, `ALL2-`); one move = one pin move of any amount, turning the clock over doesn't count.
2. Try the generic path first: a goal of a few dials (the front cross, 5 dials = 248,832 states) is one exact table. Confirm the tables and the turn list cope with moves that come back after 12.
3. For goals too big for a table: a small solver that uses what the Clock is. An answer is a set of pin moves with amounts; the hours are sums mod 12, so for a chosen set the amounts follow from arithmetic.
   Try sets fewest moves first. In Rust, next to `DistanceTable`, with the same calls (measure, search, list).
   **The worker picks it from the definition, not from the puzzle's name:** every allowed move commutes with every other and none moves a piece. A custom puzzle like that gets it too.
4. Page: dial chips as two 3×3 grids; check what the viewer shows for Clock (see *Facts*).

**Test:** `npm run check` unchanged. 20 seeded `clock` scrambles: the whole clock solved and replayed by `reachesGoal`, never longer than the scramble itself, and within the known maximum (12 moves, to confirm before relying on it).
On small goals both ways (table and arithmetic) give the same length.

**Size:** medium-hard, one or two chats.

## Left for later (not planned)

- Two puzzles loaded at the same time (engine instances instead of one active puzzle).
- Random-state scrambles for custom puzzles.
- Nicer hand-written names for the puzzles that get derived ones.
- Anything from `plan-engine.md` that is still open.
