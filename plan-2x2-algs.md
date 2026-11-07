# puzzly — CLL and EG alg sets for the 2x2x2 (context for new chats)

Start a new chat with: "Read plan-2x2-algs.md, then do Part N." Tick the part below when it's done, and say which part comes next.

**Before Part 1:** the working tree may still hold the uncommitted work of 2026-11-06/07 (the 2x2x2 example methods, `puzzle` in method files, and the hand turns that bring a first face home). Commit it first, so this work starts from a clean base.

## Progress

- [ ] Part 1 — Engine: alg sets on a puzzle without a frame, the generator, the CLL and EG sets, their check
- [ ] Part 2 — The CLL and EG methods and the page use them; docs and Notion

Both parts may fit in one chat; split them only if Part 1 runs long.

## Goal

The 2x2x2's CLL and EG steps are answered the way solvers do them: the case is recognised, and a known alg for it is made. Today they are searched, which gives short R U F sequences that are rarely the algs a solver would use. It should work as OLL and PLL already do on the 3x3x3.

**Every face, the speed ranking decides** (the user, 2026-11-07): the 2x2x2's default moves are all six faces, and so are the example methods' steps. R U F alone reach every state, but a D, L or B turn may be faster, and the speed ranking should be the one to say so. Make the algs on all six faces too.

## What's known (2026-11-07)

### How alg sets work today

- **The data** (`src/engine/algs/sets.ts`): `AlgSet { name, puzzle, adjust, cases }`. A case is `AlgCase { name, algs }`, default alg first. `adjust` holds the lining-up turns: one is tried before the alg (the case seen from another side) and one after it.
  - `ALG_SETS` is keyed by upper-case name (OLL, PLL, ZBLL, all `puzzle: "3x3x3"`). `algSet(name)` returns a set only when it's for the active puzzle and listed in `puzzle.algSets`.
  - The keys are global, so a 2x2x2 "CLL" would block a 3x3x3 CLL set later. Make `algSet` find the set by name *among the active puzzle's sets*, and give `ALG_SETS` unique keys (e.g. `2x2x2 CLL`); the 3x3x3's lookups must stay the same.
- **The step** (`src/engine/step/alg-step.ts`, `algCandidates`): it takes the goals in grip `""` only and checks a cube with `goalTargets` (as held), for every adjust before × alg × adjust after. A goal that solves every piece (`solvesAll`) uses a lookup by the cube's key (`solvers`), so long sets stay fast. A cube that no alg fits is searched instead.
- **The check** (`bench/alg-sets.ts`): every last-layer state of the 3x3x3 is made, and each set is asked to recognise it. It reports algs that don't end held as they started, cases filed wrong, cases that share a state, and states no alg fits.
- **Alg text**: `toFaces` turns r / M / x into face turns and says whether the alg ends held as it started (`home`); an alg that doesn't is dropped.

### What the 2x2x2 needs from the engine

- **Any orientation**: without a frame, a goal counts in any orientation (`orientedTargets`, `goal/targets.ts`; with a frame it returns `goalTargets`, so the 3x3x3 is unchanged). `algCandidates` uses `goalTargets`, so on the 2x2x2 an alg would have to leave the puzzle solved exactly as held.
  - Switch it to `orientedTargets`. Then an alg that leaves the cube solved but turned (a D layer off by a turn = a U turn + a y) still counts, and EG needs no D turn after its alg.
  - The `solvers` lookup gets 24 times more targets per set (fine: a few hundred algs × 4 last turns × 24).
