// Compare two replay outputs: same answers (move text, or a hash of every listed answer), same bounds and node counts, and time per scenario / kind
// Usage: node bench/compare.mjs before.jsonl after.jsonl
import { readFileSync } from "node:fs";

// One replay output: a JSON object per request
const read = (file) => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const [a, b] = [read(process.argv[2]), read(process.argv[3])];
let diffs = 0;
let nodeDiffs = 0;
const time = new Map();
// Request by request: answers must match, nodes should; times add up per scenario / kind
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  const [x, y] = [a[i], b[i]];
  if (!x || !y || x.answer !== y.answer || x.error !== y.error || x.bound !== y.bound || x.answers !== y.answers) {
    diffs++;
    if (diffs <= 10) console.log("DIFF", JSON.stringify(x), "\n    ", JSON.stringify(y));
  }
  if (x && y && x.nodes !== y.nodes) nodeDiffs++;
  if (x && y && !x.skipped) {
    const key = `${x.scenario}/${x.kind}`;
    const t = time.get(key) ?? { a: 0, b: 0, nodes: [0, 0] };
    t.a += x.ms;
    t.b += y.ms;
    t.nodes[0] += x.nodes ?? 0;
    t.nodes[1] += y.nodes ?? 0;
    time.set(key, t);
  }
}
// Summary: differences first, then before → after per scenario / kind
console.log(`${a.length} vs ${b.length} requests: ${diffs} answer differences, ${nodeDiffs} node-count differences`);
for (const [key, t] of time) {
  console.log(`${key.padEnd(26)} ${t.a.toFixed(0).padStart(9)} ms -> ${t.b.toFixed(0).padStart(9)} ms  (${(t.a / Math.max(t.b, 0.001)).toFixed(2)}x)  nodes ${t.nodes[0]} -> ${t.nodes[1]}`);
}
