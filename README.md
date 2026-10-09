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

Step searches run in `search/`, a small Rust crate built to WebAssembly, in one worker that keeps what it builds between searches. A goal small enough for one exact distance table (up to 10M states: cross, EO, CO, EOLine, a Roux first block, ZZ blocks after EOLine…) gets one: it's built once (about 50 ms to 0.6 s), then every scramble is answered with a shortest solution right away, without searching. A bigger goal (XCross, XXCross, first layer, DR, F2L pairs, OLL or PLL that keep earlier pieces…) is split into sub-tables that each fit (the goal with some pieces, or their twists, left out) and searched with IDA*, bounded by the largest sub-table distance: still a shortest solution, e.g. XXCross in a few ms instead of up to 9 s, or an OLL step that keeps F2L in about 0.1–0.5 s instead of ~20 s. Equal sub-goals share one table (all CFOP pair steps use the same eight "cross + one slot piece" tables). When the goal is the whole cube (PLL or a finish that keeps earlier pieces, every BLD step, a DR finish), sub-tables that are rotated copies of each other are built only once: the cube is turned by a rotation that keeps the allowed moves before the lookup, so the table for "4 U edges + UFR" also answers for "+ UBR" (PLL with keep: 4 tables instead of 16, a DR finish 1 instead of 7, with the same answers and search speed). Each split goal starts on small sub-tables (built in a fraction of a second) and switches to bigger, sharper ones (a few seconds to build) when its searches have cost about that much. [twips](https://github.com/cubing/twips) is only the fallback for goals that can't be split.

Before searching, the worker measures every alternative × grip: the exact distance from a table, or a lower bound from split tables (their largest distance at the start). Combos are searched closest first, and one that can't beat the best answer so far is never searched, so most steps run one or two searches (a pseudo-cross with any bottom face and any front: 4 searches instead of 82). A step's offsets share one table that holds every offset's target, so a pseudo-cross or a pseudo pair is one search per grip instead of one per offset.

For lookahead (see *Method* below) the same tables also list every answer up to a length, not just the first: IDA* keeps going after a hit (shortest answers first, then one move longer…), skipping answers that pass through the goal on the way (a shorter answer plus moves that keep the goal, which the next steps can always make themselves). Listing is fast (Node, 4 scrambles): every shortest cross or pseudo cross in under 1 ms, the 17–500 one move longer in 0.2–11 ms, a pseudo XCross's answers up to two moves longer (250–5,000 of them) in 10–180 ms. A list can also come a page at a time: the answers of one length that come after a given answer (answers come in a fixed move order, so the next page picks up where the last one ended without redoing it). The method search (see *Method search* below) uses that, so it never holds a huge list.

A step with *Solvable with* moves (see *Test bench*) sends them along with its targets: the Rust side closes the targets under those moves (every pattern they reach from them, at most 100,000) and fills the tables from all of them at once, so the answer is still a shortest one. Split goals of this kind also get one table per piece type holding every tracked piece's position (no twists), because such goals limit how the pieces sit as a whole (a 2-gen corner permutation), which tables of a few pieces can't see. A CP line (`DL DFL DBL` plus the other corners `:p`, solvable with R U) is one exact table of 8.7M states (about 1.7 s to build once, then stored), and each scramble's 4–6 move answer takes ~0.1 ms.

A goal with relative groups (`:r`, see *Test bench*) needs nothing new on the Rust side either: the engine sends one target per way its groups can sit (a pair: 24, or 16 with the cross kept, since the pair can't sit on a cross spot), and the tables fill from all of them at once, so answers stay shortest. Cross + a pair joined anywhere is one search of ~10 ms once its tables exist (~0.35 s with the first build).

Blindfolded (BLD) steps keep every other piece exactly as it is, so their goal depends on the scramble. The engine renames the pieces so the wanted end state *is* the solved cube (moves act on spots, not on piece names, so the answer is the same): every BLD step becomes "solve the whole cube" from a cube that's solved except for a 3-cycle, a parity swap or a flip. All BLD steps of every scramble therefore share one set of tables. They also ask for a whole-orbit table (all 8 corners, 88M states, ~7 s to build once, then stored), which sees corner swaps and twists that tables of one corner each can't. 3-cycles take a few ms and parity steps (13–14 moves) 0.01–6 s. Pure 2-edge flips (13–14 moves) are the slow case, 5–40 s, since no table that fits sees them well. The engine remembers every BLD answer while the page is open, and a case doesn't depend on the rest of the cube, so a repeat of the same case is instant.

Tables of 100k states and up are stored in the browser (IndexedDB, database `puzzly-tables`), so after a reload they load in a few ms instead of being rebuilt (e.g. CFOP + OLL: about 3 s the first time, under 1 s after a reload). While the worker builds or loads tables, the status line says *building tables…* / *loading stored tables…*, and the final status says how many it built or loaded. After 60 s without searches the worker stops, so its memory goes back to the system; the next search starts a fresh one, which loads the stored tables. Clearing the site's data in the browser removes them (they're rebuilt when needed).

