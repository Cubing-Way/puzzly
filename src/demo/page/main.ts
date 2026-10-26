// Test bench entry (main.js, loaded by index.html): starts the page with its search and scoring workers and the Rust code for the speed model

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js; the search worker shares the same chunk)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// Page start
import { startPage } from "../app";

// search-worker.js, scoring-worker.js and engine-worker.js are built next to the page (see search-worker.ts, scoring-worker.ts and engine-worker.ts), so the
// paths are page-relative; answers are scored in the scoring worker, and what the page itself scores with the Rust speed model; runBatch's engines
// start from engine-worker.js
startPage({
  searchWorker: () => new Worker("search-worker.js", { type: "module" }),
  scoringWorker: () => new Worker("scoring-worker.js", { type: "module" }),
  engineWorker: () => new Worker("engine-worker.js", { type: "module" }),
  wasm,
});
