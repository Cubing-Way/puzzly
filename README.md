# puzzly

A Rubik's cube engine built on [cubing.js](https://js.cubing.net/cubing/), with a browser test bench for its scramble, step and full solvers.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:1234.

## Build

```bash
npm run build
```

The site lands in `dist/web` as plain static files you can host anywhere.

## Rust search

Step searches run in `search/`, a small Rust crate built to WebAssembly, in one worker that keeps what it builds between searches. A goal small enough for one exact distance table (up to 10M states: cross, EO, CO, EOLine, a Roux first block, ZZ blocks after EOLine…) gets one: it's built once (about 50 ms to 0.6 s), then every scramble is answered with a shortest solution right away, without searching. A bigger goal (XCross, XXCross, first layer, DR, F2L pairs, OLL or PLL that keep earlier pieces…) is split into sub-tables that each fit (the goal with some pieces, or their twists, left out) and searched with IDA*, bounded by the largest sub-table distance: still a shortest solution, e.g. XXCross in a few ms instead of up to 9 s, or an OLL step that keeps F2L in about 0.1–0.5 s instead of ~20 s. Equal sub-goals share one table (all CFOP pair steps use the same eight "cross + one slot piece" tables). Each split goal starts on small sub-tables (built in a fraction of a second) and switches to bigger, sharper ones (a few seconds to build) when its searches have cost about that much. [twips](https://github.com/cubing/twips) is only the fallback for goals that can't be split.

Before searching, the worker measures every alternative × grip: the exact distance from a table, or a lower bound from split tables (their largest distance at the start). Combos are searched closest first, and one that can't beat the best answer so far is never searched, so most steps run one or two searches (a pseudo-cross with any bottom face and any front: 4 searches instead of 82). A step's offsets share one table that holds every offset's target, so a pseudo-cross or a pseudo pair is one search per grip instead of one per offset.

For lookahead (see *Method* below) the same tables also list every answer up to a length, not just the first: IDA* keeps going after a hit (shortest answers first, then one move longer…), skipping answers that pass through the goal on the way (a shorter answer plus moves that keep the goal, which the next steps can always make themselves). Listing is fast (Node, 4 scrambles): every shortest cross or pseudo cross in under 1 ms, the 17–500 one move longer in 0.2–11 ms, a pseudo XCross's answers up to two moves longer (250–5,000 of them) in 10–180 ms.

A step with *Solvable with* moves (see *Test bench*) sends them along with its targets: the Rust side closes the targets under those moves (every pattern they reach from them, at most 100,000) and fills the tables from all of them at once, so the answer is still a shortest one. Split goals of this kind also get one table per piece type holding every tracked piece's position (no twists), because such goals limit how the pieces sit as a whole (a 2-gen corner permutation), which tables of a few pieces can't see. A CP line (`DL DFL DBL` plus the other corners `:p`, solvable with R U) is one exact table of 8.7M states (about 1.7 s to build once, then stored), and each scramble's 4–6 move answer takes ~0.1 ms.

Tables of 100k states and up are stored in the browser (IndexedDB, database `puzzly-tables`), so after a reload they load in a few ms instead of being rebuilt (e.g. CFOP + OLL: about 3 s the first time, under 1 s after a reload). While the worker builds or loads tables, the status line says *building tables…* / *loading stored tables…*, and the final status says how many it built or loaded. After 60 s without searches the worker stops, so its memory goes back to the system; the next search starts a fresh one, which loads the stored tables. Clearing the site's data in the browser removes them (they're rebuilt when needed).

Build it once before `npm run dev` / `npm run build`, and again after changing it (needs Rust, the `wasm32-unknown-unknown` target and wasm-pack):

```bash
npm run build-search
```

## Test bench

