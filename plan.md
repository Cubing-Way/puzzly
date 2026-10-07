# puzzly — engine roadmap (context for new chats)

Start a new chat with: "Read PLAN.md, then do Part N." Do **one part per chat**, then tick it below and commit.

## Progress

- [x] Part 1 — Groups + centers
- [x] Part 2 — Offsets
- [x] Part 3 — Methods (step list) + keep previous
- [x] Part 4 — Alternatives
- [ ] Part 5 — Pruning tables (speed: own search + cached distance tables)
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

- Search: `experimentalSolveTwips(kpuzzle, pattern, { targetPattern: KPattern, generatorMoves, minDepth, maxDepth })`.
  Throws `"No solution found!"` when nothing fits `maxDepth`. Duplicate piece ids + `orientationMod` work in twips.
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
- Twips `maxDepth` is **exclusive** (it only finds answers shorter than `maxDepth`), so `solveStep` passes `maxDepth + 1`. Twips throws a plain string (`"No solution found!"`); `solveStep` wraps it in an `Error`.
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

## Part 5 — Pruning tables (speed)

**Why:** heavy steps are slow: the OLL step takes ~6 s with bottom D (~30 s with any front, 4 grips), a whole-cube PLL step takes minutes, pseudo-slotting ~10 s in Node.
Each twips search runs in a fresh worker that is terminated afterwards (log: "Search ended, terminating dedicated `twips` worker"), so whatever it builds is thrown away every search
(~200 ms start-up even for easy goals), and search time grows ~10× per extra move.

**Do:**
- Own search in a new `src/search.ts`: IDA* on a compact state holding only the goal's pieces (spot + twist per tracked piece, group members interchangeable), move lookups per orbit like `pieceMoves`,
  and the usual move pruning (no same face twice, opposite faces in one fixed order). Same contract as twips (shortest answer within `maxDepth`), so `solveStep`'s grips × offsets loop, depth tightening and skips stay.
- Distance tables in `src/tables.ts`: breadth-first from **every accepted target at once** (all the step's offsets), so one table covers all offsets and one search can accept any offset
  (fewer searches than grips × offsets; find the winning offset afterwards). Store as `Uint8Array` (or 4-bit packed); index = rank of the tracked pieces' spots (+ twists).
- Cache tables by (pieces with roles, allowed moves, offsets), so they're shared across grips, scrambles, steps and method runs.
  Exact table when it fits (cross: 12·11·10·9 spots × 2⁴ twists = 190,080 states); bigger goals use several smaller tables over parts of the goal, h = max of them
  (cross + pair → "cross + pair edge", 5 edges ≈ 3.0M, and "cross + pair corner" ≈ 4.6M). With keep, the merged goal differs per grip and per run,
  so cover goals with reusable sub-tables (cross edges, each pair, last-layer pieces…) instead of one table per whole goal.
- Build tables in a Web Worker so the page stays responsive; the status shows "Building tables…" the first time. Later: save them in IndexedDB.
- Start with face turns and solve / place / ignored roles; keep twips as the fallback for anything not covered yet (slice moves that move centers, group roles), then widen.
- Whole-cube goals (PLL with keep): Korf-style tables (corners 8!·3⁷ ≈ 88M states ≈ 44 MB at 4 bits, plus edge tables) are heavy for a browser.
  Decide in that chat: build them once and store in IndexedDB, or offer a fast non-shortest option for whole-cube steps (`solveFull`, two-phase). Until then, split PLL into corners, then edges.
- cubing.js's Kociemba (min2phase) tables don't help masked goals: they measure distance to DR / solved over every piece. They only fit whole-cube steps (via `solveFull`) and a DR step,
  and they're internal to cubing.js's solver worker (reusing them means copying that code).
- Part 6 (several answers per search) and Part 7 (IDA* with a check function) reuse this search.

**Test:** same move counts as twips (both are shortest) on cross, XCross, XXCross (cross + 2 pairs), pseudo pairs with ADF, first layer, EOLine, and the CFOP + OLL method.
Benchmark heavy goals, not only cross / EO (light goals are dominated by start-up time). Report table build time, memory and solve time before / after.

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
- Cost ≈ candidates × the next steps' time, so it needs Part 5's speed. Twips returns one answer per search; listing several answers per grip × offset needs Part 5's own search (IDA* can keep going after the first hit).
- Results show, per step, how many candidates were compared and the total they were judged by; the step editor gets a lookahead field.
- Still no method code: lookahead is a generic search setting.

**Test:** with lookahead 1, step 1 + step 2 is never longer than greedy's step 1 + step 2 (same scramble); on the scramble above and several random ones, the pseudo-slotting example
ends some pair steps with a D offset and is at most as long as greedy overall in most runs (report the numbers); old method JSON without `lookahead` gives the same results as before.

## Part 7 — Named whole-state checks (later, one per chat)

**Why:** some goals aren't a pattern at all, so config can't express them:
- 2GR / ZZ-CT "CP solved" (corners solvable with only R and U), "solvable with M and U only", BLD parity.
- Pieces solved relative to each other anywhere (F2L pair joined anywhere, FMC pseudo-blocks).

**Do:** each becomes a built-in named check a user can tick in a step. Twips takes one target pattern, so each check needs its own search (IDA* with a check function) or a precomputed table. Still no method code: these are new building blocks, not methods.