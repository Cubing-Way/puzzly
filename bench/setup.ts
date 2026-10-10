// Runs the engine's search worker in this process: worker globals whose messages go through setImmediate, and a worker object for the engine to talk to;
// every request can be recorded
import type { SearchWorker } from "../src/engine";

(globalThis as any).self = globalThis;
// DEVICE_GB=8: the worker sees this much device memory (Node reports none, like Firefox and Safari), so it picks that device's table budget
if (process.env.DEVICE_GB) Object.defineProperty(navigator, "deviceMemory", { value: Number(process.env.DEVICE_GB), configurable: true });
// CORES=4: the worker sees this many cores and starts helpers for long searches (real threads, bench/out/helper.js); default 1 = no helpers, as before
Object.defineProperty(navigator, "hardwareConcurrency", { value: Number(process.env.CORES ?? 1), configurable: true });
// The engine's side of the worker (the last one it started)
let current: any = null;
// Requests seen so far (recording on when the array exists)
export const recorded: any[] = [];
export const recording = { on: false, scenario: "" };
// The worker's replies go to the engine's listener
(globalThis as any).postMessage = (data: any) => setImmediate(() => current?.onmessage?.({ data }));

// A worker object for loadEngine's searchWorker option: its requests go to the search worker started in this process (runSearchWorker listens on the global)
export function inProcessWorker(): SearchWorker {
  current = {
    onmessage: null,
    onerror: null,
    postMessage(data: any) {
      if (recording.on) recorded.push({ scenario: recording.scenario, ...data });
      setImmediate(() => (globalThis as any).onmessage({ data }));
    },
    terminate() {},
  };
  return current;
}

// Seeded random numbers (mulberry32), so every run gets the same scrambles
export function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random face-turn scramble of this many moves (no face twice in a row, opposite faces not back and forth)
export function scramble(rand: () => number, length = 25): string {
  const faces = ["U", "D", "R", "L", "F", "B"];
  const out: string[] = [];
  let last = -1;
  let before = -1;
  while (out.length < length) {
    const face = Math.floor(rand() * 6);
    if (face === last) continue;
    if (last >= 0 && face >> 1 === last >> 1 && face === before) continue;
    out.push(faces[face] + ["", "2", "'"][Math.floor(rand() * 3)]);
    before = last;
    last = face;
  }
  return out.join(" ");
}