- **Start position**: a random scramble, or any moves you type (Ctrl+Enter solves).
- **Result**: the solution plays on the 3D cube, with move count, time and a check that it really reaches the goal. The status line notes when tables are being built or loaded, and how many.
- **Done so far**: moves earlier steps did after the scramble; *Continue from here* adds the shown solution here, so steps can be chained (cross, then XCross…). The scramble is judged by its centers; after it only x/y/z change the grip, so M/E/S in a step don't make the next step think the cube was turned.
- **Runs**: every solve this session; click a row to see it again.
- **Goal**: *Step* solves only the chosen pieces (presets, or the chips with *Chip click sets*). `UF` = solved, `UF:p` = in place with any twist, `UF:o` = oriented and may swap with the other `:o` pieces of its type (`:o2`, `:o3`… are separate groups, e.g. DR: U/D edges `:o`, E-slice edges `:o2`), `UF:s` / `:s2`… = anywhere in its group with any twist. Centers `U L F R B D`: none listed = all six kept, otherwise only the listed ones (e.g. Roux first block `L DL FL BL DFL DBL` with M allowed). *Full cube* solves everything.
- **Alternatives**: put several goals in *Pieces*, one per line (*+ Alternative* copies the caret's line below it); any one of them counts. The chips, preset and cube mask follow the line the caret is on, and Enter adds a line (Ctrl+Enter solves). Every alternative × grip (with all its offsets) counts and the shortest wins (combos that can't beat the best aren't searched); on a tie, the alternative that solves more new pieces wins, so `DF DR DB DL` plus a line `DF DR DB DL DFR FR` gives the XCross whenever it costs no extra move. The result's *Alternative* (e.g. 2 of 2), the status line and the runs table say which one won.
- **Bottom face**: which faces may go on the bottom (plus *any front* for y turns). Every grip counts and the shortest answer wins; it starts with the rotation to do first (e.g. `x2 L D R D`).
- **Offsets**: the goal also counts when the cube is off by one of these moves, e.g. `D D2 D'` (*ADF*) for a pseudo-cross or `U U2 U'` (*AUF*) for a last-layer step. Spaces separate one-move offsets; use commas when an offset has several moves (`U D, U2`). No offset is always tried too; a grip's offsets are searched together (one table holds every offset's target) and the shortest wins. The solution leaves the offset in: the result shows it with the moves that undo it, and a next step needs the same offsets (or those undo moves first).
- **Solvable with**: the goal also counts when these moves alone can finish it later, e.g. `R U`: `DL DFL DBL UFR:p UBR:p UBL:p UFL:p DFR:p DBR:p` solvable with `R U` is the left line plus corners that R and U alone can solve (the CP step of 2GR or ZZ-d), not the corners in place. Every cube state those moves reach from the goal counts (at most 100,000: give pieces the moves twist anyway `:p`, as above, which leaves 120 states instead of 29,160). The result and the runs table check the answer the same way. Later steps that keep earlier pieces only keep the ones those moves can't disturb (the line here, not the corners), so the steps after it should use those moves only (e.g. *Moves allowed* R U), which keep the property by themselves. If the moves would change pieces (or centers) the step's allowed moves never touch, the step stops with a message instead.
- **Moves allowed**: face turns plus M, E, S. A letter allows every turn of that layer (R, R2, R'); the second row (`U2` … `S2`) allows only its half turn (ticking both = every turn). Quick picks: *Face turns*, *R U*, and *DR* (`U D R2 L2 F2 B2`, a domino reduction's second phase). E.g. after your own DR step, a step with every piece, *Keep earlier steps' pieces* and *DR* finishes the cube without leaving DR, shortest within those moves (12 scrambles: 11–15 moves; the first solves take 2–10 s while the tables are built, then 11–13 move finishes take 14–131 ms and 14–15 move ones 0.4–4.7 s). In method files these are plain moves like `"R2"`. If a step keeps centers that are out of place and its moves can't bring them home, it stops with a message instead of searching forever.
- **Method**: a list of steps run in order, each from where the last one left the cube (after *Done so far*). The form on the left is the step editor: set it up, give the step a name, then *Add form as step*; *Edit* loads a step back into the form and *Update step N* saves it. *Keep earlier steps' pieces* adds every earlier step's pieces to the goal (this step's roles win; centers only change when the step lists some). Only the grips where the fewest of the step's pieces are already kept get searched, so a grip turn can't swap the step's pieces for ones already done: `DFR FR` with any front means "the easiest pair not done yet", and an OLL step can't turn the solved first layer to the top. A step whose pieces are all done already in the grip it's held in (e.g. the last pair after an XCross) answers with 0 moves. *Run method* lists each step's solution and moves; click a row to see it on the cube. *Save* keeps the method in this browser; *Export file* / *Import file* share it as JSON. Examples: CFOP (cross + 4 pairs), CFOP (cross or XCross, lookahead: the first step's alternatives, judged by the pair after them), ZZ (EOLine + blocks), ZZ (left block + CP, then R U only: the left block step also leaves corners R U can solve, so the right block and the last layer use only R and U; without it, 5 of 6 test scrambles end with *No solution found!* at the last layer), pseudo-slotting (pairs up to ADF with lookahead, then an ADF step).
- **Lookahead** (per method step, under the step name): on its own, each step takes its shortest answer, so a method never accepts a slightly worse step that sets up the next ones. With *Lookahead N steps*, the step lists its candidate answers (every alternative × grip × offset: all its shortest answers, plus answers up to *extra moves* longer, at most 64, shortest first), runs the next N steps after each one (each taking its own shortest answer), and keeps the candidate with the fewest moves in total; on a tie, its own shortest answer stays. That's what makes pseudo-slotting and free XCrosses pay off: a pseudo pair that leaves the cube off by a D turn, or an XCross two moves longer than the cross, wins when it saves more in the next step. The results table's *Lookahead* column shows candidates compared → the winner's moves over the steps it was judged by (details on hover). On 8 scrambles, total moves greedy → lookahead 1 (→ with 1 extra move): pseudo-slotting 218 → 197 (→ 183), CFOP 227 → 211 (→ 188), ZZ 202 → 184 (1 extra move); a step with lookahead 1 plus its next step is never longer than greedy's two. It costs one run of the next steps per candidate: the pseudo-slotting example takes about 0.5–1.5 s per solve once its tables exist. Lookahead 0 (the default, and what old method files get) gives exactly the answers it gave before.

