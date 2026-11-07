// The 2x2x2 check (node bench/out/cube2.js, plan-puzzles.md Part 2): steps on 20 seeded scrambles through the real engine and search worker, every answer
// replayed by reachesGoal, the whole puzzle against cubing.js's solver, and the same corner-only goals on today's 3x3x3 engine. Exits with code 1 when a check fails
import { inProcessWorker, random, scramble } from "./setup";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import * as engine from "../src/engine/index.ts";

const { loadEngine, switchPuzzle, CUBE2, CUBE3, solveStep, solveFull, reachesGoal, countMoves, gripRotations, readMethod, runMethod, searchMethod, randomScramble, parseMoves } = engine;

// How many seeded scrambles (COUNT=n for fewer)
const COUNT = Number(process.env.COUNT ?? 20);
// Checks that failed
const failures: string[] = [];
// Note a failed check
function fail(text: string): void {
  failures.push(text);
  console.log(`FAIL ${text}`);
}

// The goals, named only by corners (the 2x2x2's names are the 3x3x3's); each holds the DBL corner, which R U F never move
const ALL = "UFR UBR UBL UFL DFR DFL DBL DBR";
const GOALS: Record<string, string> = {
  "all corners": ALL,
  layer: "DFR DFL DBL DBR",
  face: "DFR:o DFL:o DBL:o DBR:o",
  "orient all": ALL.split(" ").map((name) => `${name}:o`).join(" "),
};
// R U F as held, R U F in any grip (every bottom face, any front), all six faces as held
const ANY_GRIP = gripRotations(["D", "U", "F", "B", "R", "L"], true);
const WAYS: Record<string, engine.StepOptions> = {
  "RUF": { generatorMoves: ["U", "R", "F"] },
  "RUF any grip": { generatorMoves: ["U", "R", "F"], rotations: ANY_GRIP },
  "six faces": { generatorMoves: ["U", "R", "F", "D", "L", "B"] },
};

// A scramble's L D B written as R U F with a rotation (on the corners L = R x', D = U y', B = F z'): the same pieces, and its rotations say how it's held
function asRUF(text: string): string {
  const swaps: Record<string, [string, string]> = { L: ["R", "x"], D: ["U", "y"], B: ["F", "z"] };
  return text
    .split(" ")
    .map((move) => {
      const swap = swaps[move[0]];
      if (!swap) return move;
      // The rotation turns the other way: L' = R' x, L2 = R2 x2
      const amount = move.slice(1);
      return `${swap[0]}${amount} ${swap[1]}${amount === "'" ? "" : amount === "2" ? "2" : "'"}`;
    })
    .join(" ");
}

// A rotation written with outer turns only (x = R L', y = U D', z = F B'): on a 3x3x3 it turns the corners as the rotation does and leaves the centers
function asOuterTurns(rotation: string): string {
  const pairs: Record<string, [string, string]> = { x: ["R", "L"], y: ["U", "D"], z: ["F", "B"] };
  return rotation
    .split(" ")
    .filter(Boolean)
    .map((move) => {
      const [near, far] = pairs[move[0]];
      const amount = move.slice(1);
      return `${near}${amount} ${far}${amount === "'" ? "" : amount === "2" ? "2" : "'"}`;
    })
    .join(" ");
}

// Seeded face-turn scrambles of all six faces (L D B too, as cubing.js's 222 scrambles have)
const rand = random(2);
const scrambles = Array.from({ length: COUNT }, () => scramble(rand, 20));
runSearchWorker({ wasm });
await loadEngine({ searchWorker: inProcessWorker, wasm, puzzle: CUBE2 });
const kpuzzle = await CUBE2.kpuzzle();
// Each scramble three ways: as made, rewritten as R U F with rotations, and with the outer turns that bring the DBL corner home (so R U F as held can solve it on a 3x3x3 too)
const writings = scrambles.map((text) => {
  const rewritten = asRUF(text);
  if (!kpuzzle.defaultPattern().applyAlg(text).isIdentical(kpuzzle.defaultPattern().applyAlg(rewritten))) fail(`rewriting "${text}" as "${rewritten}" moves other pieces`);
  const home = ANY_GRIP.find((grip) => {
    const corners = kpuzzle.defaultPattern().applyAlg(text).applyAlg(grip).patternData.CORNERS;
    return corners.pieces[6] === 6 && corners.orientation[6] === 0;
  })!;
  return { made: text, rewritten, homed: `${text} ${asOuterTurns(home)}`.trim() };
});

