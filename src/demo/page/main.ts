// Test bench entry (main.js, loaded by index.html): starts the page with its search worker and the Rust code for the speed model

// The compiled Rust code, bundled in as bytes (esbuild's binary loader, see script/build.js; the search worker shares the same chunk)
import wasm from "../../../search/pkg/puzzly_search_bg.wasm";
// Page start
import { startPage } from "../app";

// search-worker.js is built next to the page (see search-worker.ts), so the path is page-relative; the page scores answers with the Rust speed model
startPage(() => new Worker("search-worker.js", { type: "module" }), wasm);
