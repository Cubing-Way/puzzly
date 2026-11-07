// The 2x2x2's example methods (node bench/out/cube2-methods.js): every method in src/demo/example-methods-2x2x2.json on seeded scrambles through the real engine and search worker,
// each run replayed to the whole puzzle solved and never shorter than the fewest moves, each step as found with the face the D corners end on (the first face or layer on D), and a method file's puzzle
// checked by readMethod. Exits with code 1 when a check fails. COUNT=n scrambles (default 10), ONLY=text runs only the methods whose name has it
import { inProcessWorker, random, scramble } from "./setup";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import * as engine from "../src/engine/index.ts";
import examples from "../src/demo/example-methods-2x2x2.json";
import examples3x3x3 from "../src/demo/example-methods.json";

import { heldPattern } from "../src/engine/core/puzzle.ts";

const { loadEngine, CUBE2, readMethod, runMethod, reachesGoal, solveStep, countMoves, joinMoves, goalFromText } = engine;

// How many seeded scrambles, and which methods
const COUNT = Number(process.env.COUNT ?? 10);
const ONLY = process.env.ONLY ?? "";
// Checks that failed
const failures: string[] = [];
// Note a failed check
function fail(text: string): void {
  failures.push(text);
  console.log(`FAIL ${text}`);
}

// Seeded face-turn scrambles of all six faces (as cubing.js's 222 scrambles have)
const rand = random(3);
const scrambles = Array.from({ length: COUNT }, () => scramble(rand, 20));
runSearchWorker({ wasm });
await loadEngine({ searchWorker: inProcessWorker, wasm, puzzle: CUBE2 });

// A method file's puzzle: the 2x2x2's examples read with it kept (name, puzzle, steps in that order), a 3x3x3 method (no puzzle) and an unknown puzzle refused
const read = readMethod(examples[0]);
if (Object.keys(read).join(" ") !== "name puzzle steps" || read.puzzle !== "2x2x2") fail(`readMethod 2x2x2 example: ${Object.keys(read).join(" ")} puzzle ${read.puzzle}`);
for (const [label, data] of [["3x3x3 example", examples3x3x3[0]], ["unknown puzzle", { ...examples[0], puzzle: "9x9x9" }]] as const) {
  try {
    readMethod(data);
    fail(`readMethod ${label}: read on the 2x2x2`);
  } catch (error) {
    console.log(`readMethod ${label}: ${(error as Error).message}`);
  }
}

// The fewest moves for the whole puzzle on each scramble (all corners with R U F: every orientation counts, so this is the puzzle's fewest)
const ALL = "UFR UBR UBL UFL DFR DFL DBL DBR";
const fewest = await Promise.all(scrambles.map(async (scrambled) => countMoves((await solveStep(scrambled, ALL, { generatorMoves: ["U", "R", "F"] })).solution.toString())));
console.log(`fewest moves: mean ${(fewest.reduce((sum, value) => sum + value, 0) / COUNT).toFixed(1)}, longest ${Math.max(...fewest)}`);

// The puzzle as held after these moves (pieces named for the grip the run holds it in): the face the four D corners fill, "D" when they're on D ("" = none, e.g. mid-layer)
function dFace(scrambled: string, moves: string): string {
  const corners = heldPattern(scrambled, moves).patternData.CORNERS;
  // Spots of each face as held, in the corner order UFR UBR UBL UFL DFR DFL DBL DBR
  const faces: Record<string, number[]> = { U: [0, 1, 2, 3], D: [4, 5, 6, 7], F: [0, 3, 4, 5], B: [1, 2, 6, 7], R: [0, 1, 4, 7], L: [2, 3, 5, 6] };
  const down = faces.D;
  return Object.entries(faces).find(([, spots]) => spots.every((spot) => down.includes(corners.pieces[spot])))?.[0] ?? "";
}

// The D corners' spot numbers, and whether a step's goal makes them a face or a layer: each solved or in place, or in an orient group of D corners alone
const D_CORNERS = [4, 5, 6, 7];
function makesFace(pieces: string): boolean {
  const roles = goalFromText(pieces).CORNERS ?? {};
  return D_CORNERS.every((spot) => {
    const role = roles[spot];
    if (role === "solve" || role === "place") return true;
    return Boolean(role?.startsWith("orient")) && Object.entries(roles).every(([piece, other]) => other !== role || D_CORNERS.includes(Number(piece)));
  });
}

for (const data of examples) {
  if (ONLY && !data.name.includes(ONLY)) continue;
  const method = readMethod(data);
  const lengths: number[] = [];
  const begun = performance.now();
  for (const [at, scrambled] of scrambles.entries()) {
    // Each step as it was found, before steps that cancel are written as one (on R U F they often do): its moves, its answer, and the face the D corners are on after it
    const found: string[] = [];
    // The face the D corners are on after the first step that makes them a face or a layer ("" until one does)
    let firstFace = "";
    const run = await runMethod(scrambled, method, {
      onStep: (row) => {
        const face = dFace(scrambled, joinMoves(row.done, row.solution.toString()));
        if (!firstFace && makesFace(row.pieces)) firstFace = face || "-";
        found.push(`${row.name}:${row.moves} "${row.solution}" [${face || "-"}]`);
      },
    });
    if (!run.ok) fail(`${method.name} #${at}: a step didn't reach its goal`);
    if (firstFace !== "D") fail(`${method.name} #${at}: the first face or layer ends on ${firstFace || "no step"}, not D`);
    if (!reachesGoal(scrambled, run.solution, null)) fail(`${method.name} #${at}: "${run.solution}" isn't the whole puzzle solved`);
    if (run.moves < fewest[at]) fail(`${method.name} #${at}: ${run.moves} moves, fewer than the puzzle's fewest ${fewest[at]}`);
    lengths.push(run.moves);
    console.log(`${method.name} #${at}: ${run.moves} moves | ${found.join(" | ")}`);
  }
  console.log(`== ${method.name}: mean ${(lengths.reduce((sum, value) => sum + value, 0) / lengths.length).toFixed(1)} moves, longest ${Math.max(...lengths)}, ${((performance.now() - begun) / 1000).toFixed(1)} s`);
}

console.log(failures.length ? `${failures.length} checks failed` : "every check passed");
process.exit(failures.length ? 1 : 0);
