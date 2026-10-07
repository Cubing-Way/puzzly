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

Step searches run in `search/`, a small Rust crate built to WebAssembly, in one worker that keeps what it builds between searches. A goal small enough for one exact distance table (up to 10M states: cross, EO, CO, EOLine, a Roux first block, ZZ blocks after EOLine…) gets one: it's built once (about 50 ms to 0.6 s), then every scramble is answered with a shortest solution right away, without searching. Bigger goals (XCross, F2L pairs that keep earlier pieces…) are searched with [twips](https://github.com/cubing/twips), keeping each target's prune table. Build it once before `npm run dev` / `npm run build`, and again after changing it (needs Rust, the `wasm32-unknown-unknown` target and wasm-pack):

```bash
npm run build-search
```

## Test bench

- **Start position**: a random scramble, or any moves you type (Ctrl+Enter solves).
- **Result**: the solution plays on the 3D cube, with move count, time and a check that it really reaches the goal.
- **Done so far**: moves earlier steps did after the scramble; *Continue from here* adds the shown solution here, so steps can be chained (cross, then XCross…). The scramble is judged by its centers; after it only x/y/z change the grip, so M/E/S in a step don't make the next step think the cube was turned.
- **Runs**: every solve this session; click a row to see it again.
- **Goal**: *Step* solves only the chosen pieces (presets, or the chips with *Chip click sets*). `UF` = solved, `UF:p` = in place with any twist, `UF:o` = oriented and may swap with the other `:o` pieces of its type (`:o2`, `:o3`… are separate groups, e.g. DR: U/D edges `:o`, E-slice edges `:o2`), `UF:s` / `:s2`… = anywhere in its group with any twist. Centers `U L F R B D`: none listed = all six kept, otherwise only the listed ones (e.g. Roux first block `L DL FL BL DFL DBL` with M allowed). *Full cube* solves everything.
- **Alternatives**: put several goals in *Pieces*, one per line (*+ Alternative* copies the caret's line below it); any one of them counts. The chips, preset and cube mask follow the line the caret is on, and Enter adds a line (Ctrl+Enter solves). Every alternative × grip × offset is searched and the shortest wins; on a tie, the alternative that solves more new pieces wins, so `DF DR DB DL` plus a line `DF DR DB DL DFR FR` gives the XCross whenever it costs no extra move. The result's *Alternative* (e.g. 2 of 2), the status line and the runs table say which one won.
- **Bottom face**: which faces may go on the bottom (plus *any front* for y turns). Every grip is searched and the shortest answer wins; it starts with the rotation to do first (e.g. `x2 L D R D`).
- **Offsets**: the goal also counts when the cube is off by one of these moves, e.g. `D D2 D'` (*ADF*) for a pseudo-cross or `U U2 U'` (*AUF*) for a last-layer step. Spaces separate one-move offsets; use commas when an offset has several moves (`U D, U2`). No offset is always tried too; every grip × offset pair is searched (repeats skipped) and the shortest wins. The solution leaves the offset in: the result shows it with the moves that undo it, and a next step needs the same offsets (or those undo moves first).
- **Moves allowed**: face turns plus M, E, S. If a step keeps centers that are out of place and its moves can't bring them home, it stops with a message instead of searching forever.
- **Method**: a list of steps run in order, each from where the last one left the cube (after *Done so far*). The form on the left is the step editor: set it up, give the step a name, then *Add form as step*; *Edit* loads a step back into the form and *Update step N* saves it. *Keep earlier steps' pieces* adds every earlier step's pieces to the goal (this step's roles win; centers only change when the step lists some). Only the grips where the fewest of the step's pieces are already kept get searched, so a grip turn can't swap the step's pieces for ones already done: `DFR FR` with any front means "the easiest pair not done yet", and an OLL step can't turn the solved first layer to the top. A step whose pieces are all done already in the grip it's held in (e.g. the last pair after an XCross) answers with 0 moves. *Run method* lists each step's solution and moves; click a row to see it on the cube. *Save* keeps the method in this browser; *Export file* / *Import file* share it as JSON. Examples: CFOP (cross + 4 pairs), CFOP (cross or free XCross: the first step's alternatives), ZZ (EOLine + blocks), pseudo-slotting (pairs up to ADF, then an ADF step).

## Method files

A method is plain JSON, the same in saved methods, exported files and `src/example-methods.json`:

```json
{
  "name": "CFOP (cross + 4 pairs)",
  "steps": [
    { "name": "Cross", "pieces": "DF DR DB DL", "keep": false, "grips": { "bottom": ["D"], "anyFront": false }, "offsets": "", "moves": ["U", "R", "F", "D", "L", "B"], "maxDepth": null, "firstFound": false },
    { "name": "Pair 1", "pieces": "DFR FR", "keep": true, "grips": { "bottom": ["D"], "anyFront": true }, "offsets": "", "moves": ["U", "R", "F", "D", "L", "B"], "maxDepth": null, "firstFound": false }
  ]
}
```

`pieces` and `offsets` use the same text as the form, with ` | ` between a step's alternatives (e.g. `"DF DR DB DL | DF DR DB DL DFR FR"`; a list of goal texts is read the same way); `maxDepth` is `null` for no limit. Left-out fields get defaults (D bottom, face turns, no offsets), and a bad field is reported with its step number.

## Folder layout

| Path | What's in it |
| --- | --- |
| `src/engine.ts` | Cube engine: piece names, goal masks, solvers, methods, goal check. No page code, so it can move to another app. |
| `src/main.ts` | Test bench page logic |
| `src/method-store.ts` | Example, saved (localStorage) and file methods for the page |
| `src/example-methods.json` | Example methods, as data only |
| `src/index.html`, `src/index.css` | Test bench page |
| `src/search-worker.ts` | Search worker: one per session; exact tables for small goals, twips for the rest, kept up to 256 MB |
| `search/` | Rust search crate: `src/table.rs` exact distance tables, `src/coords.rs` their state numbering, `src/lib.rs` twips searches; built to `search/pkg` by `npm run build-search` |
| `script/build.js` | Dev server and build (barely-a-dev-server + esbuild) |

## Browser support

Needs a modern browser (roughly iOS/Safari 15.4+, recent Chrome, Edge or Firefox), because cubing.js uses Web Workers, WebAssembly and WebGL.
