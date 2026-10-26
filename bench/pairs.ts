// Pair answers prepared in advance (plan-speed Part 3, item 1): every case of one pair slot solved as a preset's pair step lists and scores it, written
// to a file. A case is where the front-right pair's corner and edge are (place and twist, place and flip) and which other slots are filled, with the
// cross solved: 383, 293, 215 and 149 cases with 0–3 other slots filled, 2,056 in all. A pair in another slot is one of these seen from another front:
// the step lists a slot's answers in the grip that has it at the front right (its first alternative's), and scores each in the other three as twins.
// Each case runs the step with its options (moves, grips, extra moves, faces to avoid, hand-turn axes) and goes on past the cap (pastCut), every listed
// answer scored (no bar). Only the target slot is asked for: the other free slots are named as done before (earlier), not kept, so no grip names them.
// Left out, worked out at the time instead: finding pieces (look), cancels into the moves before (previous); `done` is a U turn after the scramble
// undone, so the grip rotation counts as on any later step.
// Output: bench/out/pairs/<name>-<shard>.jsonl, a line of options then one per case: where the pieces are, the scramble, time, and every answer as
// [solution, wide writing or null, speed (turning cost), tier]. A run picks up where its file stops. Shards split the cases (case number % shards).
// PAST_CUT=0 lists as the step does without going on past the cap, into a file of its own (…-nocut-…), to compare with.
// Usage: node bench/out/pairs.js [shard, e.g. 0/2, default 0/1] [method index in example-methods.json, default 1 = CFOP level 2] [step name, default Pair 1]
import { inProcessWorker } from "./setup";
import { nodeHelper, nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, readMethod, stepCandidates, goalFromText, reachesGoal, joinMoves, countMoves } from "../src/engine/index.ts";
import { avoided, handTurns, methodStepOptions } from "../src/engine/method/run.ts";
import examples from "../src/demo/example-methods.json";
import { cube3x3x3 } from "cubing/puzzles";
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

runSearchWorker({ wasm, helper: nodeHelper });
await loadEngine({ searchWorker: inProcessWorker, scoringWorker: nodeScoringWorker, wasm });

const [shardText = "0/1", methodText = "1", stepName = "Pair 1"] = process.argv.slice(2);
const [shard, shards] = shardText.split("/").map(Number);
const method = readMethod((examples as any[])[Number(methodText)]);
const step = method.steps.find((each) => each.name === stepName);
if (!step) throw new Error(`no step "${stepName}" in ${method.name}`);
const pastCut = process.env.PAST_CUT !== "0";

// Slots: name, corner and edge numbers (cubing.js order), as goal text; the target is the first
const SLOTS = [
  { name: "FR", corner: 4, edge: 8, text: "DFR FR" },
  { name: "FL", corner: 5, edge: 9, text: "DFL FL" },
  { name: "BL", corner: 6, edge: 11, text: "DBL BL" },
  { name: "BR", corner: 7, edge: 10, text: "DBR BR" },
];
const [TARGET, ...OTHERS] = SLOTS;
const CROSS = { edges: [4, 5, 6, 7], text: "DF DR DB DL" };
const TOP = [0, 1, 2, 3];
const kpuzzle = await cube3x3x3.kpuzzle();

// Every case: each set of the other slots filled, then the target corner on each free place × twist and its edge on each free place × flip, less solved
const cases = [...Array(8).keys()].flatMap((mask) => {
  const filled = OTHERS.filter((_, i) => mask & (1 << i));
  const corners = [...Array(8).keys()].filter((place) => !filled.some((slot) => slot.corner === place));
  const edges = [...Array(12).keys()].filter((place) => !CROSS.edges.includes(place) && !filled.some((slot) => slot.edge === place));
  return corners.flatMap((corner) =>
    [0, 1, 2].flatMap((twist) =>
      edges.flatMap((edge) => [0, 1].map((flip) => ({ filled, corner, twist, edge, flip }))).filter((one) => !(one.corner === TARGET.corner && one.edge === TARGET.edge && !one.twist && !one.flip)),
    ),
  );
});
type Case = (typeof cases)[number];
const caseKey = (one: Case) => `${one.filled.map((slot) => slot.name).join("+") || "-"} c${one.corner}/${one.twist} e${one.edge}/${one.flip}`;

// Permutation parity
const parity = (perm: number[]): number => {
  let swaps = 0;
  const seen = perm.map(() => false);
  for (let i = 0; i < perm.length; i++) {
    for (let j = i, length = 0; !seen[j]; j = perm[j], length++) {
      seen[j] = true;
      if (length) swaps++;
    }
  }
  return swaps % 2;
};

