#!/usr/bin/env -S node --

import { barelyServe } from "barely-a-dev-server";

export const COMMON_BUILD_OPTIONS = {
  // Only the page's folder: each .ts in it is bundled as its own script (main, search worker, search helper), next to index.html
  entryRoot: "./src/demo/page",
  // Shared chunks go in chunks/; a .wasm import becomes its bytes (the Rust search code)
  esbuildOptions: { chunkNames: "chunks/[name]-[hash]", loader: { ".wasm": "binary" } },
};

if (process.argv.at(-1) === "--dev") {
  await barelyServe(COMMON_BUILD_OPTIONS);
} else {
  const outDir = "./dist/web";
  await barelyServe({
    ...COMMON_BUILD_OPTIONS,
    dev: false,
    outDir,
  });

  console.log(`
Your app has been built in: ${outDir}
`);
}
