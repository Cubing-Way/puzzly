// Worker globals for the search helper in a Node thread: self, postMessage and onmessage over the parent port
import { parentPort } from "node:worker_threads";

(globalThis as any).self = globalThis;
(globalThis as any).postMessage = (data: unknown, transfer?: any[]) => parentPort!.postMessage(data, transfer);
parentPort!.on("message", (data) => (globalThis as any).onmessage?.({ data }));
