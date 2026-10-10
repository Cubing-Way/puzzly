// A search helper (src/engine/worker/search-helper.ts) in a Node worker_threads thread, looking like the browser Worker the helper pool expects (bench/out/helper.js)
import { Worker as NodeWorker } from "node:worker_threads";
import type { HelperWorker } from "../src/engine/worker/parallel";

// Start one helper thread; it keeps the process alive only while a search waits on it, so a benchmark ends without closing its helpers
export function nodeHelper(): HelperWorker {
  const worker = new NodeWorker(new URL("./helper.js", import.meta.url));
  let waiting = 0;
  const helper: HelperWorker = {
    onmessage: null,
    onerror: null,
    // Each search chunk gets one reply
    postMessage: (message, transfer) => {
      if (message.kind === "iterate" && waiting++ === 0) worker.ref();
      worker.postMessage(message, transfer as any);
    },
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => {
    if (--waiting === 0) worker.unref();
    helper.onmessage?.({ data });
  });
  worker.on("error", (error) => helper.onerror?.(error));
  worker.unref();
  return helper;
}