Build it once before `npm run dev` / `npm run build`, and again after changing it (needs Rust, the `wasm32-unknown-unknown` target and wasm-pack):

```bash
npm run build-search
```

## Benchmark

`bench/` times the search on heavy goals in Node (no browser), so a change to the Rust search or the engine can be compared with the code before it. Bundle it after `npm run build-search`:

```bash
npm run bench-build
```

- `node bench/out/record.js [requests file] [scenarios] [passes]` runs five scenarios on fixed seeded scrambles through the real engine and worker: *dr-finish* (DR, then the whole cube with `U D R2 L2 F2 B2`), *xxxcross*, *cfop-oll-pll* (the CFOP example plus OLL and PLL that keep F2L), *pseudo-lookahead* (the pseudo-slotting example) and *bld-flip* (two pure 2-edge flips). It prints each run's moves and time, twice (first with table builds, then warm), and saves every request the engine sent to the worker (default `bench/out/requests.jsonl`). A full run takes 10–20 minutes.
- `node bench/out/replay.js [requests file] [results file] [scenarios]` sends those requests straight to the Rust search, each goal on its biggest tables, and prints per scenario: time, search nodes, µs per node, and how far the start bound is below the real answer length. Tables are saved in `bench/out/tables` after the first run (`FRESH=1` builds them again).
- `node bench/compare.mjs before.jsonl after.jsonl` checks that two replays give the same answers (and node counts) and prints the speed-up per scenario.

The replay bundle carries the Rust search code it was built with, so to compare a Rust change: record once, copy `bench/out/replay.js` to `bench/out/replay-before.js` and replay with it into `before.jsonl`, then change the code, run `npm run build-search` and `npm run bench-build`, replay into `after.jsonl` and compare.

## Test bench

