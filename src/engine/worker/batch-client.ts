// Page side of batch mode: jobs (each a list of engine calls, like the steps of one solve's review) spread over several whole engines, each in a worker
// of its own (see engine-worker.ts), so many solves keep every core busy; a job runs on one engine, its calls one after another, unless its calls are
// spread too. Engines start on first use and stop when idle

// Alg, the type a step's solution comes in
import { Alg } from "cubing/alg";
// Most engines by default
import { MAX_ENGINES } from "./limits";
// Messages to and from the engines
import { ALG_TEXT, type BatchCall, type BatchResult, type EngineReply, type EngineWorker } from "./protocol";

// How the app runs its batch engines
export interface BatchClientOptions {
  // Starts one batch engine: a worker whose script calls runEngineWorker (see engine-worker.ts). runBatch needs it
  engineWorker?: () => EngineWorker;
  // Most engines a batch runs at once (default: one per thread the device reports, up to MAX_ENGINES); each holds its own tables
  engines?: number;
  // Stop the engines after this long without jobs (default 60 s, as the search worker), so their memory goes back to the system
  workerIdleMs?: number;
}

// What one call of a batch gives: what its engine function gave, or the error it threw
export type BatchSettled = PromiseSettledResult<BatchResult>;

// How one runBatch shares out its jobs
export interface BatchRunOptions {
  // Hears each job as it's done, by its place in `jobs`
  onJob?: (job: number, results: BatchSettled[]) => void;
  // Spread each job's calls over the engines too, so one job's calls run at the same time on several engines (the same answers come back). Each job is
  // done sooner, and the whole batch takes about as long: bench/batch.ts on 2 cores / 4 threads, 8 CFOP reviews on 4 engines, 1.41 s a review both runs
  // (1.49–1.63 s with each review on one engine), the first review done after 0.8–0.9 s (3.3–4.0 s); an earlier test had it 20% slower overall.
  // Default off: a job's calls run one after another on one engine
  spreadCalls?: boolean;
}

// Idle time before the engines are stopped, unless the app sets its own
const ENGINE_IDLE_MS = 60_000;

// One job: its calls, their results so far, how many are still to come, and who hears when they're all in
interface Job {
  calls: BatchCall[];
  results: BatchSettled[];
  left: number;
  done: (results: BatchSettled[]) => void;
}

// What one engine is sent at a time: some calls of a job, by their places in it (all of them, or one each when calls are spread)
interface Part {
  job: Job;
  calls: number[];
}

// One engine, and the part it's on with how many of its calls haven't answered (null = free)
interface Engine {
  worker: EngineWorker;
  part: { id: number; part: Part; left: number } | null;
}

// How the app starts an engine (null until loadEngine is given one), how many may run, how long idle ones are kept, the engines running, the parts waiting
// for one, the number for the next part sent, and the timer that stops idle engines
let startEngine: (() => EngineWorker) | null = null;
let most = 0; // 0 = by the device's threads
let idleMs = ENGINE_IDLE_MS;
let engines: Engine[] = [];
const waiting: Part[] = [];
let nextPart = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// Set how batch engines are started, how many may run and how long idle ones are kept (left-out options stay as they were); engines started another
// way are stopped (the calls they were on fail, waiting ones go to the new engines)
export function configureBatch(options: BatchClientOptions): void {
  if (options.engines !== undefined) most = Math.max(1, Math.floor(options.engines));
  idleMs = options.workerIdleMs ?? idleMs;
  if (options.engineWorker && options.engineWorker !== startEngine) {
    stopEngines();
    startEngine = options.engineWorker;
    if (waiting.length) feed();
  }
}

// Most engines that may run: the app's number, else one per thread the device reports, up to MAX_ENGINES
function engineCount(): number {
  return most || Math.max(1, Math.min(globalThis.navigator?.hardwareConcurrency ?? 1, MAX_ENGINES));
}

// Stop every engine, freeing its memory (the next batch starts fresh ones, which load the tables stored in this browser); the calls they were on fail
export function stopEngines(): void {
  clearTimeout(idleTimer);
  const stopped = engines;
  engines = [];
  for (const engine of stopped) {
    engine.worker.terminate();
    if (engine.part) fail(engine.part.part, "Engine stopped.");
  }
}

