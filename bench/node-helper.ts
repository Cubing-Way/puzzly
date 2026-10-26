// A search helper (src/engine/worker/search-helper.ts) in a Node worker_threads thread, looking like the browser Worker the helper pool expects (bench/out/helper.js),
// the scoring worker (src/engine/worker/scoring-worker.ts) and its helpers (scoring-helper.ts) in threads too (bench/out/scoring.js, scoring-helper.js), and
// batch engines (src/engine/worker/engine-worker.ts) in threads of their own (bench/out/engine.js)
import { Worker as NodeWorker } from "node:worker_threads";
import { HELPER_READY, type HelperWorker } from "../src/engine/worker/parallel";
import type { EngineWorker, ScoringHelperWorker, ScoringWorker } from "../src/engine/worker/protocol";

// Start one helper thread; it keeps the process alive only while a search waits on it, so a benchmark ends without closing its helpers
export function nodeHelper(): HelperWorker {
  const worker = new NodeWorker(new URL("./helper.js", import.meta.url));
  let waiting = 0;
  const helper: HelperWorker = {
    onmessage: null,
    onerror: null,
    // Each search chunk and each table build gets one reply
    postMessage: (message, transfer) => {
      if ((message.kind === "iterate" || message.kind === "build") && waiting++ === 0) worker.ref();
      worker.postMessage(message, transfer as any);
    },
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => {
    // The helper saying it's ready answers no task
    if (data.task !== HELPER_READY && --waiting === 0) worker.unref();
    helper.onmessage?.({ data });
  });
  worker.on("error", (error) => helper.onerror?.(error));
  worker.unref();
  return helper;
}

// Start the scoring worker in a thread (bench/out/scoring.js, next to the bundle); like a helper, it keeps the process alive only while a scoring waits on it
export function nodeScoringWorker(): ScoringWorker {
  const worker = new NodeWorker(new URL("./scoring.js", import.meta.url));
  let waiting = 0;
  const scoring: ScoringWorker = {
    onmessage: null,
    onerror: null,
    // Only a finish gets a reply
    postMessage: (message) => {
      if (message.kind === "finish" && waiting++ === 0) worker.ref();
      worker.postMessage(message);
    },
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => {
    if (--waiting === 0) worker.unref();
    scoring.onmessage?.({ data });
  });
  worker.on("error", (error) => scoring.onerror?.(error));
  worker.unref();
  return scoring;
}

// Start one scoring helper in a thread (bench/out/scoring-helper.js, next to the bundle); it keeps the process alive only while a chunk waits on it
export function nodeScoringHelper(): ScoringHelperWorker {
  const worker = new NodeWorker(new URL("./scoring-helper.js", import.meta.url));
  let waiting = 0;
  const helper: ScoringHelperWorker = {
    onmessage: null,
    onerror: null,
    // Each chunk gets one reply
    postMessage: (message) => {
      if (message.kind === "chunk" && waiting++ === 0) worker.ref();
      worker.postMessage(message);
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

// Start one batch engine in a thread (bench/out/engine.js, next to the bundle); it keeps the process alive only while a job's calls wait on it
export function nodeEngineWorker(): EngineWorker {
  const worker = new NodeWorker(new URL("./engine.js", import.meta.url));
  let waiting = 0;
  const engine: EngineWorker = {
    onmessage: null,
    onerror: null,
    // Each call of a job gets one reply
    postMessage: (message) => {
      if (waiting === 0 && message.calls.length) worker.ref();
      waiting += message.calls.length;
      worker.postMessage(message);
    },
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => {
    if (--waiting === 0) worker.unref();
    engine.onmessage?.({ data });
  });
  worker.on("error", (error) => engine.onerror?.(error));
  worker.unref();
  return engine;
}