// One step's answer length (a rotation doesn't count), or "x" when it has none; fails when the answer doesn't replay
async function length(scrambled: string, pieces: string, options: engine.StepOptions, label: string): Promise<number | "x"> {
  try {
    const r = await solveStep(scrambled, pieces, options);
    const solution = r.solution.toString();
    if (!reachesGoal(scrambled, solution, r.pieces)) fail(`${label}: "${solution}" doesn't reach ${pieces}`);
    return countMoves(solution);
  } catch {
    return "x";
  }
}

// Every goal × way on some writings of each scramble, on the active puzzle: lengths by "goal / way / writing / scramble number"
async function lengths(puzzleName: string, which: ("made" | "rewritten" | "homed")[], ways = Object.keys(WAYS)): Promise<Map<string, number | "x">> {
  const found = new Map<string, number | "x">();
  const begun = performance.now();
  for (let at = 0; at < COUNT; at++) {
    const row: string[] = [];
    for (const [goalName, pieces] of Object.entries(GOALS)) {
      for (const wayName of ways) {
        for (const writing of which) {
          const value = await length(writings[at][writing], pieces, WAYS[wayName], `${puzzleName} ${goalName} / ${wayName} / ${writing} #${at}`);
          found.set(`${goalName} / ${wayName} / ${writing} / ${at}`, value);
          row.push(String(value));
        }
      }
    }
    console.log(`${puzzleName} #${at}: ${row.join(" ")}`);
  }
  console.error(`(${puzzleName}: ${((performance.now() - begun) / 1000).toFixed(1)} s)`);
  return found;
}

const key = (goal: string, way: string, writing: string, at: number) => `${goal} / ${way} / ${writing} / ${at}`;
console.log(`per scramble, each goal × way as made, rewritten, homed: ${Object.keys(GOALS).flatMap((goal) => Object.keys(WAYS).map((way) => `${goal} / ${way}`)).join(", ")}`);

// The 2x2x2: every goal, way and writing
const small = await lengths("2x2x2", ["made", "rewritten", "homed"]);
for (let at = 0; at < COUNT; at++) {
  for (const goal of Object.keys(GOALS)) {
    for (const way of Object.keys(WAYS)) {
      for (const writing of ["made", "rewritten", "homed"]) if (small.get(key(goal, way, writing, at)) === "x") fail(`2x2x2 ${key(goal, way, writing, at)}: no answer`);
      // Any orientation counts, so how the scramble is written can't matter where the names and moves don't depend on it: every grip tried, or all six faces
      // (the outer turns that home DBL rename no piece; the rewriting's rotations do, so it only counts with every grip, or when every piece is in the goal)
      const compared = way === "RUF any grip" || goal === "all corners" ? ["made", "rewritten", "homed"] : way === "six faces" ? ["made", "homed"] : [];
      const lengthsHere = compared.map((writing) => small.get(key(goal, way, writing, at)));
      if (new Set(lengthsHere).size > 1) fail(`2x2x2 ${goal} / ${way} #${at}: ${lengthsHere.join(" ")} as ${compared.join(", ")}`);
    }
  }
}

// The whole puzzle: "all corners" with R U F as held needs at most 11 moves (one exact table of 3,674,160 states) and is never longer than cubing.js's answer
let longest = 0;
let shorter = 0;
for (let at = 0; at < COUNT; at++) {
  const made = scrambles[at];
  const r = await solveStep(made, ALL, WAYS.RUF);
  const ours = countMoves(r.solution.toString());
  const theirs = (await solveFull(made)).toString();
  if (!reachesGoal(made, r.solution.toString(), null)) fail(`all corners #${at}: "${r.solution}" isn't the whole puzzle solved`);
  if (!reachesGoal(made, theirs, null)) fail(`cubing.js's answer #${at} "${theirs}" doesn't solve it`);
  if (ours > 11) fail(`all corners #${at}: ${ours} moves, more than 11`);
  if (ours > countMoves(theirs)) fail(`all corners #${at}: ${ours} moves, longer than cubing.js's ${countMoves(theirs)}`);
  if (ours < countMoves(theirs)) shorter++;
  longest = Math.max(longest, ours);
  console.log(`full #${at}: engine ${ours} "${r.solution}", cubing.js ${countMoves(theirs)} "${theirs}"`);
}
console.log(`all corners with R U F as held: longest ${longest} moves, ${shorter} of ${COUNT} shorter than cubing.js's answer`);

