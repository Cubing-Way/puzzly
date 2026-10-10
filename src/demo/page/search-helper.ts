// Test bench's search helper (search-helper.js, started by search-worker.ts): the engine's search helper with this build's Rust code

// The compiled Rust search code, bundled in as bytes (esbuild's binary loader, see script/build.js)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// The engine's search helper
import { runSearchHelper } from "../../engine/worker/search-helper";

runSearchHelper({ wasm });
