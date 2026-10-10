// Search helper for Node benchmarks (bench/out/helper.js): the engine's search helper (src/engine/worker/search-helper.ts) after the worker globals it needs
import "./helper-shim";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchHelper } from "../src/engine/worker/search-helper";

runSearchHelper({ wasm });
