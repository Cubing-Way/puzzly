// Engine setup: load the cube definition, say how the app runs the search and scoring workers and the batch engines, and load the speed model in Rust when the app gives the Rust code

// Loads the cube definition
import { loadPuzzle } from "./core/puzzle";
// The speed model in Rust (wasm-bindgen glue for the search crate, built by `npm run build-search`)
import { SpeedModel, type InitInput } from "../../search/pkg/puzzly_search.js";
// Scores with the speed model in Rust from now on
import { useRustSpeed } from "./speed/fingering";
// Page side of the search worker
import { configureSearch, type SearchClientOptions } from "./worker/client";
// Page side of the scoring worker
import { configureScoring, type ScoringClientOptions } from "./worker/scoring-client";
// Page side of batch mode (whole engines in workers of their own)
import { configureBatch, type BatchClientOptions } from "./worker/batch-client";
// Loads the Rust code once per thread
import { loadWasm } from "./worker/wasm";

// What the engine takes from the app using it: how to start the search worker, how long an idle one is kept, how to start the scoring worker, how to
// start batch engines and how many, and the Rust code for the speed model
export interface EngineOptions extends SearchClientOptions, ScoringClientOptions, BatchClientOptions {
  // The compiled Rust code (search/pkg/puzzly_search_bg.wasm, as the search worker takes it): with it, answers are scored by the speed model in Rust
  // on this thread, a few times quicker; without it, by the TypeScript one (the same costs)
  wasm?: InitInput | Promise<InitInput>;
}

// Load the cube definition, set up the search and scoring workers and the batch engines, and load the speed model in Rust; await this once before using
// the engine
export async function loadEngine(options: EngineOptions = {}): Promise<void> {
  configureSearch(options);
  configureScoring(options);
  configureBatch(options);
  // The Rust code loads while the cube definition does
  const rust = options.wasm ? loadWasm(options.wasm).then(() => useRustSpeed(SpeedModel)) : undefined;
  await loadPuzzle();
  await rust;
}
