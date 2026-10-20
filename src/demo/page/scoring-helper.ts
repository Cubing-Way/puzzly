// Test bench's scoring helper (scoring-helper.js, started by the scoring worker): the engine's scoring helper with this build's Rust code

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js; the same chunk as the other scripts')
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// The engine's scoring helper
import { runScoringHelper } from "../../engine/worker/scoring-helper";

runScoringHelper({ wasm });
