// Loads the Rust crate's WebAssembly once per thread, for the search worker, its helpers and the speed model: where they run on one thread (Node
// benchmarks run the search worker in the engine's own process) they share one instance, since two loads at once would leave two

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { type InitInput } from "../../../search/pkg/puzzly_search.js";

// This thread's load of the Rust code (null until something asks for it)
let loading: Promise<unknown> | null = null;

// Load the Rust code (its bytes, a URL to fetch it from, or a compiled module) the first time; later calls wait for that same load
export function loadWasm(wasm: InitInput | Promise<InitInput>): Promise<unknown> {
  return (loading ??= init({ module_or_path: wasm }));
}
