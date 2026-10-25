// Rookie mistakes in method solves (bench/out/rookie.js): example methods run on seeded scrambles, and each solve's rows (as the page shows them, steps
// that cancel joined) are checked for what no solver would do: a row that only turns the cube right before a row that turns it back or on (y2, then
// y2 U' R' …), rows whose meeting turns cancel but stay apart, rotations in a row not written the short way, a layer turned twice among turns about
// one axis in a row (R R', R L R'), a solve that ends with a rotation, and a row that doesn't reach its goal. Prints each solve with what's wrong in
// it, and fails (exit code 1) when anything is
// Usage: node bench/out/rookie.js [seed from, default 1] [count, default 6] [method name prefixes, comma-separated; default CFOP level 3]; SCRAMBLE="…"
// runs that scramble instead (once per seed asked for)
import { inProcessWorker, random, scramble } from "./setup";
import { nodeHelper, nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, readMethod, speedCost } from "../src/engine/index.ts";
import { runMethodRows, joinCancelled, methodTotals, handsMoves } from "../src/engine/method/run.ts";
import { joinSteps, countMoves, shortRotations } from "../src/engine/core/moves.ts";
import examples from "../src/demo/example-methods.json";

runSearchWorker({ wasm, helper: nodeHelper });
await loadEngine({ searchWorker: inProcessWorker, scoringWorker: nodeScoringWorker, wasm });

const [from = "1", count = "6", names = "CFOP level 3"] = process.argv.slice(2);
const methods = names.split(",").map((prefix) => {
  const found = (examples as any[]).find((method) => method.name.startsWith(prefix.trim()));
  if (!found) throw new Error(`No example method starts with "${prefix.trim()}".`);
  return { name: found.name as string, method: readMethod(found) };
});

// Move text as a list
const tokens = (moves: string): string[] => moves.split(/\s+/).filter(Boolean);
const isRotation = (move: string): boolean => /^[xyz]/.test(move);
const rotationCount = (moves: string): number => tokens(moves).filter(isRotation).length;
// Each layer's axis (wide and lowercase turns by their face)
const AXIS: Record<string, string> = { R: "x", L: "x", M: "x", U: "y", D: "y", E: "y", F: "z", B: "z", S: "z" };

// A layer turned twice among turns about one axis in a row (R R', R L R'), or the same rotation twice in a row, as text; null when there's none
function twice(moves: string): string | null {
  const list = tokens(moves);
  for (let at = 0; at < list.length; at++) {
    const axis = AXIS[list[at][0].toUpperCase()] ?? (isRotation(list[at]) ? list[at][0] : undefined);
    if (!axis) continue;
    const seen = new Set<string>();
    for (let end = at; end < list.length && (AXIS[list[end][0].toUpperCase()] ?? (isRotation(list[end]) ? list[end][0] : undefined)) === axis; end++) {
      const layer = list[end].replace(/[2']/g, "");
      if (seen.has(layer)) return list.slice(at, end + 1).join(" ");
      seen.add(layer);
    }
  }
  return null;
}

// How many solves had each kind of mistake
const tally = new Map<string, number>();
let solves = 0;
for (let seed = Number(from); seed < Number(from) + Number(count); seed++) {
  const scrambled = process.env.SCRAMBLE ?? scramble(random(seed));
  for (const { name, method } of methods) {
    const started = performance.now();
    const { steps, earlier } = await runMethodRows(scrambled, method);
    const rows = joinCancelled(scrambled, method, steps);
    const result = methodTotals(rows, earlier);
    const whole = result.wide ?? result.solution;
    const lines: string[] = [];
    const found = new Set<string>();
    const flag = (kind: string, text: string): void => {
      found.add(kind);
      lines.push(`      !! ${kind}: ${text}`);
    };
    const texts = rows.map((row) => handsMoves(row));
    for (const [at, row] of rows.entries()) {
      const text = texts[at];
      lines.push(`   ${row.name}${row.alg ? ` (${row.alg})` : ""}: ${text || "(already solved)"}`);
      if (!row.ok) flag("doesn't reach its goal", row.name);
      if (shortRotations(text) !== text) flag("rotations not written short", `${text} → ${shortRotations(text)}`);
      const doubled = twice(text);
      if (doubled) flag("a layer turned twice in a row", doubled);
      // Where it meets the next row that does something
      const later = texts.findIndex((other, index) => index > at && Boolean(other));
      if (!text || later < 0) continue;
      const joined = joinSteps(text, texts[later]);
      if (rotationCount(joined) < rotationCount(text) + rotationCount(texts[later])) flag("rotations made as one across rows", `${text} | ${texts[later]} → ${joined}`);
      else if (countMoves(joined) < countMoves(text) + countMoves(texts[later])) flag("turns that cancel across rows", `${text} | ${texts[later]} → ${joined}`);
    }
    if (whole && isRotation(tokens(whole).at(-1)!)) flag("solve ends with a rotation", tokens(whole).slice(-4).join(" "));
    for (const kind of found) tally.set(kind, (tally.get(kind) ?? 0) + 1);
    solves++;
    const speed = speedCost(whole, undefined, true, result.starts);
    console.log(`seed ${seed} ${name.split(" (")[0]}: ${result.moves} moves, speed ${speed.toFixed(2)}, ${((performance.now() - started) / 1000).toFixed(1)} s\n   scramble ${scrambled}\n${lines.join("\n")}`);
  }
}
console.log(`\n${solves} solves; ${tally.size ? [...tally].map(([kind, n]) => `${kind}: ${n}`).join(", ") : "no rookie mistakes"}`);
process.exit(tally.size ? 1 : 0);
