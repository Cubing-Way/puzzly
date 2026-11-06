// Engine setup: load the puzzle (the 3x3x3 unless the app gives another), say how the app runs the search and scoring workers and the batch engines, and
// load the speed model in Rust when the app gives the Rust code

// Loads the puzzle definition and makes it the active puzzle
import { loadPuzzle } from "./core/puzzle";
// A puzzle's description
import type { PuzzleSpec } from "./puzzle/spec";
// The speed model in Rust (wasm-bindgen glue for the search crate, built by `npm run build-search`)
import { SpeedModel, type InitInput } from "../../search/pkg/puzzly_search.js";
// Scores with the speed model in Rust from now on
import { useRustSpeed } from "./speed/fingering";
// Page side of the search worker
import { configureSearch, stopSearchWorker, type SearchClientOptions } from "./worker/client";
// Page side of the scoring worker
import { configureScoring, type ScoringClientOptions } from "./worker/scoring-client";
// Page side of batch mode (whole engines in workers of their own)
import { configureBatch, type BatchClientOptions } from "./worker/batch-client";
// Loads the Rust code once per thread
import { loadWasm } from "./worker/wasm";
// Steps answered from answer files
import { loadAnswerFile } from "./step/file-step";
// Answer files read
import type { AnswerFile } from "./step/answer-file";

// What the engine takes from the app using it: the puzzle, how to start the search worker, how long an idle one is kept, how to start the scoring worker,
// how to start batch engines and how many, the Rust code for the speed model, and answer files
export interface EngineOptions extends SearchClientOptions, ScoringClientOptions, BatchClientOptions {
  // The puzzle the engine works on (its description, see puzzle/spec.ts; left out: the 3x3x3, CUBE3). One puzzle is active at a time: loading another
  // empties every cache the engine keeps of the one before
  puzzle?: PuzzleSpec;
  // The compiled Rust code (search/pkg/puzzly_search_bg.wasm, as the search worker takes it): with it, answers are scored by the speed model in Rust
  // on this thread, a few times quicker; without it, by the TypeScript one (the same costs)
  wasm?: InitInput | Promise<InitInput>;
  // Answer files (their bytes, see step/answer-file.ts): a step asked with the options one was made for is answered from it instead of searched
  answerFiles?: (Uint8Array | ArrayBuffer | AnswerFile)[];
}

// Load the puzzle (the 3x3x3 when none is given), set up the search and scoring workers and the batch engines, and load the speed model in Rust; await
// this once before using the engine
export async function loadEngine(options: EngineOptions = {}): Promise<void> {
  configureSearch(options);
  configureScoring(options);
  configureBatch(options);
  // The Rust code loads while the puzzle definition does
  const rust = options.wasm ? loadWasm(options.wasm).then(() => useRustSpeed(SpeedModel)) : undefined;
  // Another puzzle: the search worker's tables belong to the old one, so it's stopped (the next search starts a fresh one)
  if (await loadPuzzle(options.puzzle)) stopSearchWorker();
  await rust;
  for (const file of options.answerFiles ?? []) loadAnswerFile(file);
}
