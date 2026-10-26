// Batch engine for Node benchmarks (bench/out/engine.js): the engine's batch engine (src/engine/worker/engine-worker.ts) after the worker globals it needs,
// with its scoring worker in a thread of its own (bench/out/scoring.js), as the page's engine-worker.js has it
import "./helper-shim";
import { nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runEngineWorker } from "../src/engine/worker/engine-worker";

runEngineWorker({ wasm, scoringWorker: nodeScoringWorker });