// By speed, a method, a scramble from cubing.js, moves the 2x2x2 doesn't have, a solve the whole-puzzle check must refuse
const first = scrambles[0];
// By speed with the page's hand turns (wide, slice and rotations about x and z): the 2x2x2 has no wide or slice turns, so no answer may be written with them
const handTurns = { wideAxes: ["x", "z"], sliceAxes: ["x", "z"], rotationAxes: ["x", "z"] };
for (const [name, pieces] of [["layer", GOALS.layer], ["all corners", ALL]]) {
  const fast = await solveStep(first, pieces, { ...WAYS["RUF any grip"], rank: "speed", extraMoves: 1, ...handTurns });
  const written = fast.wide ?? fast.solution.toString();
  if (!reachesGoal(first, fast.solution.toString(), fast.pieces) || !reachesGoal(first, parseMoves(written), fast.pieces)) fail(`${name} by speed: "${written}" doesn't reach it`);
  console.log(`${name} by speed #0: ${countMoves(fast.solution.toString())} "${fast.solution}"${fast.wide ? ` written "${fast.wide}"` : ""} speed ${fast.speed?.toFixed(2)}`);
}
// Methods for the 2x2x2 say so (readMethod refuses a method for another puzzle, and one without a puzzle is the 3x3x3's)
const method = readMethod({
  name: "Layer then the rest",
  puzzle: "2x2x2",
  steps: [
    { name: "Layer", pieces: GOALS.layer, grips: { bottom: ["D", "U", "F", "B", "R", "L"], anyFront: true }, rank: "speed", extraMoves: 1 },
    { name: "Rest", pieces: ALL, keep: true, rank: "speed", extraMoves: 1 },
  ],
});
for (let at = 0; at < Math.min(3, COUNT); at++) {
  const run = await runMethod(scrambles[at], method);
  if (!run.ok || !reachesGoal(scrambles[at], run.solution, null)) fail(`method #${at}: "${run.solution}" not ok`);
  console.log(`method #${at}: ${run.moves} moves ok ${run.ok} [${run.steps.map((row) => `${row.name}:${row.moves}`).join(" ")}] "${run.solution}"`);
}
// The method search (its later goals are measured from each start, every orientation the start can end in): a layer then the rest, fewest moves
const twoSteps = readMethod({ name: "Layer, rest", puzzle: "2x2x2", steps: [{ name: "Layer", pieces: GOALS.layer }, { name: "Rest", pieces: ALL, keep: true }] });
const found = await searchMethod(first, twoSteps, { budgetMs: 120_000 });
if (!found.best?.ok || !reachesGoal(first, found.best.solution, null)) fail(`method search #0: "${found.best?.solution}" not ok`);
if (found.best && found.best.moves < countMoves((await solveStep(first, ALL, WAYS.RUF)).solution.toString())) fail(`method search #0: ${found.best.moves} moves, shorter than the whole puzzle's fewest`);
console.log(`method search #0: best ${found.best?.moves} moves "${found.best?.solution}" optimal ${found.optimal} bound ${found.bound} states ${found.states}`);
const random222 = await randomScramble();
console.log(`randomScramble: ${countMoves(parseMoves(random222))} moves`);
for (const text of ["M", "Rw", "E2"]) {
  try {
    parseMoves(text);
    fail(`parseMoves "${text}" takes a move the 2x2x2 doesn't have`);
  } catch (error) {
    console.log(`parseMoves "${text}": ${(error as Error).message}`);
  }
}
if (reachesGoal("R U", "U'", null)) fail(`whole-puzzle check takes "R U U'" as solved`);
if (!reachesGoal("R L'", "x'", null) || !reachesGoal("R L'", "", null)) fail(`whole-puzzle check refuses "R L'" (the solved puzzle turned like x)`);

// The cross-check: today's 3x3x3 engine on the same corner-only goals. With the DBL corner home, R U F as held must give the same lengths (both judge from the same corners,
// and no other orientation is open to R U F); the 3x3x3 keeps its centers where they are, so other ways may only be longer than the 2x2x2's any-orientation answers
await switchPuzzle(CUBE3);
const big = await lengths("3x3x3", ["homed"]);
let same = 0;
let longer = 0;
for (const [at] of scrambles.entries()) {
  for (const goal of Object.keys(GOALS)) {
    for (const way of Object.keys(WAYS)) {
      const [ours, theirs] = [small.get(key(goal, way, "homed", at)), big.get(key(goal, way, "homed", at))];
      if (way === "RUF") {
        if (ours === theirs) same++;
        else fail(`cross-check ${goal} / ${way} #${at}: 2x2x2 ${ours}, 3x3x3 ${theirs}`);
      } else if (theirs !== "x" && (ours === "x" || ours > theirs)) fail(`cross-check ${goal} / ${way} #${at}: 2x2x2 ${ours} longer than the 3x3x3's ${theirs}`);
      else if (theirs === "x" || theirs > (ours as number)) longer++;
    }
  }
}
console.log(`cross-check: ${same} of ${COUNT * Object.keys(GOALS).length} R U F lengths the same; with other ways the 3x3x3's was longer (or none) ${longer} times`);

console.log(failures.length ? `${failures.length} checks failed` : "every check passed");
process.exit(failures.length ? 1 : 0);
