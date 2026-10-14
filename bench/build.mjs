// Bundle the benchmark scripts for Node into bench/out: the engine, the search worker and the Rust search code are bundled in (the .wasm as bytes),
// plus the search helper that runs in worker threads (helper.js), the check of the speed model against known algs (known-algs.js) and the check of
// the alg sets against every last-layer state (alg-sets.js)
import { build } from "esbuild";

await build({
  entryPoints: ["bench/record.ts", "bench/replay.ts", "bench/helper.ts", "bench/known-algs.ts", "bench/alg-sets.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  // cubing.js stays a normal import from node_modules
  packages: "external",
  loader: { ".wasm": "binary" },
  outdir: "bench/out",
  logLevel: "warning",
});
console.log("Bundled bench/out/record.js, bench/out/replay.js, bench/out/helper.js, bench/out/known-algs.js and bench/out/alg-sets.js");