- **Start position**: a random scramble, or any moves you type (Ctrl+Enter solves).
- **Result**: the solution plays on the 3D cube, with move count, time and a check that it really reaches the goal. The status line notes when tables are being built or loaded, and how many.
- **Done so far**: moves earlier steps did after the scramble; *Continue from here* adds the shown solution here, so steps can be chained (cross, then XCross…). The scramble is judged by its centers; after it only x/y/z change the grip, so M/E/S in a step don't make the next step think the cube was turned.
- **Runs**: every solve this session; click a row to see it again.
- **Goal**: *Step* solves only the chosen pieces (presets, or the chips with *Chip click sets*). `UF` = solved, `UF:p` = in place with any twist, `UF:o` = oriented and may swap with the other `:o` pieces of its type (`:o2`, `:o3`… are separate groups, e.g. DR: U/D edges `:o`, E-slice edges `:o2`), `UF:s` / `:s2`… = anywhere in its group with any twist, `UF:r` / `:r2`… = solved relative to the rest of its group, anywhere (see *Relative groups*), `UF:x` = its spot may change (for *Blindfolded* steps; anywhere else it's the same as leaving the piece out). Pressed chips show their role (`:o`, `:p`, `:r`, `:x`…). Centers `U L F R B D`: none listed = all six kept, otherwise only the listed ones (e.g. Roux first block `L DL FL BL DFL DBL` with M allowed). *Full cube* solves everything.
- **Relative groups**: `:r` (and `:r2`, `:r3`… for separate groups) marks pieces that only need to be solved relative to each other, anywhere on the cube: `DFR:r FR:r` is that pair joined anywhere, `DF DR DB DL DFR:r FR:r` (preset *Cross + front-right pair joined anywhere*) the cross plus that pair joined wherever it doesn't break the cross, `DBL:r DB:r DL:r BL:r` a corner and its three edges as a block anywhere (an FMC pseudo-block). A group may sit wherever turning the whole cube would put it (24 ways), but only on spots of pieces the goal ignores, or of `:o` / `:s` group pieces, which then take the spots it left; pieces without `:r` stay home, and two groups are placed independently. Answers are still shortest (Node, seeded scrambles): a pair joined anywhere 2–3 moves (2–5 into its slot), cross + pair joined 6–7 (XCross 7–9), the block anywhere 5–6 (6–7 at home), each in about 10 ms once the tables exist; cross + two pairs joined (`:r` and `:r2`) 7–8 moves in ~90 ms. With restricted moves, places the moves can never reach are left out (a pair in a slot R U never turn, an edge flipped under U R L). In a method, *Keep earlier steps' pieces* keeps each earlier group joined on its own (groups are renumbered, so a pair joined earlier and one joined now don't have to sit together, and a step joining "the easiest pair" with *any front* skips pairs already joined); to grow a block instead, list its pieces again in the new step's group, e.g. `DBL:r DB:r DL:r BL:r`, then `DBL:r DB:r DL:r BL:r DFL:r DF:r FL:r` (a pseudo 2x2x2, then 2x2x3: 10–13 moves on 4 scrambles vs 11–13 for the same blocks at home).
- **Alternatives**: put several goals in *Pieces*, one per line (*+ Alternative* copies the caret's line below it); any one of them counts. The chips, preset and cube mask follow the line the caret is on, and Enter adds a line (Ctrl+Enter solves). Every alternative × grip (with all its offsets) counts and the shortest wins (combos that can't beat the best aren't searched); on a tie, the alternative that solves more new pieces wins, so `DF DR DB DL` plus a line `DF DR DB DL DFR FR` gives the XCross whenever it costs no extra move. The result's *Alternative* (e.g. 2 of 2), the status line and the runs table say which one won.
- **Bottom face**: which faces may go on the bottom (plus *any front* for y turns). Every grip counts and the shortest answer wins; it starts with the rotation to do first (e.g. `x2 L D R D`).
- **Offsets**: the goal also counts when the cube is off by one of these moves, e.g. `D D2 D'` (*ADF*) for a pseudo-cross or `U U2 U'` (*AUF*) for a last-layer step. Spaces separate one-move offsets; use commas when an offset has several moves (`U D, U2`). No offset is always tried too; a grip's offsets are searched together (one table holds every offset's target) and the shortest wins. The solution leaves the offset in: the result shows it with the moves that undo it, and a next step needs the same offsets (or those undo moves first).
- **Solvable with**: the goal also counts when these moves alone can finish it later, e.g. `R U`: `DL DFL DBL UFR:p UBR:p UBL:p UFL:p DFR:p DBR:p` solvable with `R U` is the left line plus corners that R and U alone can solve (the CP step of 2GR or ZZ-d), not the corners in place. Every cube state those moves reach from the goal counts (at most 100,000: give pieces the moves twist anyway `:p`, as above, which leaves 120 states instead of 29,160). The result and the runs table check the answer the same way. Later steps that keep earlier pieces only keep the ones those moves can't disturb (the line here, not the corners), so the steps after it should use those moves only (e.g. *Moves allowed* R U), which keep the property by themselves. If the moves would change pieces (or centers) the step's allowed moves never touch, the step stops with a message instead.
- **Blindfolded**: *keep every other piece untouched* makes every piece the goal doesn't list stay exactly where it is, turned the same way (instead of being ignored).
  - The listed pieces go home, and the pieces they push out fill the spots they leave. `:p` pieces may end with any twist, and `:x` spots may take any piece.
  - Examples: `UR UB UF:x` finds the shortest 3-cycle that solves UR and UB through UF; `UFR:p UBR:p UR UL` finds the shortest T-perm-like swap.
  - A goal no moves can reach with everything else kept (a lone swap or a lone twist) stops with a message.
  - **Buffer**: the step picks its own pieces (leave *Pieces* empty). It follows the buffer's cycle for *targets per step* targets (2 = a 3-cycle): each target sends the piece in the buffer home and brings the piece there into the buffer.
  - When the buffer holds its own piece, a new cycle starts at any unsolved piece; every choice is tried and the shortest wins. With the buffer home, a step may instead fix two pieces that are only flipped or twisted in place, like a flip alg.
  - **Parity pieces** (e.g. `UFR UBR`): when the targets left are odd (a lone swap no moves can do), those pieces swap too, keeping their twists (like a parity alg). Only if that can't work may they end any way.
  - Quick picks: *Edges (UF)* (parity `UFR UBR`), *Corners (UFR)*, *None*. The result shows which pieces went home and which spots changed, and the check also makes sure every other piece is still where it was.
  - Untouched steps take no offsets or solvable-with moves. Their goal is relabeled to "the whole cube" (see *Rust search*), so they share one set of tables.
- **Moves allowed**: face turns plus M, E, S. A letter allows every turn of that layer (R, R2, R'); the second row (`U2` … `S2`) allows only its half turn (ticking both = every turn). Quick picks: *Face turns*, *R U*, and *DR* (`U D R2 L2 F2 B2`, a domino reduction's second phase). E.g. after your own DR step, a step with every piece, *Keep earlier steps' pieces* and *DR* finishes the cube without leaving DR, shortest within those moves (12 scrambles: 12–15 move finishes; the first few solves take 1–2 s while the tables are built, then finishes take 6–260 ms). In method files these are plain moves like `"R2"`. If a step keeps centers that are out of place and its moves can't bring them home, it stops with a message instead of searching forever.
- **Method**: a list of steps run in order, each from where the last one left the cube (after *Done so far*). The form on the left is the step editor: set it up, give the step a name, then *Add form as step*; *Edit* loads a step back into the form and *Update step N* saves it. *Keep earlier steps' pieces* adds every earlier step's pieces to the goal (this step's roles win; centers only change when the step lists some). Only the grips where the fewest of the step's pieces are already kept get searched, so a grip turn can't swap the step's pieces for ones already done: `DFR FR` with any front means "the easiest pair not done yet", and an OLL step can't turn the solved first layer to the top. A step whose pieces are all done already in the grip it's held in (e.g. the last pair after an XCross) answers with 0 moves. *Repeat until done* runs a step again and again, until a round has nothing left to do (0 moves); each round gets its own row (*Edges 1*, *Edges 2*…). That's one 3-cycle per round for BLD, or "the easiest pair" with *any front* until F2L is done. *Run method* lists each step's solution and moves; click a row to see it on the cube. *Save* keeps the method in this browser; *Export file* / *Import file* share it as JSON.
  - Examples: CFOP (cross + 4 pairs); CFOP (cross or XCross, lookahead: the first step's alternatives, judged by the pair after them); ZZ (EOLine + blocks); pseudo-slotting (pairs up to ADF with lookahead, then an ADF step).
  - ZZ (left block + CP, then R U only): the left block step also leaves corners R U can solve, so the right block and the last layer use only R and U. Without it, 5 of 6 test scrambles end with *No solution found!* at the last layer.
  - 3-style BLD: edges from buffer UF with parity `UFR UBR`, then corners from UFR, each repeated until done. On 12 random scrambles: 81–116 moves, every round checked. The first run takes ~10 s (table builds). After that most solves take 0.1–3 s, and a first-time 2-edge flip takes up to ~30 s.
- **Lookahead** (per method step, under the step name): on its own, each step takes its shortest answer, so a method never accepts a slightly worse step that sets up the next ones. With *Lookahead N steps*, the step lists its candidate answers (every alternative × grip × offset: all its shortest answers, plus answers up to *extra moves* longer, at most 64, shortest first), runs the next N steps after each one (each taking its own shortest answer), and keeps the candidate with the fewest moves in total; on a tie, its own shortest answer stays. That's what makes pseudo-slotting and free XCrosses pay off: a pseudo pair that leaves the cube off by a D turn, or an XCross two moves longer than the cross, wins when it saves more in the next step. The results table's *Lookahead* column shows candidates compared → the winner's moves over the steps it was judged by (details on hover). On 8 scrambles, total moves greedy → lookahead 1 (→ with 1 extra move): pseudo-slotting 218 → 197 (→ 183), CFOP 227 → 211 (→ 188), ZZ 202 → 184 (1 extra move); a step with lookahead 1 plus its next step is never longer than greedy's two. It costs one run of the next steps per candidate: the pseudo-slotting example takes about 0.5–1.5 s per solve once its tables exist. Lookahead 0 (the default, and what old method files get) gives exactly the answers it gave before.
- **Method search** (*Search fewest moves*, under *Run method*, with a time limit in seconds): looks for the run of the whole method with the fewest moves in total, where any step may take a longer answer if that saves more moves later.
  - It starts from *Run method*'s answer (with the steps' own lookahead) and only looks for runs with fewer moves. Each shorter run replaces the rows as soon as it's found (the *Time* of the total is when it was found), and the best one goes to the cube and the runs table at the end.
  - It goes through each step's answers shortest first. Before going on from an answer, it measures how far the next step is; an answer whose next step can't get under the best total is skipped, and so is a cube state reached before with no fewer moves. The last step just takes its shortest answer within the moves left.
  - It stops at the time limit or when you press *Stop search*, keeping the best run. When it gets through everything first, the status says the run is *the fewest this method can do*; otherwise there may still be a shorter one.
  - Rules: a step's answer never passes through its own goal on the way (as with lookahead), *Max depth* still limits a step, *stop at first answer* is ignored, a repeated step is searched round by round, and the offset the last step leaves isn't counted (a fix step like *ADF* counts like any step).
  - Examples (Node, 30 s after one plain run built the tables; plain run → best found): DR then a `U D R2 L2 F2 B2` finish on 4 scrambles 19 → 19, 23 → 17 (in 1.9 s), 22 → 20, 25 → 20 (in 1.4 s), where cubing.js's two-phase full solver gives 19, 20, 20, 21. CFOP 31 → 26 and 31 → 23, ZZ 28 → 17, ZZ with CP and R U 42 → 27, pseudo-slotting 23 → 22. Small two-step methods (cross then a pair) finish in about a second and are proven the fewest; whole CFOP or DR runs can't be proven in that time.
  - It measures roughly 1,500 step starts per second. The slow part is listing many long answers of a big step (every 12-move DR takes seconds), so it improves fastest on methods whose steps have few answers of each length.

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

`pieces` and `offsets` use the same text as the form, with ` | ` between a step's alternatives (e.g. `"DF DR DB DL | DF DR DB DL DFR FR"`; a list of goal texts is read the same way); `solvableWith` holds the *Solvable with* moves (e.g. `"R U"`, `""` = none); `maxDepth` is `null` for no limit; `lookahead` is how many later steps judge the step's answers (0 = none) and `extraMoves` how many moves longer than its shortest a candidate may be.

The blindfolded fields are:
- `untouched` (`true` = every other piece stays as it is),
- `buffer` (e.g. `"UF"`, `""` = none; implies `untouched`, and `pieces` must be `""`),
- `targetsPerStep` (default 2),
- `parity` (e.g. `"UFR UBR"`, `""` = none),
- `repeat` (`true` = run the step until it has nothing left to do).

A 3-style edges step is `{ "name": "Edges", "pieces": "", "buffer": "UF", "targetsPerStep": 2, "parity": "UFR UBR", "repeat": true }` (the other fields default). Left-out fields get defaults (D bottom, face turns, no offsets or solvable-with moves, nothing untouched, no lookahead, no repeat), and a bad field is reported with its step number.

## Folder layout

| Path | What's in it |
| --- | --- |
| `src/engine.ts` | Cube engine: piece names, goal masks (and the targets of relative groups), untouched / BLD goals (buffer tracing, parity, relabeling to the solved cube), solvers (`solveStep`, `stepCandidates` for every answer up to N extra moves), methods with lookahead and repeated steps (`runMethod`), the method search for the fewest moves in total (`searchMethod`), goal check (with offsets, solvable-with moves and untouched pieces). No page code, so it can move to another app. |
| `src/main.ts` | Test bench page logic |
| `src/method-store.ts` | Example, saved (localStorage) and file methods for the page |
| `src/example-methods.json` | Example methods, as data only |
| `src/index.html`, `src/index.css` | Test bench page |
| `src/search-worker.ts` | Search worker: an exact table for small goals, split tables + IDA* for bigger ones (small sub-tables first), twips as the fallback; measures each combo's distance before searching, lists every answer up to a length for lookahead (or a page of one length, for the method search); kept up to 256 MB, tables of 100k+ states stored in IndexedDB; stopped after 60 s idle |
| `search/` | Rust search crate: `src/table.rs` exact distance tables (and their saved bytes), `src/coords.rs` their state numbering, `src/split.rs` split tables + IDA* (first answer, or every answer up to a length, or a page of them; BLD goals also get whole-orbit tables), `src/symmetry.rs` cube rotations that keep a whole-cube goal's moves (rotated copies of a sub-table read through one table), `src/solvable.rs` targets closed under a step's solvable-with moves (and the targets' JSON options), `src/lib.rs` twips searches; built to `search/pkg` by `npm run build-search` |
| `script/build.js` | Dev server and build (barely-a-dev-server + esbuild) |

## Browser support

Needs a modern browser (roughly iOS/Safari 15.4+, recent Chrome, Edge or Firefox), because cubing.js uses Web Workers, WebAssembly and WebGL.
