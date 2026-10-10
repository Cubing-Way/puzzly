// Engine setup: load the cube definition and say how the app runs the search worker

// Loads the cube definition
import { loadPuzzle } from "./core/puzzle";
// Page side of the search worker
import { configureSearch, type SearchClientOptions } from "./worker/client";

// What the engine takes from the app using it: how to start the search worker, and how long an idle one is kept
export type EngineOptions = SearchClientOptions;

// Load the cube definition and set up the search worker; await this once before using the engine
export async function loadEngine(options: EngineOptions = {}): Promise<void> {
  configureSearch(options);
  await loadPuzzle();
}
