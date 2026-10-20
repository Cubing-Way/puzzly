// Test bench entry (main.js, loaded by index.html): starts the page with its search and scoring workers and the Rust code for the speed model

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js; the search worker shares the same chunk)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// Page start
import { startPage } from "../app";

// search-worker.js and scoring-worker.js are built next to the page (see search-worker.ts and scoring-worker.ts), so the paths are page-relative; answers
// are scored in the scoring worker, and what the page itself scores with the Rust speed model
startPage({
  searchWorker: () => new Worker("search-worker.js", { type: "module" }),
  scoringWorker: () => new Worker("scoring-worker.js", { type: "module" }),
  wasm,
});