## Method files

A method is plain JSON, the same in saved methods, exported files and `src/example-methods.json`:

```json
{
  "name": "CFOP (cross + 4 pairs)",
  "steps": [
    { "name": "Cross", "pieces": "DF DR DB DL", "keep": false, "grips": { "bottom": ["D"], "anyFront": false }, "offsets": "", "solvableWith": "", "moves": ["U", "R", "F", "D", "L", "B"], "maxDepth": null, "firstFound": false, "lookahead": 1, "extraMoves": 1 },
    { "name": "Pair 1", "pieces": "DFR FR", "keep": true, "grips": { "bottom": ["D"], "anyFront": true }, "offsets": "", "solvableWith": "", "moves": ["U", "R", "F", "D", "L", "B"], "maxDepth": null, "firstFound": false, "lookahead": 0, "extraMoves": 0 }
  ]
}
```

`pieces` and `offsets` use the same text as the form, with ` | ` between a step's alternatives (e.g. `"DF DR DB DL | DF DR DB DL DFR FR"`; a list of goal texts is read the same way); `solvableWith` holds the *Solvable with* moves (e.g. `"R U"`, `""` = none); `maxDepth` is `null` for no limit; `lookahead` is how many later steps judge the step's answers (0 = none) and `extraMoves` how many moves longer than its shortest a candidate may be. Left-out fields get defaults (D bottom, face turns, no offsets or solvable-with moves, no lookahead), and a bad field is reported with its step number.

## Folder layout

| Path | What's in it |
| --- | --- |
| `src/engine.ts` | Cube engine: piece names, goal masks, solvers (`solveStep`, `stepCandidates` for every answer up to N extra moves), methods with lookahead (`runMethod`), goal check (with offsets and solvable-with moves). No page code, so it can move to another app. |
| `src/main.ts` | Test bench page logic |
| `src/method-store.ts` | Example, saved (localStorage) and file methods for the page |
| `src/example-methods.json` | Example methods, as data only |
| `src/index.html`, `src/index.css` | Test bench page |
| `src/search-worker.ts` | Search worker: an exact table for small goals, split tables + IDA* for bigger ones (small sub-tables first), twips as the fallback; measures each combo's distance before searching, lists every answer up to a length for lookahead; kept up to 256 MB, tables of 100k+ states stored in IndexedDB; stopped after 60 s idle |
| `search/` | Rust search crate: `src/table.rs` exact distance tables (and their saved bytes), `src/coords.rs` their state numbering, `src/split.rs` split tables + IDA* (first answer, or every answer up to a length), `src/solvable.rs` targets closed under a step's solvable-with moves, `src/lib.rs` twips searches; built to `search/pkg` by `npm run build-search` |
| `script/build.js` | Dev server and build (barely-a-dev-server + esbuild) |

## Browser support

Needs a modern browser (roughly iOS/Safari 15.4+, recent Chrome, Edge or Firefox), because cubing.js uses Web Workers, WebAssembly and WebGL.