// A case's cube: the cross and filled slots solved, the target pair where the case puts it, the other free pieces on the places left in order (the goal
// hides them, so any will do), with a top layer piece away from the target turned and two top edges swapped so the cube can be reached
function caseCube({ filled, corner, twist, edge, flip }: Case): KPattern {
  const data = structuredClone(kpuzzle.defaultPattern().patternData);
  const C = data.CORNERS;
  const E = data.EDGES;
  const freeCorners = [...Array(8).keys()].filter((place) => !filled.some((slot) => slot.corner === place));
  const freeEdges = [...Array(12).keys()].filter((place) => !CROSS.edges.includes(place) && !filled.some((slot) => slot.edge === place));
  const restCorners = freeCorners.filter((piece) => piece !== TARGET.corner);
  const restEdges = freeEdges.filter((piece) => piece !== TARGET.edge);
  freeCorners.filter((place) => place !== corner).forEach((place, at) => ((C.pieces[place] = restCorners[at]), (C.orientation[place] = 0)));
  freeEdges.filter((place) => place !== edge).forEach((place, at) => ((E.pieces[place] = restEdges[at]), (E.orientation[place] = 0)));
  C.pieces[corner] = TARGET.corner;
  C.orientation[corner] = twist;
  E.pieces[edge] = TARGET.edge;
  E.orientation[edge] = flip;
  const [a, b] = TOP.filter((place) => place !== edge);
  if (parity(C.pieces) !== parity(E.pieces)) [E.pieces[a], E.pieces[b]] = [E.pieces[b], E.pieces[a]];
  C.orientation[TOP.find((place) => place !== corner)!] = (3 - twist) % 3;
  E.orientation[a] = flip;
  return new KPattern(kpuzzle, data);
}

const timed = async <T>(run: () => Promise<T>) => {
  const cpu = process.cpuUsage();
  const t = performance.now();
  const value = await run();
  const used = process.cpuUsage(cpu);
  return { value, ms: performance.now() - t, cpu: (used.user + used.system) / 1000 };
};

// The step's options, as a method gives them (see batch.ts) without looks, going on past the cap, every answer given
const optionsFor = (one: Case) => {
  const keepText = [CROSS.text, ...one.filled.map((slot) => slot.text)].join(" ");
  const keep = goalFromText(keepText);
  const { look, next, ...base } = methodStepOptions(step, "U'", keep);
  return {
    keepText,
    options: {
      ...base,
      // Every slot but the target named as done, so only the grips that have the target at the front right are asked for
      earlier: goalFromText([CROSS.text, ...OTHERS.map((slot) => slot.text)].join(" ")),
      rank: step.rank,
      extraMoves: step.extraMoves ?? 0,
      avoid: avoided(step),
      ...handTurns(step),
      pastCut,
      maxCandidates: 1_000_000,
    },
  };
};

// Where this shard's file stands
const dir = new URL("./pairs/", import.meta.url);
mkdirSync(dir, { recursive: true });
const name = method.name.replace(/\s*\(.*$/, "").replace(/\W+/g, "-").toLowerCase();
const out = new URL(`./${name}-${step.name.replace(/\W+/g, "-").toLowerCase()}${pastCut ? "" : "-nocut"}-${shard}of${shards}.jsonl`, dir);
const header = JSON.stringify({ case: "options", method: method.name, step: step.name, pieces: step.pieces, options: { ...optionsFor(cases[0]).options, keep: undefined } });
const done = new Set<string>();
if (existsSync(out)) {
  // A run goes on only in a file made with the same options (a method changed since would mix two kinds of answers)
  const lines = readFileSync(out, "utf8").split("\n").filter(Boolean);
  if (lines[0] !== header) throw new Error(`${out.pathname} was made with other options: move it away to start again.`);
  for (const line of lines) done.add(JSON.parse(line).case);
} else appendFileSync(out, header + "\n");

const mine = cases.filter((_, at) => at % shards === shard);
console.log(`${method.name}, ${step.name}: ${cases.length} cases, shard ${shard}/${shards} has ${mine.length}, ${mine.filter((one) => done.has(caseKey(one))).length} done → ${out.pathname}`);
let total = { ms: 0, cpu: 0, answers: 0, cases: 0 };
for (const [at, one] of mine.entries()) {
  const key = caseKey(one);
  if (done.has(key)) continue;
  const { keepText, options } = optionsFor(one);
  const scramble = (await experimentalSolve3x3x3IgnoringCenters(caseCube(one))).invert().toString() + " U";
  if (!reachesGoal(scramble, "U'", keepText, [""], [])) throw new Error(`case ${key} doesn't keep ${keepText}: ${scramble}`);
  const { value, ms, cpu } = await timed(() => stepCandidates(scramble, step.pieces, options));
  // Answers reach the target slot with the kept pieces (the first 16 and every 64th after them checked)
  const wrong = value.filter((result, place) => (place < 16 || place % 64 === 0) && !reachesGoal(scramble, joinMoves("U'", result.solution.toString()), result.pieces, [""], []));
  if (wrong.length) throw new Error(`case ${key}: ${wrong.length} answers don't reach the goal, e.g. ${wrong[0].solution}`);
  const answers = value.map((result) => [result.solution.toString(), result.wide ?? null, result.speed, result.tier ?? 0]);
  const shortest = Math.min(...value.map((result) => countMoves(result.solution.toString())));
  appendFileSync(out, JSON.stringify({ case: key, filled: one.filled.map((slot) => slot.name), corner: one.corner, twist: one.twist, edge: one.edge, flip: one.flip, scramble, ms: Math.round(ms), cpu: Math.round(cpu), shortest, answers }) + "\n");
  total = { ms: total.ms + ms, cpu: total.cpu + cpu, answers: total.answers + answers.length, cases: total.cases + 1 };
  console.log(`${at + 1}/${mine.length} ${key}: ${Math.round(ms)} ms (cpu ${Math.round(cpu)}), ${answers.length} answers, shortest ${shortest}, best ${value[0].wide ?? value[0].solution} (${value[0].speed?.toFixed(2)})`);
}
console.log(`done: ${total.cases} cases in ${(total.ms / 1000).toFixed(0)} s (cpu ${(total.cpu / 1000).toFixed(0)} s), ${total.answers} answers`);
process.exit(0);
