// Scoring worker for Node benchmarks (bench/out/scoring.js): the engine's scoring worker (src/engine/worker/scoring-worker.ts) after the worker globals it needs,
// with its helpers in threads of their own (SCORING_HELPERS=n: n of them; by default as the engine picks them from the threads: none on 4 or fewer)
import "./helper-shim";
import { nodeScoringHelper } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runScoringWorker } from "../src/engine/worker/scoring-worker";

// SCORING_HELPERS also stands for the threads (the engine starts one helper per 2 threads beyond 4), so that many helpers can be tried on any machine
if (process.env.SCORING_HELPERS) Object.defineProperty(navigator, "hardwareConcurrency", { value: 4 + 2 * Number(process.env.SCORING_HELPERS), configurable: true });
runScoringWorker({ wasm, helper: nodeScoringHelper, ...(process.env.SCORING_HELPERS ? { maxHelpers: Number(process.env.SCORING_HELPERS) } : {}) });