- **The home turn**: after a frameless step whose goal ends in another orientation, a searched step's answer ends with a hand turn such as `(x2)` (`homeTurnOf` in `step/scoring.ts`, `homeTurn` in `goal/targets.ts`). That way later steps keep the names, the face stays on the bottom, and the 2x2x2 example methods' first face or layer always ends on D. Alg answers should end with one too when their goal is reached turned. The last step doesn't need it, but a middle step (e.g. an Ortega OLL set later) does.
- **Where the steps start**: after a method's first step and its home turn, the CLL step starts with the D layer exactly home (24 × 27 = 648 states of the top). The EG step starts with the D face oriented home but its corners in any of 24 orders: 24 × 648 = 15,552 states.
- **Lining-up turns**:
  - CLL: the top's turns (`U U' U2`, as `TOP` in `sets.ts`).
  - EG: also the bottom's before the alg, since its swap must be lined up. One entry is tried before, so use every combination `U^a D^b` but none (15 entries). The answer then holds a D turn, which EG solvers make too. After the alg the top's turns are enough, since any orientation counts.

### Making the algs (not typed from memory)

- **A generator** (new `bench/cube2-algs.ts`, bundled by `bench/build.mjs`):
  - Enumerate the step's states: CLL's 648, EG's 15,552.
  - For a state that no case covers yet, ask the engine for its fastest answer on all six faces to "all corners" from a clean start: `solveStep` with rank speed and 2 extra moves, and no `done`, so no credit for cancelling into earlier moves (that credit is what made the searched steps undo the step before, see `plan-puzzles.md`, *What Part 3b found and did*).
  - Add that answer as a new case, then mark every state it covers: each lining-up turn before, each top turn after, any orientation. Repeat until every state is covered. Expect about 42 CLL cases and about 3 × 42 for EG.
  - Write `src/engine/algs/cll.ts` and `src/engine/algs/eg.ts` in `pll.ts`'s style, with a header saying they're generated and how to make them again. The EG set holds the CLL cases too (as ZBLL holds the PLLs), or its own, if the generator's covering says so.
- **Case names**, so the page's "alg" note means something:
  - The top's shape from its corners' twists, up to top turns. There are 8 classes: O (all oriented: the adjacent and diagonal swaps) and 7 shapes.
  - Name the shapes from reference algs, not by hand: Sune `R U R' U R U2 R'`, Antisune `R U2 R' U' R U' R'`, H `R2 U2 R U2 R2`, Pi `F R U R' U' R U R' U' F'`, U `F R U R' U' F'`, T `R U R' U' R' F R F'`, L `F R' F' R U R U' R'`. Undo each on a solved cube, read its twists, and check the 7 come out different.
  - EG's prefix comes from the bottom's order, up to its turns: `CLL` (in order), `EG-1` (an adjacent swap), `EG-2` (a diagonal swap). Name format: `CLL Sune 3`, `EG-1 Pi 2`.
- **Register them**: `ALG_SETS` gets CLL and EG with `puzzle: "2x2x2"`, and `CUBE2.algSets = ["CLL", "EG"]` (`src/engine/puzzle/cube2.ts`; its comment says "no alg sets of its own yet").

## Part 1 — Engine, generator, sets, check

- [ ] `algSet` finds a set by name among the active puzzle's; `ALG_SETS` keys made unique. The 3x3x3's OLL / PLL / ZBLL unchanged.
- [ ] `algCandidates`: `orientedTargets` instead of `goalTargets`, and alg answers end with the home turn when their goal is reached turned. Keep the 3x3x3's results the same.
- [ ] `bench/cube2-algs.ts`: the generator above; run it, write `cll.ts` and `eg.ts`, register both sets, set `CUBE2.algSets`.
- [ ] A check, either `bench/alg-sets.ts` taught the 2x2x2 or a new `bench/cube2-alg-sets.ts`:
  - every CLL state and every EG state is recognised (an alg fits, and the answer replays to solved, `reachesGoal`);
  - every alg ends held as it started;
  - every case is named;
  - fails with exit code 1 otherwise.
- [ ] `npm run check` still prints "Same as the baseline: all 146 lines"; `node bench/out/cube2.js` passes.

## Part 2 — Methods, page, docs

- [ ] `src/demo/example-methods-2x2x2.json`: the CLL method's CLL step `"algs": "CLL"`, the EG method's EG step `"algs": "EG"`. The names can say so, e.g. "CLL (any layer, then a CLL alg)".
- [ ] `src/demo/page/index.html`: the step form's alg select (`step-algs`) gets CLL and EG options. `showPuzzle` already hides a set the picked puzzle doesn't have.
- [ ] `bench/cube2-methods.ts`: the CLL and EG runs say their case (`row.alg`) on every scramble. Compare means with the searched ones (20 scrambles on six faces, 2026-11-07: CLL 13.5 moves at a speed cost of 19.92, EG 10.5 at 15.03).
- [ ] The page by hand: pick the 2x2x2, run CLL and EG, see the case name in the rows; the 3x3x3's alg select as before.
- [ ] README:
  - *Alg sets* under *Speed*: the 2x2x2's sets, the lining-up turns, any orientation, the generator;
  - the 2x2x2 examples table under *Method files*;
  - *Check*: the new check;
  - the folder layout: `cll.ts`, `eg.ts`, `bench/cube2-algs.ts`.
- [ ] `plan-puzzles.md`: a line in *Progress* under Part 3, and what was found.
- [ ] Notion: tick "Create an alg set for cll and eg" (Puzzly → Próximos passos → 🧩 Puzzles → 2x2x2).
