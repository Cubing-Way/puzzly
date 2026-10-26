// Batch benchmark: reviews of seeded CFOP solves, each one solveStep per step of CFOP level 1 from where the solve stood (7 calls), first on one engine
// (its search worker with helpers, as on the page) one call after another, then through runBatch on several engines in threads (bench/out/engine.js);
// each twice (the first pass builds the tables), with every answer checked to be the same
// Usage: node bench/out/batch.js [solves, default 8] [engines, default 4]
import { random, scramble, inProcessWorker } from "./setup";
import { nodeEngineWorker, nodeHelper, nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, readMethod, runBatch, solveStep, type BatchCall, type StepResult } from "../src/engine/index.ts";
import { avoided, handTurns, methodStepOptions, nextStep, piecesAfter, runMethodRows } from "../src/engine/method/run.ts";
import examples from "../src/demo/example-methods.json";
import { availableParallelism } from "node:os";

const [solveCount = "8", engineCount = "4"] = process.argv.slice(2);
// The engine on this thread gets helpers as the page's would: one per thread beyond its own, up to 3
Object.defineProperty(navigator, "hardwareConcurrency", { value: availableParallelism(), configurable: true });
runSearchWorker({ wasm, helper: nodeHelper });
await loadEngine({ searchWorker: inProcessWorker, scoringWorker: nodeScoringWorker, engineWorker: nodeEngineWorker, engines: Number(engineCount), wasm });

// The solves to review: CFOP level 1 played on seeded scrambles, each step's call made from where the solve stood (as runMethod makes it)
const method = readMethod((examples as any[])[0]);
const rand = random(77);
const reviews: BatchCall[][] = [];
for (let i = 0; i < Number(solveCount); i++) {
  const s = scramble(rand);
  const { steps } = await runMethodRows(s, method);
  let earlier = {};
  const calls: BatchCall[] = [];
  for (const result of steps) {
    const step = method.steps[result.step];
    const next = nextStep(method, result.step);
    const options = { ...methodStepOptions(step, result.done, earlier, undefined, next), ...(next ? {} : { last: true }), rank: step.rank, extraMoves: step.extraMoves ?? 0, avoid: avoided(step), ...handTurns(step) };
    calls.push({ call: "solveStep", args: [s, step.pieces, options] });
    earlier = piecesAfter(earlier, result);
  }
  reviews.push(calls);
}
const callCount = reviews.flat().length;

// Time one way of answering every review, and give each call's moves (or its error)
async function timed(name: string, answer: () => Promise<string[]>): Promise<string[]> {
  const started = performance.now();
  const moves = await answer();
  const s = (performance.now() - started) / 1000;
  console.log(`${name}: ${s.toFixed(1)} s, ${(s / reviews.length).toFixed(2)} s a review (${reviews.length} reviews, ${callCount} calls)`);
  return moves;
}

// One engine: every call one after another
const oneEngine = async () => {
  const moves: string[] = [];
  for (const { args } of reviews.flat()) {
    const [s, pieces, options] = args as Parameters<typeof solveStep>;
    moves.push(await solveStep(s, pieces, options).then((result) => result.solution.toString(), (error) => `ERROR ${error.message}`));
  }
  return moves;
};
// Batch: each review one job, on whichever engine is free
const batch = async () =>
  (await runBatch(reviews)).flat().map((settled) => (settled.status === "fulfilled" ? (settled.value as StepResult).solution.toString() : `ERROR ${settled.reason.message}`));

for (let pass = 1; pass <= 2; pass++) {
  const one = await timed(`pass ${pass} one engine`, oneEngine);
  const many = await timed(`pass ${pass} batch, ${engineCount} engines`, batch);
  const same = one.filter((moves, index) => moves === many[index]).length;
  const errors = [...one, ...many].filter((moves) => moves.startsWith("ERROR")).length;
  console.log(`pass ${pass}: same answers ${same} of ${callCount}${errors ? `, ${errors} errors` : ""}`);
}
process.exit(0);
