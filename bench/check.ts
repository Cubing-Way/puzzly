// The check (npm run check, bench/out/check.js): a fixed list of scenarios on seeded scrambles through the real engine and search worker, one printed
// line per result, plus a hash of every request the engine sent the worker. 3x3x3 answers never change, so the lines must be the very ones in
// bench/check-baseline.txt: it says so at the end, or prints the lines that differ and exits with code 1 (WRITE_BASELINE=1 saves the lines as the new
// baseline). Times go to stderr, so they never count. No answer files are loaded (they're too big and not in git). ONLY=group1,group2 runs some groups
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inProcessWorker, random, scramble } from "./setup";
import { nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import * as engine from "../src/engine/index.ts";
import examples from "../src/demo/example-methods.json";

const { loadEngine, solveStep, stepCandidates, runMethod, searchMethod, readMethod, reachesGoal, countMoves, joinMoves, invertMoves, speedCost, goalFromText } = engine;
type StepOptions = engine.StepOptions;
type Method = engine.Method;

// Where the baseline is kept (next to this script's source, in git)
const BASELINE = new URL("../../bench/check-baseline.txt", import.meta.url);
// Groups to run (all by default)
const ONLY = process.env.ONLY?.split(",");

// Every request the engine sends the search worker is hashed, per group and in all (the request number left out)
const allHash = createHash("sha256");
let allCount = 0;
let groupHash = createHash("sha256");
let groupCount = 0;
// The search worker of this process, each request hashed on its way
function hashedWorker(): engine.SearchWorker {
  const worker = inProcessWorker();
  const post = worker.postMessage.bind(worker);
  worker.postMessage = (data: any) => {
    const { id: _, ...request } = data;
    const text = JSON.stringify(request);
    allHash.update(text);
    groupHash.update(text);
    allCount++;
    groupCount++;
    post(data);
  };
  return worker;
}

// The search worker runs in this process (one core, no helpers); the page scores (with the speed model in Rust) until the scoring worker group
runSearchWorker({ wasm });
await loadEngine({ searchWorker: hashedWorker, wasm });

// The lines printed so far
const lines: string[] = [];
// Print one result line
function say(text: string): void {
  lines.push(text);
  console.log(text);
}
// One result: its line, or its error's message (the engine's errors are part of what it answers)
async function result(name: string, run: () => unknown): Promise<void> {
  let text: string;
  try {
    text = String(await run());
  } catch (error) {
    text = `ERROR ${error instanceof Error ? error.message : String(error)}`;
  }
  say(`${name}: ${text}`);
}
// A group of results, timed on stderr, with its requests' count and hash
async function group(name: string, run: () => Promise<void>): Promise<void> {
  if (ONLY && !ONLY.includes(name)) return;
  groupHash = createHash("sha256");
  groupCount = 0;
  const begun = performance.now();
  await run();
  say(`requests ${name}: ${groupCount} ${groupHash.digest("hex").slice(0, 16)}`);
  console.error(`(${name}: ${((performance.now() - begun) / 1000).toFixed(1)} s)`);
}

// Seeded scrambles
function scrambles(seed: number, count: number): string[] {
  const rand = random(seed);
  return Array.from({ length: count }, () => scramble(rand));
}
// A number as it's printed (4 decimals at most)
const num = (value: number | undefined | null) => (value === undefined || value === null ? String(value) : String(+value.toFixed(4)));
// An example method by its name's start
function example(prefix: string): Method {
  return readMethod((examples as any[]).find((data) => data.name.startsWith(prefix)));
}

// A step result as one line: moves, solution (and its wide writing), grip, offset, alternative, searches, pieces, the alg it was answered from, its speed,
// and whether it really reaches the goal
function stepLine(scrambled: string, options: StepOptions, r: engine.StepResult): string {
  const done = options.done ?? "";
  const solution = r.solution.toString();
  const untouched = r.changed === undefined ? undefined : { from: joinMoves(done, r.rotation), changed: r.changed };
  const ok = reachesGoal(scrambled, joinMoves(done, solution), r.pieces, options.offsets ?? [""], options.solvableWith ?? [], untouched);
  return [
    `${countMoves(solution)} "${solution}"`,
    r.wide === undefined ? "" : `wide "${r.wide}"`,
    `rotation "${r.rotation}" offset "${r.offset}" alternative ${r.alternative} searches ${r.searches}`,
    `pieces "${r.pieces}" settled "${r.settled}"`,
    r.changed === undefined ? "" : `changed "${r.changed}"`,
    r.alg === undefined ? "" : `alg "${r.alg}"`,
    r.tier === undefined ? "" : `tier ${r.tier}`,
    r.speed === undefined ? "" : `speed ${num(r.speed)}`,
    `ok ${ok}`,
  ]
    .filter(Boolean)
    .join(" ");
}
// A method run as one line: moves, each step's name and moves (and its alg, lookahead total), the whole solve as the hands make it, its speed, and ok
function methodLine(r: engine.MethodResult): string {
  const steps = r.steps.map((row) => `${row.name}:${row.moves}${row.alg ? `(${row.alg})` : ""}${row.lookahead?.total != null ? `[${num(row.lookahead.total)}]` : ""}${row.ok ? "" : "!"}`);
  const hands = r.wide ?? r.solution;
  return `${r.moves} moves ok ${r.ok} [${steps.join(" ")}] "${hands}" speed ${num(speedCost(hands, undefined, true, r.starts))}`;
}

// Text helpers and their error messages: no search
await group("text", async () => {
  const json = (value: unknown) => JSON.stringify(value);
  await result("PIECE_NAMES", () => json(engine.PIECE_NAMES));
  await result("ORBIT_BY_LENGTH", () => json(engine.ORBIT_BY_LENGTH));
  await result("BOTTOM_TURNS", () => json(engine.BOTTOM_TURNS));
  await result("FRONT_TURNS", () => json(engine.FRONT_TURNS));
  await result("FACE_MOVES", () => json(engine.FACE_MOVES));
  await result("normalizeName rfu", () => engine.normalizeName("rfu"));
  await result("gripRotations D U any front", () => json(engine.gripRotations(["D", "U"], true)));
  await result("gripRotations all", () => json(engine.gripRotations(["D", "U", "F", "B", "R", "L"], false)));
  await result("parseGoalText", () => json(engine.parseGoalText("DF DR UF:o FR:o2 UFR:p L rfu:s ur:r2 DB:x bl:S3")));
  await result("parseGoalText typo", () => json(engine.parseGoalText("DF XY")));
  await result("parseGoalText long name", () => json(engine.parseGoalText("UFRB")));
  await result("parseGoalText bad role", () => json(engine.parseGoalText("UF:q")));
  await result("parseGoalText empty name", () => json(engine.parseGoalText(":p")));
  await result("roleFromSuffix", () => json(["", ":p", ":x", ":o", ":o2", ":S3", ":r", ":r12", ":q", ":o0"].map(engine.roleFromSuffix)));
  await result("roleSuffix", () => json((["solve", "place", "free", "orient1", "orient2", "swap3", "relative1", "relative4"] as engine.Role[]).map(engine.roleSuffix)));
  await result("splitAlternatives", () => json(engine.splitAlternatives("DF DR | DF DR DFR FR\n\n DB ")));
  await result("readAlternatives", () => json(engine.readAlternatives("DF DR | DF DR DFR FR")));
  await result("readAlternatives empty", () => json(engine.readAlternatives("", true)));
  await result("readAlternatives typo", () => json(engine.readAlternatives("DF | DF QQ")));
  await result("goalFromText", () => json(goalFromText("DF DR:o UFR:p")));
  await result("goalFromText no centers", () => json(goalFromText("DF DR", false)));
  await result("goalFromText some centers", () => json(goalFromText("L DL DFL")));
  await result("goalToText", () => engine.goalToText(goalFromText("BL DFR:p UF:o2 FR:r UR:x DF")));
  await result("goalToText centers", () => engine.goalToText(goalFromText("L R DL")));
  await result("goalToText whole", () => engine.goalToText(goalFromText("UF UR UB UL DF DR DB DL FR FL BR BL UFR UBR UBL UFL DFR DFL DBL DBR U L F R B D")));
  await result("mergeGoals", () => json(engine.mergeGoals(goalFromText("DFR:r FR:r DF"), goalFromText("DFL:r FL:r DF:p"))));
  await result("dropFree", () => json(engine.dropFree(goalFromText("UF UR:x UB:x"))));
  await result("goalOnCube", () => json(engine.goalOnCube("DFR FR", "x y", "R U")));
  await result("rotateGoal", () => json(engine.rotateGoal(goalFromText("DFR FR"), "y")));
  await result("stickeringMask", () => engine.stickeringMask("DF DR:o UFR:p FR:r UB:x", "R U F", "y"));
  await result("stickeringMask whole", () => engine.stickeringMask(null, "R U F"));
  await result("offsetsFromText", () => json(engine.offsetsFromText("D D2 D'")));
  await result("offsetsFromText commas", () => json(engine.offsetsFromText("U D, U2, U D")));
  await result("offsetsFromText rotation", () => json(engine.offsetsFromText("y")));
  await result("offsetsFromText typo", () => json(engine.offsetsFromText("D Q")));
  await result("offsetsToText", () => json([engine.offsetsToText(["", "D", "D2"]), engine.offsetsToText(["", "U D", "U2"])]));
  await result("solvableFromText", () => json(engine.solvableFromText("R, U2 r")));
  await result("solvableFromText rotation", () => json(engine.solvableFromText("R y")));
  await result("bufferFromText", () => json([engine.bufferFromText("uf"), engine.bufferFromText("RFU"), engine.bufferFromText("")]));
  await result("bufferFromText two", () => engine.bufferFromText("UF UR"));
  await result("bufferFromText center", () => engine.bufferFromText("U"));
  await result("parityFromText", () => engine.parityFromText("ufr ubr"));
  await result("parityFromText role", () => engine.parityFromText("UFR:p"));
  await result("parseMoves", () => engine.parseMoves("  R U R'  U' Rw M2 x "));
  await result("parseMoves typo", () => engine.parseMoves("R Q"));
  await result("countMoves", () => json(["R U2 x' R'", "(R U)2 y", "", "M E2 Rw x y z"].map(countMoves)));
  await result("joinSteps", () => json([engine.joinSteps("R U", "U' R'"), engine.joinSteps("R U", "U R"), engine.joinSteps("R", "y F'"), engine.joinSteps("R L", "R'"), engine.joinSteps("x'", "y x")]));
  await result("cancelInto", () => json([engine.cancelInto("F R U", "U' R2 D"), engine.cancelInto("R U", "F")]));
  await result("movesAfter", () => json([engine.movesAfter("U' R2 D", "F R U"), engine.movesAfter("F", "R U")]));
  await result("invertMoves", () => invertMoves("R U2 F' x Rw"));
  await result("toFaces", () => json(engine.toFaces("r U R' U' r' F R F' M2 x")));
  await result("reachesGoal", () =>
    json([
      reachesGoal("R U", "U' R'", "DF DR DB DL"),
      reachesGoal("R U", "U'", "DF DR DB DL"),
      reachesGoal("R U", "U' R' y", null),
      reachesGoal("D", "", "DF DR DB DL", ["", "D", "D2", "D'"]),
      reachesGoal("R U R'", "", "DL DFL DBL", [""], ["R", "U"]),
    ]),
  );
  await result("solveFull", async () => (await engine.solveFull("R U F' L2 D B' R2 U' F D2 L'", "y")).toString());
  await result("randomScramble", async () => (countMoves(await engine.randomScramble()) >= 15 ? "ok" : "short"));
  await result("readMethod", () => json(readMethod({ steps: [{ pieces: "DF DR" }, { name: "Pair", pieces: ["DFR FR", "DFL FL"], keep: true, grips: { bottom: ["d", "U"], anyFront: true }, moves: ["R", "U2"], avoid: "f b", wideAxes: "X z", algs: "oll" }] })));
  await result("readMethod no steps", () => json(readMethod({})));
  await result("readMethod bottom", () => json(readMethod({ steps: [{ pieces: "DF", grips: { bottom: ["Q"] } }] })));
  await result("readMethod moves", () => json(readMethod({ steps: [{ name: "Spin", pieces: "DF", moves: ["x"] }] })));
  await result("readMethod avoid", () => json(readMethod({ steps: [{ pieces: "DF", avoid: "M" }] })));
  await result("readMethod axes", () => json(readMethod({ steps: [{ pieces: "DF", wideAxes: "w" }] })));
  await result("readMethod algs", () => json(readMethod({ steps: [{ pieces: "DF", algs: "XLL" }] })));
  await result("readMethod buffer", () => json(readMethod({ steps: [{ pieces: "UF", buffer: "UF" }] })));
  await result("readMethod untouched", () => json(readMethod({ steps: [{ pieces: "UF:o", untouched: true }] })));
  await result("readMethod examples", () => (examples as any[]).map((data) => readMethod(data).steps.length).join(" "));
});

// Steps on two scrambles: one line per step and scramble
const FACE = ["U", "R", "F", "D", "L", "B"];
const CROSS = "DF DR DB DL";
const ANY_GRIP = engine.gripRotations(["D", "U", "F", "B", "R", "L"], true);
const ANY_FRONT = engine.gripRotations(["D"], true);
const D_OFFSETS = ["", "D", "D2", "D'"];
await group("step", async () => {
  for (const [at, scrambled] of scrambles(1, 2).entries()) {
    const run = (name: string, pieces: string, options: StepOptions) => result(`step ${name} #${at}`, async () => stepLine(scrambled, options, await solveStep(scrambled, pieces, options)));
    await run("cross", CROSS, { generatorMoves: FACE });
    await run("pseudo-cross any grip", CROSS, { generatorMoves: FACE, rotations: ANY_GRIP, offsets: D_OFFSETS });
    await run("cross or XCross", `${CROSS} | ${CROSS} DFR FR`, { generatorMoves: FACE, rotations: ANY_FRONT });
    await run("XXCross", `${CROSS} DFR FR DFL FL`, { generatorMoves: FACE });
    await run("relative pair", `${CROSS} DFR:r FR:r`, { generatorMoves: FACE });
    await run("EO", "UF:o UR:o UB:o UL:o DF:o DR:o DB:o DL:o FR:o FL:o BR:o BL:o", { generatorMoves: FACE });
    await run("Roux block with M", "L DL FL BL DFL DBL", { generatorMoves: [...FACE, "M"] });
    await run("CP line with R U", "DL DFL DBL UFR:p UBR:p UBL:p UFL:p DFR:p DBR:p", { generatorMoves: FACE, solvableWith: ["R", "U"] });
    await run("untouched 3-cycle", "UR UB UF:x", { generatorMoves: FACE, untouched: true });
    await run("buffer", "", { generatorMoves: FACE, buffer: "UF", targetsPerStep: 2, parity: "UFR UBR" });
    await run("max depth fails", CROSS, { generatorMoves: FACE, maxDepth: 3 });
    await run("first found", CROSS, { generatorMoves: FACE, rotations: ANY_FRONT, offsets: D_OFFSETS, firstFound: true });
    // A step after `done` that keeps the cross: the easiest pair, any front
    const cross = (await solveStep(scrambled, CROSS, { generatorMoves: FACE })).solution.toString();
    await run("pair after cross", "DFR FR | DFL FL | DBR BR | DBL BL", { generatorMoves: FACE, done: cross, keep: goalFromText(CROSS), rotations: ANY_FRONT });
    await run("faces avoided", "DFR FR", { generatorMoves: FACE, done: cross, keep: goalFromText(CROSS), avoid: ["F", "B"], extraMoves: 2 });
    await run("offset undone", CROSS, { generatorMoves: FACE, offsets: D_OFFSETS, undoOffset: true });
  }
});

// Every answer up to some extra moves, shortest first (by moves) or fastest first (by speed)
await group("candidates", async () => {
  for (const [at, scrambled] of scrambles(2, 2).entries()) {
    const list = (results: engine.StepResult[]) => results.map((r) => `${r.solution}${r.speed === undefined ? "" : ` (${num(r.speed)})`}`).join(" | ");
    await result(`candidates cross by moves #${at}`, async () => list(await stepCandidates(scrambled, CROSS, { generatorMoves: FACE, extraMoves: 1, maxCandidates: 8 })));
    await result(`candidates cross or XCross per alternative #${at}`, async () => list(await stepCandidates(scrambled, `${CROSS} | ${CROSS} DFR FR`, { generatorMoves: FACE, rotations: ANY_FRONT, extraMoves: 1, perAlternative: 3 })));
    await result(`candidates cross by speed #${at}`, async () => list(await stepCandidates(scrambled, CROSS, { generatorMoves: FACE, rotations: ANY_FRONT, rank: "speed", extraMoves: 1, maxCandidates: 6 })));
  }
});

// Ranked by speed: wide and slice writings (axes x z), tilts, and the last layer answered from the OLL and PLL alg sets
await group("speed", async () => {
  for (const [at, scrambled] of scrambles(3, 2).entries()) {
    const options: StepOptions = { generatorMoves: FACE, rotations: ANY_FRONT, rank: "speed", extraMoves: 1, wideAxes: ["x", "z"], sliceAxes: ["x", "z"], rotationAxes: ["x", "z"] };
    await result(`speed cross wide and slice #${at}`, async () => stepLine(scrambled, options, await solveStep(scrambled, CROSS, options)));
    const first = await solveStep(scrambled, CROSS, { generatorMoves: FACE });
    const pair: StepOptions = { ...options, done: first.solution.toString(), keep: goalFromText(CROSS), rotations: [""], avoid: ["F", "B"], extraMoves: 2, rotationAxes: ["x"] };
    await result(`speed pair wide and slice #${at}`, async () => stepLine(scrambled, pair, await solveStep(scrambled, "DFR FR", pair)));
  }
  // Last-layer cases (F2L solved): a step that does nothing (F2L), then CFOP's OLL and PLL steps, answered from their alg sets
  const cfop = example("CFOP level 1");
  const lastLayer: Method = { name: "Last layer", steps: [readMethod({ steps: [{ name: "F2L", pieces: `${CROSS} DFR FR DFL FL DBR BR DBL BL` }] }).steps[0], ...cfop.steps.filter((step) => step.algs)] };
  const cases = ["R U R' U R U2 R' U R U R' U' R' F R2 U' R' U' R U R' F'", "F R U R' U' F' U2 R U R' F' R U R' U' R' F R2 U' R' U", "R U2 R2 U' R2 U' R2 U2 R U' M2 U M2 U2 M2 U M2", "r U R' U' r' F R F' U R' U R' U' R' U' R' U R U R2"];
  for (const [at, alg] of cases.entries()) {
    await result(`speed last layer from alg sets #${at}`, async () => methodLine(await runMethod(invertMoves(alg), lastLayer)));
  }
});

// Every example method on one seeded scramble: as it is, but the ones that look ahead (CUT: 15–85 s a solve in all, 4.5 minutes), whose lookahead is left
// out and extra moves cut to 1, so the check stays a few minutes (the lookahead group runs CFOP level 2 in full)
const CUT = ["CFOP level 2", "CFOP level 3", "CFOP level 4", "CFOP level 5", "Pseudo-slotting", "CFOP with ZBLL", "CFCE"];
await group("examples", async () => {
  const [scrambled] = scrambles(5, 1);
  for (const data of examples as any[]) {
    const full = !CUT.some((prefix) => data.name.startsWith(prefix));
    const method = readMethod(full ? data : { ...data, steps: data.steps.map((step: any) => ({ ...step, lookahead: 0, extraMoves: Math.min(step.extraMoves ?? 0, 1), candidates: 0 })) });
    await result(`example ${data.name}${full ? "" : " (cut down)"}`, async () => methodLine(await runMethod(scrambled, method)));
  }
});

// The method search on a two-step method it can finish (two cross edges, then the cross)
await group("search", async () => {
  const method = readMethod({ name: "Two edges, cross", steps: [{ name: "Two edges", pieces: "DF DR", moves: FACE }, { name: "Cross", pieces: CROSS, keep: true, moves: FACE }] });
  for (const [at, scrambled] of scrambles(6, 2).entries()) {
    await result(`search two edges then cross #${at}`, async () => {
      const found = await searchMethod(scrambled, method, { budgetMs: 600_000 });
      return `best ${found.best ? methodLine(found.best) : "none"} seed ${found.seed} optimal ${found.optimal} bound ${found.bound} states ${found.states}`;
    });
  }
});

// A method ranked by speed with lookahead: one CFOP level 2 solve, scored on the page (random(77), as plan-speed's rules ask)
await group("lookahead", async () => {
  const [scrambled] = scrambles(77, 1);
  await result("lookahead CFOP level 2 #0", async () => methodLine(await runMethod(scrambled, example("CFOP level 2"))));
});

// The scoring worker in a thread: CFOP level 2's first pair, listed as the method asks it, scored on the page and then in the scoring worker (the same answers)
await group("scoring", async () => {
  const [scrambled] = scrambles(77, 1);
  const cfop = example("CFOP level 2");
  const cross = await solveStep(scrambled, CROSS, { generatorMoves: FACE, rotations: ANY_FRONT });
  const step = cfop.steps[1];
  const options: engine.CandidateOptions = {
    generatorMoves: step.moves,
    rotations: engine.gripRotations(step.grips.bottom, step.grips.anyFront),
    done: cross.solution.toString(),
    keep: goalFromText(cross.pieces),
    rank: "speed",
    extraMoves: step.extraMoves,
    avoid: (step.avoid ?? "").split(" ").filter(Boolean),
    wideAxes: ["x", "z"],
    sliceAxes: ["x", "z"],
    maxCandidates: step.candidates,
  };
  const list = (results: engine.StepResult[]) => results.map((r) => `${r.wide ?? r.solution} (${num(r.speed)})`).join(" | ");
  await result("scoring pair on the page", async () => list(await stepCandidates(scrambled, step.pieces, options)));
  await loadEngine({ scoringWorker: nodeScoringWorker });
  await result("scoring pair in the scoring worker", async () => list(await stepCandidates(scrambled, step.pieces, options)));
});

// The solve server's handler in this process, as server/check.ts runs it (no answer files here): one CFOP level 2 solve through the same JSON. Its search
// worker runs in this thread, apart from the one above, so its requests aren't hashed
await group("server", async () => {
  const { handler } = await import("../server/handler");
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const answer = await handler({ requestContext: { http: { method: init?.method ?? "GET" } }, body: init?.body as string });
    return new Response(answer.body, { status: answer.statusCode, headers: answer.headers });
  }) as typeof fetch;
  const server = engine.remoteEngine("http://local");
  const [scrambled] = scrambles(77, 1);
  await result("server CFOP level 2 #0", async () => methodLine(await server.runMethod(scrambled, example("CFOP level 2"))));
});

