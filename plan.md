# puzzly — engine roadmap (context for new chats)

Start a new chat with: "Read PLAN.md, then do Part N." Do **one part per chat**, then tick it below and commit.

## Progress

- [x] Part 1 — Groups + centers
- [ ] Part 2 — Offsets
- [ ] Part 3 — Methods (step list) + keep previous
- [ ] Part 4 — Alternatives
- [ ] Part 5 — Named whole-state checks (later, one check per chat)

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
  "Bottom face" checkboxes + "any front (y turns)"; status says "best of N grips".

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

## Part 5 — Named whole-state checks (later, one per chat)

**Why:** some goals aren't a pattern at all, so config can't express them:
- 2GR / ZZ-CT "CP solved" (corners solvable with only R and U), "solvable with M and U only", BLD parity.
- Pieces solved relative to each other anywhere (F2L pair joined anywhere, FMC pseudo-blocks).

**Do:** each becomes a built-in named check a user can tick in a step. Twips takes one target pattern, so each check needs its own search (IDA* with a check function) or a precomputed table. Still no method code: these are new building blocks, not methods.
