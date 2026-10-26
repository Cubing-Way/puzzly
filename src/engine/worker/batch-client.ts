// Page side of batch mode: jobs (each a list of engine calls, like the steps of one solve's review) spread over several whole engines, each in a worker
// of its own (see engine-worker.ts), so many solves keep every core busy; one job runs on one engine, its calls one after another. Engines start on
// first use and stop when idle

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

// Idle time before the engines are stopped, unless the app sets its own
const ENGINE_IDLE_MS = 60_000;

// One job: its calls, their results so far, how many are still to come, and who hears when they're all in
interface Job {
  calls: BatchCall[];
  results: BatchSettled[];
  left: number;
  done: (results: BatchSettled[]) => void;
}

// One engine and the job it's on (null = free)
interface Engine {
  worker: EngineWorker;
  job: { id: number; job: Job } | null;
}

// How the app starts an engine (null until loadEngine is given one), how many may run, how long idle ones are kept, the engines running, the jobs waiting
// for one, the number for the next job sent, and the timer that stops idle engines
let startEngine: (() => EngineWorker) | null = null;
let most = 0; // 0 = by the device's threads
let idleMs = ENGINE_IDLE_MS;
let engines: Engine[] = [];
const waiting: Job[] = [];
let nextJob = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// Set how batch engines are started, how many may run and how long idle ones are kept (left-out options stay as they were); engines started another
// way are stopped (the jobs they were on fail, waiting ones go to the new engines)
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

// Stop every engine, freeing its memory (the next batch starts fresh ones, which load the tables stored in this browser); the jobs they were on fail
export function stopEngines(): void {
  clearTimeout(idleTimer);
  const stopped = engines;
  engines = [];
  for (const engine of stopped) {
    engine.worker.terminate();
    if (engine.job) fail(engine.job.job, "Engine stopped.");
  }
}

// Run each job (a list of engine calls, run one after another on one engine) on whichever engine is free, several at once; every call settles, with
// what it gave or the error it threw, and onJob hears each job as it's done (by its place in `jobs`). Callbacks in a call's options (onProgress,
// onStep, stop…) are left out, since they can't go to another thread
export function runBatch(jobs: BatchCall[][], onJob?: (job: number, results: BatchSettled[]) => void): Promise<BatchSettled[][]> {
  if (!startEngine) return Promise.reject(new Error("No engine worker: give loadEngine an engineWorker option that starts one."));
  clearTimeout(idleTimer);
  const all = jobs.map(
    (calls, index) =>
      new Promise<BatchSettled[]>((resolve) => {
        const done = (results: BatchSettled[]) => {
          onJob?.(index, results);
          resolve(results);
        };
        if (!calls.length) return done([]);
        waiting.push({ calls: calls.map(postable), results: [], left: calls.length, done });
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

// Give each free engine the next job, starting engines (up to the most) while jobs wait; once nothing runs or waits, stop them after the idle time
function feed(): void {
  for (const engine of engines) if (!engine.job) give(engine);
  while (waiting.length && engines.length < engineCount()) give(start());
  if (!waiting.length && engines.every((engine) => !engine.job)) idleTimer = setTimeout(stopEngines, idleMs);
}

// Send an engine the next waiting job, if any
function give(engine: Engine): void {
  const job = waiting.shift();
  if (!job) return;
  const id = nextJob++;
  engine.job = { id, job };
  engine.worker.postMessage({ id, calls: job.calls });
}

// Start one engine the way the app said to
function start(): Engine {
  const engine: Engine = { worker: startEngine!(), job: null };
  // Each call's answer goes into its job; a job with every answer in is done, and the engine takes the next one
  engine.worker.onmessage = ({ data }: { data: EngineReply }) => {
    const current = engine.job;
    if (!current || current.id !== data.id) return;
    const { job } = current;
    job.results[data.index] = data.error === undefined ? { status: "fulfilled", value: revived(data.value) as BatchResult } : { status: "rejected", reason: new Error(data.error) };
    if (--job.left) return;
    engine.job = null;
    job.done(job.results);
    feed();
  };
  // A crashed engine fails the calls of its job that hadn't answered, and is left out (the next jobs start another one)
  engine.worker.onerror = (event) => {
    engine.worker.terminate();
    engines = engines.filter((other) => other !== engine);
    if (engine.job) fail(engine.job.job, event.message || "Engine worker failed.");
    engine.job = null;
    feed();
  };
  engines.push(engine);
  return engine;
}

// Fail a job's calls that hadn't answered
function fail(job: Job, message: string): void {
  for (let index = 0; index < job.calls.length; index++) job.results[index] ??= { status: "rejected", reason: new Error(message) };
  job.left = 0;
  job.done(job.results);
}