// Run each job (a list of engine calls) on whichever engine is free, several at once: its calls one after another on one engine, or spread over the
// engines too (options.spreadCalls); every call settles, with what it gave or the error it threw, and onJob (or options.onJob) hears each job as it's
// done. Callbacks in a call's options (onProgress, onStep, stop…) are left out, since they can't go to another thread
export function runBatch(jobs: BatchCall[][], options: BatchRunOptions | BatchRunOptions["onJob"] = {}): Promise<BatchSettled[][]> {
  if (!startEngine) return Promise.reject(new Error("No engine worker: give loadEngine an engineWorker option that starts one."));
  const { onJob, spreadCalls = false } = typeof options === "function" ? { onJob: options } : options;
  clearTimeout(idleTimer);
  const all = jobs.map(
    (calls, index) =>
      new Promise<BatchSettled[]>((resolve) => {
        const done = (results: BatchSettled[]) => {
          onJob?.(index, results);
          resolve(results);
        };
        if (!calls.length) return done([]);
        const job: Job = { calls: calls.map(postable), results: [], left: calls.length, done };
        const places = calls.map((_, place) => place);
        if (spreadCalls) waiting.push(...places.map((place) => ({ job, calls: [place] })));
        else waiting.push({ job, calls: places });
      }),
  );
  feed();
  return Promise.all(all);
}

// A call as it can be posted: functions left out of its arguments' fields (an options object's callbacks)
function postable(call: BatchCall): BatchCall {
  const args = call.args.map((arg) => (arg && typeof arg === "object" && !Array.isArray(arg) ? Object.fromEntries(Object.entries(arg).filter(([, field]) => typeof field !== "function")) : arg));
  return { call: call.call, args } as BatchCall;
}

// A call's result as the engine sent it, with each Alg made again from its text
function revived(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revived);
  if (!value || typeof value !== "object") return value;
  if (ALG_TEXT in value) return new Alg((value as Record<string, string>)[ALG_TEXT]);
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, revived(field)]));
}

// Give each free engine the next waiting part, starting engines (up to the most) while parts wait; once nothing runs or waits, stop them after the idle time
function feed(): void {
  for (const engine of engines) if (!engine.part) give(engine);
  while (waiting.length && engines.length < engineCount()) give(start());
  if (!waiting.length && engines.every((engine) => !engine.part)) idleTimer = setTimeout(stopEngines, idleMs);
}

// Send an engine the next waiting part, if any
function give(engine: Engine): void {
  const part = waiting.shift();
  if (!part) return;
  const id = nextPart++;
  engine.part = { id, part, left: part.calls.length };
  engine.worker.postMessage({ id, calls: part.calls.map((place) => part.job.calls[place]) });
}

// One call of a job answered: its result goes in, and a job with every result in is done
function settle(job: Job, place: number, result: BatchSettled): void {
  job.results[place] = result;
  if (--job.left === 0) job.done(job.results);
}

// Start one engine the way the app said to
function start(): Engine {
  const engine: Engine = { worker: startEngine!(), part: null };
  // Each call's answer goes into its job; once the part it was sent has every answer in, the engine takes the next part
  engine.worker.onmessage = ({ data }: { data: EngineReply }) => {
    const current = engine.part;
    if (!current || current.id !== data.id) return;
    const { job, calls } = current.part;
    settle(job, calls[data.index], data.error === undefined ? { status: "fulfilled", value: revived(data.value) as BatchResult } : { status: "rejected", reason: new Error(data.error) });
    if (--current.left) return;
    engine.part = null;
    feed();
  };
  // A crashed engine fails the calls it was sent that hadn't answered, and is left out (the next parts start another one)
  engine.worker.onerror = (event) => {
    engine.worker.terminate();
    engines = engines.filter((other) => other !== engine);
    if (engine.part) fail(engine.part.part, event.message || "Engine worker failed.");
    engine.part = null;
    feed();
  };
  engines.push(engine);
  return engine;
}

// Fail a part's calls that hadn't answered
function fail(part: Part, message: string): void {
  for (const place of part.calls) if (!part.job.results[place]) settle(part.job, place, { status: "rejected", reason: new Error(message) });
}
