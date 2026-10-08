// Engine-level benchmark (fake Worker): heavy method runs and steps on seeded scrambles, timed per step; pass 1 also records every worker request
// for the direct-wasm replay (bench/replay.ts); pass 2 runs the same again with every table already built (warm)
// Usage: node bench/out/record.js [requests file, - = none] [scenarios, comma-separated, all = every one] [passes, default 2]
import { recorded, recording, random, scramble } from "./setup";
import "../src/search-worker.ts";
import { loadEngine, solveStep, runMethod, readMethod, reachesGoal, countMoves } from "../src/engine.ts";
import examples from "../src/example-methods.json";
import { cube3x3x3 } from "cubing/puzzles";
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";
import { writeFileSync } from "node:fs";

await loadEngine();
const FACE = ["U", "R", "F", "D", "L", "B"];
const ALL = "UF UR UB UL DF DR DB DL FR FL BR BL UFR UBR UBL UFL DFR DFL DBL DBR";
const DR = "UF:o UR:o UB:o UL:o DF:o DR:o DB:o DL:o FR:o2 FL:o2 BR:o2 BL:o2 UFR:o UBR:o UBL:o UFL:o DFR:o DFL:o DBL:o DBR:o";
const D_ONLY = { bottom: ["D"], anyFront: false };
const ANY_FRONT = { bottom: ["D"], anyFront: true };
// Command line: where to write the requests, which scenarios, how many passes
const [file = "bench/out/requests.jsonl", which = "all", passCount = "2"] = process.argv.slice(2);
const rec = file === "-" ? "" : file;
const only = which === "all" ? null : which.split(",");
const passes = Number(passCount);

// Methods and steps to run, each on its own seeded scrambles
const drFinish = readMethod({
  name: "DR + finish",
  steps: [
    { name: "DR", pieces: DR, grips: D_ONLY, moves: FACE },
    { name: "Finish", pieces: ALL, keep: true, grips: D_ONLY, moves: ["U", "D", "R2", "L2", "F2", "B2"] },
  ],
});
const cfopFull = readMethod({
  name: "CFOP + OLL + PLL",
  steps: [
    ...(examples as any[])[0].steps,
    { name: "OLL", pieces: "UF:o UR:o UB:o UL:o UFR:o UBR:o UBL:o UFL:o", keep: true, grips: D_ONLY, moves: FACE },
    { name: "PLL", pieces: "UF UR UB UL UFR UBR UBL UFL", keep: true, grips: D_ONLY, moves: FACE },
  ],
});
const pseudo = readMethod((examples as any[]).find((m) => m.name.startsWith("Pseudo")));

// A scramble that only flips two edges in place (a BLD flip step with the buffer home)
const kpuzzle = await cube3x3x3.kpuzzle();
async function flipScramble(a: number, b: number): Promise<string> {
  const data = structuredClone(kpuzzle.defaultPattern().patternData);
  data.EDGES.orientation[a] = 1;
  data.EDGES.orientation[b] = 1;
  return (await experimentalSolve3x3x3IgnoringCenters(new KPattern(kpuzzle, data))).invert().toString();
}

// Scenarios: name, scrambles, and what to run on one scramble (returns a one-line summary)
type Scenario = { name: string; scrambles: string[]; run: (s: string) => Promise<string> };
const seeded = (seed: number, count: number) => {
  const rand = random(seed);
  return Array.from({ length: count }, () => scramble(rand));
};
const method = (m: any) => async (s: string) => {
  const r = await runMethod(s, m);
  return `${r.moves} moves [${r.steps.map((x) => `${x.name}:${x.moves}/${x.ms.toFixed(0)}ms`).join(" ")}] ok ${r.ok}`;
};
const step = (pieces: string, options: any) => async (s: string) => {
  const r = await solveStep(s, pieces, options);
  const sol = r.solution.toString();
  const ok = reachesGoal(s, sol, r.pieces, [""], [], r.changed === undefined ? undefined : { from: r.rotation, changed: r.changed });
  return `${countMoves(sol)} moves "${sol}" searches ${r.searches} ok ${ok}`;
};
const scenarios: Scenario[] = [
  { name: "dr-finish", scrambles: seeded(11, 4), run: method(drFinish) },
  { name: "xxxcross", scrambles: seeded(22, 4), run: step("DF DR DB DL DFR FR DFL FL DBR BR", { generatorMoves: FACE }) },
  { name: "cfop-oll-pll", scrambles: seeded(33, 3), run: method(cfopFull) },
  { name: "pseudo-lookahead", scrambles: seeded(44, 2), run: method(pseudo) },
  { name: "bld-flip", scrambles: [await flipScramble(1, 3), await flipScramble(5, 10)], run: step("", { generatorMoves: FACE, buffer: "UF" }) },
];

// Run every scenario, pass by pass
for (let pass = 1; pass <= passes; pass++) {
  for (const scenario of scenarios) {
    if (only && !only.includes(scenario.name)) continue;
    recording.on = pass === 1 && !!rec;
    recording.scenario = scenario.name;
    let total = 0;
    for (const [i, s] of scenario.scrambles.entries()) {
      const t = performance.now();
      let line: string;
      try {
        line = await scenario.run(s);
      } catch (error) {
        line = `ERROR ${(error as Error).message}`;
      }
      const ms = performance.now() - t;
      total += ms;
      console.log(`pass ${pass} ${scenario.name} #${i}: ${line} (${ms.toFixed(0)} ms)`);
    }
    console.log(`pass ${pass} ${scenario.name} TOTAL ${total.toFixed(0)} ms`);
  }
}
recording.on = false;

// Recorded requests: the puzzle once, then one line per request (without the puzzle)
if (rec) {
  const puzzle = recorded.find((r) => r.kpuzzle)?.kpuzzle;
  const lines = recorded.map(({ kpuzzle: _, id: __, ...rest }) => JSON.stringify(rest));
  writeFileSync(rec, lines.join("\n") + "\n");
  writeFileSync(rec + ".kpuzzle.json", puzzle ?? "");
  console.log(`recorded ${recorded.length} requests`);
}
process.exit(0);
