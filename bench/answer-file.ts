// An answer file for the engine (see src/engine/step/answer-file.ts) from a pair file bench/pairs.ts made (all its shards): per case its key (what the
// step's search sees), the worker's measured distance of its combo and the search's shortest answer (each worked out here, as the step does it), and every
// answer with its writing, both costs and whether they're clean. Usage: node bench/out/answer-file.js [pair file, default cfop-level-2-pair-1]
// → bench/out/pairs/<pair file>.answers
import { inProcessWorker } from "./setup";
import { keptText } from "./pair-cases";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, goalFromText, joinMoves, countMoves, speedCost, strained, type AnswerFileOptions, type PreparedAnswer } from "../src/engine/index.ts";
import { answerFileWriter } from "../src/engine/step/answer-file.ts";
import { plannedCombos, stepCombos } from "../src/engine/step/step-combos.ts";
import { searchCombos } from "../src/engine/step/step.ts";
import { caseKey } from "../src/engine/step/file-step.ts";
import { holdOf, moveOrders, turnsFaces } from "../src/engine/step/scoring.ts";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

runSearchWorker({ wasm });
await loadEngine({ searchWorker: inProcessWorker, wasm });

const name = process.argv[2] ?? "cfop-level-2-pair-1";
const dir = new URL("./pairs/", import.meta.url);
const shards = readdirSync(dir).filter((file) => new RegExp(`^${name}-\\d+of\\d+\\.jsonl$`).test(file));
if (!shards.length) throw new Error(`no bench/out/pairs/${name}-*.jsonl`);
const started = performance.now();

// Every shard's options line must be the same
const firstLine = (file: string) => readFileSync(new URL(file, dir), "utf8").slice(0, 10_000).split("\n")[0];
const headerLine = firstLine(shards[0]);
for (const file of shards) if (firstLine(file) !== headerLine) throw new Error(`${file} was made with other options than ${shards[0]}`);
const header = JSON.parse(headerLine);
const { pieces, options } = header;
const avoid: string[] = options.avoid ?? [];
const made: AnswerFileOptions = {
  generatorMoves: options.generatorMoves,
  rotations: options.rotations,
  offsets: options.offsets,
  solvableWith: options.solvableWith,
  rank: options.rank,
  extraMoves: options.extraMoves,
  avoid,
  wideAxes: options.wideAxes,
  sliceAxes: options.sliceAxes,
  rotationAxes: options.rotationAxes,
};

const clean = (text: string): boolean => !avoid.length || (!turnsFaces(text, avoid) && !strained(text));
// The grips answers are held in from a case's own grip: its combo's and its twins', the same for every case (read from the first)
let writer: ReturnType<typeof answerFileWriter> | null = null;
let holds: string[] = [];
let caseCount = 0;
let answerCount = 0;
for (const file of shards) {
  const lines = readFileSync(new URL(file, dir), "utf8").split("\n").filter(Boolean).slice(1);
  for (const line of lines) {
    const row = JSON.parse(line);
    const caseOptions = { ...options, keep: goalFromText(keptText(row.filled)) };
    const { candidates } = plannedCombos(row.scramble, pieces, caseOptions);
    const [combo] = candidates;
    if (candidates.length !== 1 || combo.rotation !== "") throw new Error(`case ${row.case}: ${candidates.length} combos, the first held ${combo?.rotation}`);
    const grips = [combo, ...(combo.twins ?? [])].map((each) => each.rotation);
    if (!writer) {
      holds = grips;
      writer = answerFileWriter({ pieces, options: made, holds });
    }
    if (grips.join() !== holds.join()) throw new Error(`case ${row.case}: twin grips ${grips} against ${holds}`);
    // The worker's measured distance (it orders a step's combos) and the search's shortest answer, as the step finds them
    const { queue } = await stepCombos(row.scramble, pieces, caseOptions);
    const { answer } = await searchCombos(queue, caseOptions, null);
    if (countMoves(answer.moves) !== row.shortest) throw new Error(`case ${row.case}: shortest ${countMoves(answer.moves)}, the file says ${row.shortest}`);
    const answers: PreparedAnswer[] = row.answers.map(([solution, wide, speed]: [string, string | null, number]) => {
      const own = holdOf(solution);
      const moves = solution.slice(own.length).trim();
      const hold = holds.indexOf(own);
      if (hold < 0) throw new Error(`case ${row.case}: ${solution} held as none of ${holds}`);
      // A writing starts with the grip rotation (none starts held another way: not with these axes)
      if (wide !== null && holdOf(wide) !== own) throw new Error(`case ${row.case}: writing ${wide} starts held another way than ${solution}`);
      const writing = wide === null ? null : wide.slice(own.length).trim();
      const plain = speedCost(joinMoves(own, moves));
      if (writing === null && plain !== speed) throw new Error(`case ${row.case}: ${solution} costs ${plain}, the file says ${speed}`);
      return {
        hold,
        moves,
        writing,
        plain,
        written: speed,
        clean: clean(joinMoves(own, moves)),
        anyClean: moveOrders(moves).some((order) => clean(joinMoves(own, order))),
        writingClean: writing !== null && clean(joinMoves(own, writing)),
      };
    });
    writer.add({ key: caseKey(combo), bound: queue[0].bound, shortest: row.shortest, first: answer.moves }, answers);
    answerCount += answers.length;
    if (++caseCount % 200 === 0) console.log(`${caseCount} cases, ${((performance.now() - started) / 1000).toFixed(0)} s`);
  }
}
const bytes = writer!.finish();
const out = new URL(`./${name}.answers`, dir);
writeFileSync(out, bytes);
console.log(`${header.method}, ${header.step}: ${caseCount} cases, ${answerCount} answers, ${(bytes.length / 1e6).toFixed(1)} MB → ${out.pathname} in ${((performance.now() - started) / 1000).toFixed(0)} s`);
process.exit(0);
