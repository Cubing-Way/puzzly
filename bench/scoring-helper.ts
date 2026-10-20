// Scoring helper for Node benchmarks (bench/out/scoring-helper.js): the engine's scoring helper (src/engine/worker/scoring-helper.ts) after the worker globals it needs
import "./helper-shim";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runScoringHelper } from "../src/engine/worker/scoring-helper";

runScoringHelper({ wasm });
