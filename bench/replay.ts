// Direct-wasm benchmark: replays recorded worker requests (bench/record.ts) on the Rust search code bundled in, each goal on its big plan (exact table up to 10M states,
// else split tables of up to 10M each, as the worker ends up using), and reports per scenario: bound vs real length, nodes, µs per node, time, table builds
// Usage: node bench/out/replay.js [requests file] [results file, - = none] [scenarios, comma-separated, all = every one]; FRESH=1 builds every table
import { initSync, SplitSearch, DistanceTable } from "../search/pkg/puzzly_search.js";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

initSync({ module: wasm });
// Command line: recorded requests, where to write each request's result, which scenarios
const [file = "bench/out/requests.jsonl", out = "-", which = "all"] = process.argv.slice(2);
const kpuzzle = readFileSync(file + ".kpuzzle.json", "utf8");
const only = which === "all" ? null : which.split(",");
const requests = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
  .filter((r) => !only || only.includes(r.scenario));
const MAX = 10_000_000;
// Table bytes kept on disk next to the requests between runs (a file only loads with the same TABLE_FORMAT), so runs measure searches, not builds
const CACHE = `${dirname(file)}/tables`;
mkdirSync(CACHE, { recursive: true });

// Tables by moves + targets (shared between goals, like the worker), with build stats
const tables = new Map<string, DistanceTable>();
const builds: { key: string; states: number; mb: number; ms: number; loaded: boolean }[] = [];
function table(moves: string, targets: string, maxStates: number): DistanceTable {
  const key = `${moves}/${targets}`;
  const kept = tables.get(key);
  if (kept) return kept;
  const path = `${CACHE}/${createHash("sha1").update(key).digest("hex")}.bin`;
  const t = performance.now();
  let built: DistanceTable;
  let loaded = false;
  // Load it from disk, or build it (and save it)
  if (!process.env.FRESH && existsSync(path)) {
    built = DistanceTable.fromBytes(kpuzzle, targets, moves, readFileSync(path));
    loaded = true;
  } else {
    built = new DistanceTable(kpuzzle, targets, moves, maxStates);
    writeFileSync(path, built.toBytes());
  }
  builds.push({ key, states: built.states(), mb: built.bytes() / 2 ** 20, ms: performance.now() - t, loaded });
  tables.set(key, built);
  return built;
}

// Each goal's solver: an exact table if it fits, else a split search with its sub-tables attached, else null (twips: not benchmarked)
type Solver = { kind: "table"; solver: DistanceTable } | { kind: "split"; solver: SplitSearch } | null;
const solvers = new Map<string, Solver>();
function solverFor(r: any): Solver {
  const moves = JSON.stringify(r.moves);
  const key = `${moves}/${r.targets}`;
  if (solvers.has(key)) return solvers.get(key)!;
  let solver: Solver = null;
  try {
    solver = { kind: "table", solver: table(moves, r.targets, MAX) };
  } catch {
    try {
      const split = new SplitSearch(kpuzzle, r.targets, moves, MAX);
      for (let i = 0; i < split.tables(); i++) split.attach(i, table(moves, split.targets(i), Math.max(MAX, split.states(i))));
      solver = { kind: "split", solver: split };
    } catch (error) {
      console.log(`no table for a goal (${String(error).slice(0, 60)}): skipped`);
    }
  }
  solvers.set(key, solver);
  return solver;
}

// Replay every request, timing searches and lists (measures are timed apart)
const rows: any[] = [];
const t0 = performance.now();
for (const [i, r] of requests.entries()) {
  const s = solverFor(r);
  if (!s) {
    rows.push({ i, scenario: r.scenario, kind: r.kind, skipped: true });
    continue;
  }
  const options = JSON.stringify({ ...(r.maxDepth === undefined ? {} : { maxDepth: r.maxDepth }), ...(r.maxAnswers === undefined ? {} : { maxAnswers: r.maxAnswers }) });
  // The start's bound first (exact distance or largest sub-table distance)
  let t = performance.now();
  const bound = s.solver.measure(r.start);
  const measureMs = performance.now() - t;
  const row: any = { i, scenario: r.scenario, kind: r.kind, solver: s.kind, bound };
  if (r.kind === "measure") {
    row.ms = measureMs;
  } else {
    // The search or list itself: answer (a list keeps its count and a hash of every answer), length, time, nodes
    t = performance.now();
    try {
      if (r.kind === "search") {
        row.answer = s.solver.search(r.start, options);
        row.length = row.answer === "" ? 0 : row.answer.split(" ").length;
      } else {
        const answers: string[] = JSON.parse(s.solver.list(r.start, options));
        row.answers = answers.length;
        row.length = answers[0] === "" ? 0 : answers[0].split(" ").length;
        row.answer = createHash("sha1").update(answers.join("|")).digest("hex").slice(0, 12);
      }
    } catch (error) {
      row.error = String(error);
    }
    row.ms = performance.now() - t;
    row.nodes = s.kind === "split" ? s.solver.nodes() : 0;
  }
  rows.push(row);
}
const total = performance.now() - t0;

// Summary per scenario and kind: requests, time, nodes, µs per node (split searches with ≥ 1000 nodes), bound gap (answer length − start bound)
const pad = (x: any, n: number) => String(x).padStart(n);
console.log(`${"scenario/kind".padEnd(26)}${pad("reqs", 6)}${pad("ms", 10)}${pad("nodes", 13)}${pad("µs/node", 9)}${pad("gap avg", 8)}${pad("gap max", 8)}${pad("max ms", 9)}`);
const groups = new Map<string, any[]>();
for (const row of rows) if (!row.skipped) groups.set(`${row.scenario}/${row.kind}`, [...(groups.get(`${row.scenario}/${row.kind}`) ?? []), row]);
for (const [name, group] of groups) {
  const ms = group.reduce((a, r) => a + r.ms, 0);
  const nodes = group.reduce((a, r) => a + (r.nodes ?? 0), 0);
  const heavy = group.filter((r) => r.nodes >= 1000);
  const perNode = heavy.length ? (heavy.reduce((a, r) => a + r.ms, 0) * 1000) / heavy.reduce((a, r) => a + r.nodes, 0) : NaN;
  const gaps = group.filter((r) => r.length !== undefined && Number.isFinite(r.bound)).map((r) => r.length - r.bound);
  const gapAvg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
  console.log(
    `${name.padEnd(26)}${pad(group.length, 6)}${pad(ms.toFixed(0), 10)}${pad(nodes, 13)}${pad(perNode.toFixed(2), 9)}${pad(gapAvg.toFixed(2), 8)}${pad(gaps.length ? Math.max(...gaps) : "-", 8)}${pad(Math.max(...group.map((r) => r.ms)).toFixed(0), 9)}`,
  );
}
// Tables: how many, built or loaded, states and memory
const built = builds.filter((b) => !b.loaded);
console.log(
  `tables: ${builds.length} (${built.length} built in ${built.reduce((a, b) => a + b.ms, 0).toFixed(0)} ms, ${builds.length - built.length} loaded), ${builds.reduce((a, b) => a + b.states, 0).toLocaleString("en")} states, ${builds.reduce((a, b) => a + b.mb, 0).toFixed(1)} MB; skipped ${rows.filter((r) => r.skipped).length} requests (twips)`,
);
console.log(`replay total ${total.toFixed(0)} ms`);
if (out !== "-") writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
