// Test bench's batch engine (engine-worker.js, started by runBatch as main.ts says): a whole engine with this build's Rust code, its search in this worker

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// The engine's batch engine
import { runEngineWorker } from "../../engine/worker/engine-worker";

runEngineWorker({
  wasm,
  // scoring-worker.js is built next to this script (see scoring-worker.ts); where a worker can't start workers of its own, this one scores itself
  scoringWorker: typeof Worker === "function" ? () => new Worker("scoring-worker.js", { type: "module" }) : undefined,
});
