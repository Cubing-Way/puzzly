// Known algs against the engine (bench/out/known-algs.js): each alg solvers agree on is undone on a solved cube and given back as a step ranked by speed.
// Says whether the engine's pick is the known alg as written, its turns in another writing, or another alg, and how the known one scores
// Usage: node bench/out/known-algs.js [groups: f2l,oll,pll; default f2l,oll] [extra moves, default 2] [case names to run, a regular expression]
// PATCH='{"tilt":1}' tries other numbers of the hand model (whole objects for layers and such)
import { inProcessWorker } from "./setup";
import { nodeHelper } from "./node-helper";
import { CASES } from "./known-cases";
import { toFaces, canon, inverse } from "./faces";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, stepCandidates, reachesGoal, countMoves, speedCost, FACE_MOVES, HANDS, type SearchWorker } from "../src/engine/index.ts";
import { stepCombos } from "../src/engine/step/step-combos";
import { askWorker } from "../src/engine/worker/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Numbers of the hand model to try, before anything is scored
if (process.env.PATCH) Object.assign(HANDS, JSON.parse(process.env.PATCH));
// Command line: which groups, how many extra moves a step may list, and which cases
const [groups = "f2l,oll", maxExtra = "2", only = ""] = process.argv.slice(2);

// The worker's answers, kept between runs next to the bundle: they depend on the cube and the goal, never on the speed model, so a second run asks nothing
const CACHE = fileURLToPath(new URL("./known-algs-cache.json", import.meta.url));
const cache = new Map<string, any>(existsSync(CACHE) ? Object.entries(JSON.parse(readFileSync(CACHE, "utf8"))) : []);
// Requests the worker really had to answer since the cache was last saved
let asked = 0;

// The in-process search worker behind the cache: a request seen before is answered from it
function cachingWorker(): SearchWorker {
  const inner = inProcessWorker();
  const keys = new Map<number, string>();
  const outer: SearchWorker = {
    onmessage: null,
    onerror: null,
    postMessage(message: any) {
      // A request's key is everything but its number and the puzzle
      const { id, kpuzzle: _, ...rest } = message;
      const key = JSON.stringify(rest);
      const known = cache.get(key);
      if (known) return void setImmediate(() => outer.onmessage?.({ data: { ...known, id } }));
      asked++;
      keys.set(id, key);
      inner.postMessage(message);
    },
    terminate() {},
  };
  // Answers are kept (table progress and errors aren't) and passed on
  inner.onmessage = ({ data }) => {
    if (!data.progress && !data.error) cache.set(keys.get(data.id)!, data);
    outer.onmessage?.({ data });
  };
  return outer;
}
runSearchWorker({ wasm, helper: nodeHelper });
await loadEngine({ searchWorker: cachingWorker, workerIdleMs: 3_600_000, wasm });