say(`requests all: ${allCount} ${allHash.digest("hex").slice(0, 16)}`);

// Against the baseline (or saved as the new one)
if (process.env.WRITE_BASELINE) {
  writeFileSync(BASELINE, lines.join("\n") + "\n");
  console.error(`Saved ${lines.length} lines as the baseline (bench/check-baseline.txt).`);
} else if (ONLY) {
  console.error("Some groups only: not compared with the baseline.");
} else if (!existsSync(BASELINE)) {
  console.error("No baseline yet: run with WRITE_BASELINE=1 to save these lines as one.");
} else {
  const baseline = readFileSync(BASELINE, "utf8").split("\n").filter(Boolean);
  const differ = [...Array(Math.max(baseline.length, lines.length)).keys()].filter((at) => baseline[at] !== lines[at]);
  if (!differ.length) console.error(`Same as the baseline: all ${lines.length} lines.`);
  else {
    console.error(`${differ.length} of ${lines.length} lines differ from the baseline:`);
    for (const at of differ.slice(0, 20)) console.error(`  line ${at + 1}\n    was: ${baseline[at] ?? "(none)"}\n    now: ${lines[at] ?? "(none)"}`);
    process.exit(1);
  }
}
// The engine's threads would keep the process alive (as in the benchmarks)
process.exit(0);
