// Bundle the benchmark scripts for Node into bench/out: the engine, the search worker and the Rust search code are bundled in (the .wasm as bytes),
// plus the search helper, the scoring worker and its helper that run in worker threads (helper.js, scoring.js, scoring-helper.js), the check of the speed model against known algs (known-algs.js) and the check of
// the alg sets against every last-layer state (alg-sets.js), plus the tool that makes the ZBLL sheet from an alg database (zbll-sheet.js)
import { build } from "esbuild";

await build({
  entryPoints: ["bench/record.ts", "bench/replay.ts", "bench/helper.ts", "bench/scoring.ts", "bench/scoring-helper.ts", "bench/known-algs.ts", "bench/alg-sets.ts", "bench/zbll-sheet.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  // cubing.js stays a normal import from node_modules
  packages: "external",
  loader: { ".wasm": "binary" },
  outdir: "bench/out",
  logLevel: "warning",
});
console.log("Bundled bench/out/record.js, bench/out/replay.js, bench/out/helper.js, bench/out/scoring.js, bench/out/scoring-helper.js, bench/out/known-algs.js, bench/out/alg-sets.js and bench/out/zbll-sheet.js");
