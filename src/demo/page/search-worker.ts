// Test bench's search worker (search-worker.js, started by main.ts): the engine's search worker with this build's Rust code and helpers

// The compiled Rust search code, bundled in as bytes (esbuild's binary loader, see script/build.js)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// The engine's search worker
import { runSearchWorker } from "../../engine/worker/search-worker";

runSearchWorker({
  wasm,
  // search-helper.js is built next to this script (see search-helper.ts); no helpers where a worker can't start workers of its own
  helper: typeof Worker === "function" ? () => new Worker("search-helper.js", { type: "module" }) : undefined,
});
