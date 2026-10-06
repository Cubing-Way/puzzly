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

## Test bench

- **Start position**: a random scramble, or any moves you type (Ctrl+Enter solves).
- **Goal**: *Step* solves only the chosen pieces (presets or the piece chips); *Full cube* solves everything.
- **Result**: the solution plays on the 3D cube, with move count, time and a check that it really reaches the goal.
- **Done so far**: moves earlier steps did after the scramble; *Continue from here* adds the shown solution here, so steps can be chained (cross, then XCross…). The scramble is judged by its centers; after it only x/y/z change the grip, so M/E/S in a step don't make the next step think the cube was turned.
- **Runs**: every solve this session; click a row to see it again.

- **Goal**: *Step* solves only the chosen pieces (presets, or the chips with *Chip click sets*). `UF` = solved, `UF:p` = in place with any twist, `UF:o` = oriented and may swap with the other `:o` pieces of its type (`:o2`, `:o3`… are separate groups, e.g. DR: U/D edges `:o`, E-slice edges `:o2`), `UF:s` / `:s2`… = anywhere in its group with any twist. Centers `U L F R B D`: none listed = all six kept, otherwise only the listed ones (e.g. Roux first block `L DL FL BL DFL DBL` with M allowed). *Full cube* solves everything.
- **Bottom face**: which faces may go on the bottom (plus *any front* for y turns). Every grip is searched and the shortest answer wins; it starts with the rotation to do first (e.g. `x2 L D R D`).
- **Offsets**: the goal also counts when the cube is off by one of these moves, e.g. `D D2 D'` (*ADF*) for a pseudo-cross or `U U2 U'` (*AUF*) for a last-layer step. Spaces separate one-move offsets; use commas when an offset has several moves (`U D, U2`). No offset is always tried too; every grip × offset pair is searched (repeats skipped) and the shortest wins. The solution leaves the offset in: the result shows it with the moves that undo it, and a next step needs the same offsets (or those undo moves first).
- **Moves allowed**: face turns plus M, E, S. If a step keeps centers that are out of place and its moves can't bring them home, it stops with a message instead of searching forever.

## Folder layout

| Path | What's in it |
| --- | --- |
| `src/engine.ts` | Cube engine: piece names, goal masks, solvers, goal check. No page code, so it can move to another app. |
| `src/main.ts` | Test bench page logic |
| `src/index.html`, `src/index.css` | Test bench page |
| `script/build.js` | Dev server and build (barely-a-dev-server + esbuild) |

## Browser support

Needs a modern browser (roughly iOS/Safari 15.4+, recent Chrome, Edge or Firefox), because cubing.js uses Web Workers, WebAssembly and WebGL.