// Goals: the first two layers, those with the last layer turned right, and the whole cube
const F2L = "DF DR DB DL DFR FR DFL FL DBR BR DBL BL";
const GOALS = { f2l: F2L, oll: `${F2L} UF:o UR:o UB:o UL:o UFR:o UBR:o UBL:o UFL:o`, pll: `${F2L} UF UR UB UL UFR UBR UBL UFL` };
// A known alg as the engine writes it (Rw for r)
const engineText = (alg: string) => alg.replace(/\b([rludfb])(?=[2']?(\s|$))/g, (letter) => `${letter.toUpperCase()}w`);
// How the engine is asked: with wide and slice turns about x (the test bench's default), and with any front and every axis
const SETUPS: Record<string, object> = { x: { wideAxes: ["x"] }, full: { rotations: ["", "y", "y'", "y2"], wideAxes: ["x", "y", "z"] } };
// What a pick is: the known alg as written, its turns in another writing, another alg scored faster than every known one, or another alg that isn't
type Kind = "written" | "same" | "faster" | "other";
const KINDS: Record<Kind, string> = { written: "known alg as written", same: "its turns, another writing", faster: "another alg, scored faster", other: "another alg, not faster" };
// Per group and setup, how many picks of each kind
const counts = new Map<string, Record<Kind, number>>();
const details: string[] = [];

for (const item of CASES) {
  if (!groups.split(",").includes(item.group) || (only && !new RegExp(only).test(item.name))) continue;
  const started = performance.now();
  // The case: the first alg undone; its last move counts as done before the step, so a rotation costs as in the middle of a solve
  const known = toFaces(item.algs[0]).faces;
  const setup = inverse(known).split(" ");
  const [scramble, done] = [setup.slice(0, -1).join(" "), setup.at(-1)!];
  const pieces = GOALS[item.group];
  // Each known alg with its score as written
  const algs = item.algs.map((alg) => ({ alg, written: speedCost(alg) }));
  const fastest = Math.min(...algs.map((alg) => alg.written));
  try {
    if (!reachesGoal(scramble, `${done} ${known}`, pieces, [""], [])) throw new Error("the alg doesn't solve its own case");
    // The shortest answer as held, and how much longer the known alg is: a step only finds it with that many extra moves
    const options = { generatorMoves: FACE_MOVES, done };
    const { queue } = await stepCombos(scramble, pieces, options);
    const first = await askWorker({ kind: "search", start: queue[0].start, targets: queue[0].targets, moves: FACE_MOVES });
    const shortest = countMoves(first.moves ?? "");
    const needs = countMoves(known) - shortest;
    const extra = Math.min(Number(maxExtra), Math.max(needs, 0));
    // Every answer up to that length: is the known alg among them
    const listed = await askWorker({ kind: "list", start: queue[0].start, targets: queue[0].targets, moves: FACE_MOVES, maxDepth: shortest + extra + 1, maxAnswers: 200000 });
    const among = (listed.answers ?? []).some((moves) => canon(moves) === known);
    // The engine's pick by speed in each setup
    const picks: string[] = [];
    for (const [label, more] of Object.entries(SETUPS)) {
      const [result] = await stepCandidates(scramble, pieces, { ...options, ...more, rank: "speed", extraMoves: extra, maxCandidates: 1 });
      const moves = result.wide ?? result.solution.toString();
      const speed = speedCost(moves);
      const kind: Kind = item.algs.some((alg) => engineText(alg) === moves) ? "written" : toFaces(moves).faces === known ? "same" : speed < fastest ? "faster" : "other";
      const key = `${item.group} ${label}`;
      counts.set(key, { ...(counts.get(key) ?? { written: 0, same: 0, faster: 0, other: 0 }), [kind]: (counts.get(key)?.[kind] ?? 0) + 1 });
      picks.push(`${label}: ${KINDS[kind]}, ${speed} ${moves}`);
    }
    const line = `${item.name}: ${needs} longer than the shortest, ${among ? "listed" : `not listed with ${extra} extra`} | known ${algs.map((alg) => `${alg.written} ${alg.alg}`).join(" / ")}\n   ${picks.join("\n   ")}`;
    console.log(`${line} (${(performance.now() - started).toFixed(0)} ms)`);
    // Cases where a setup's pick isn't the known alg as written are listed again at the end
    if (picks.some((pick) => !pick.includes(KINDS.written))) details.push(line);
  } catch (error) {
    console.log(`${item.name}: ERROR ${(error as Error).message}`);
  }
  // Save what the worker answered for this case
  if (asked) writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache)));
  asked = 0;
}

// Totals per group and setup, then the cases to look at
console.log("\n=== Totals");
for (const [key, kinds] of counts) console.log(`${key}: ${(Object.keys(KINDS) as Kind[]).map((kind) => `${KINDS[kind]} ${kinds[kind]}`).join(", ")}`);
console.log(`\n=== Picks that aren't the known alg as written (${details.length})\n${details.join("\n")}`);
process.exit(0);
