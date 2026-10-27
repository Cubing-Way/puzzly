// Bundle the benchmark scripts for Node into bench/out: the engine, the search worker and the Rust search code are bundled in (the .wasm as bytes),
// plus the search helper, the scoring worker and its helper that run in worker threads (helper.js, scoring.js, scoring-helper.js), the check of the speed model against known algs (known-algs.js) and the check of
// the alg sets against every last-layer state (alg-sets.js) and the check of method solves for rookie mistakes (rookie.js), plus the tool that makes the ZBLL sheet from an alg database (zbll-sheet.js),
// and the batch benchmark (batch.js) with its batch engines in worker threads (engine.js), the tool that solves every pair case ahead of time (pairs.js)
// and the one that makes an answer file for the engine from its output (answer-file.js), with the check of a file's answers against the searched steps (answer-check.js)
import { build } from "esbuild";

await build({
  entryPoints: ["bench/record.ts", "bench/replay.ts", "bench/helper.ts", "bench/scoring.ts", "bench/scoring-helper.ts", "bench/known-algs.ts", "bench/alg-sets.ts", "bench/rookie.ts", "bench/zbll-sheet.ts", "bench/batch.ts", "bench/engine.ts", "bench/pairs.ts", "bench/answer-file.ts", "bench/answer-check.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  // cubing.js stays a normal import from node_modules
  packages: "external",
  loader: { ".wasm": "binary" },
  outdir: "bench/out",
  logLevel: "warning",
});
console.log("Bundled bench/out/record.js, bench/out/replay.js, bench/out/helper.js, bench/out/scoring.js, bench/out/scoring-helper.js, bench/out/known-algs.js, bench/out/alg-sets.js, bench/out/rookie.js, bench/out/zbll-sheet.js, bench/out/batch.js, bench/out/engine.js, bench/out/pairs.js, bench/out/answer-file.js and bench/out/answer-check.js");
