// Test bench's scoring worker (scoring-worker.js, started by main.ts): the engine's scoring worker with this build's Rust code and helpers

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js; the same chunk as the page's and the search worker's)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// The engine's scoring worker
import { runScoringWorker } from "../../engine/worker/scoring-worker";

runScoringWorker({
  wasm,
  // scoring-helper.js is built next to this script (see scoring-helper.ts); no helpers where a worker can't start workers of its own
  helper: typeof Worker === "function" ? () => new Worker("scoring-helper.js", { type: "module" }) : undefined,
});
