// Test bench entry (main.js, loaded by index.html): starts the page with its search worker

// Page start
import { startPage } from "../app";

// search-worker.js is built next to the page (see search-worker.ts), so the path is page-relative
startPage(() => new Worker("search-worker.js", { type: "module" }));
