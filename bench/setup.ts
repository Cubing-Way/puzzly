// Fake Worker: the search worker module runs in this process, messages go through setImmediate; every request can be recorded
(globalThis as any).self = globalThis;
let current: any = null;
// Requests seen so far (recording on when the array exists)
export const recorded: any[] = [];
export const recording = { on: false, scenario: "" };
(globalThis as any).Worker = class {
  onmessage: any = null;
  onerror: any = null;
  constructor() {
    current = this;
  }
  postMessage(data: any) {
    if (recording.on) recorded.push({ scenario: recording.scenario, ...data });
    setImmediate(() => (globalThis as any).onmessage({ data }));
  }
  terminate() {}
};
(globalThis as any).postMessage = (data: any) => setImmediate(() => current?.onmessage?.({ data }));

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
