// The solve server: the engine in an AWS Lambda behind a function URL, answering one engine call per request (the calls batch mode takes), so an app's
// page builds no tables and loads no answer files (see the README's "Solve server"). Each container loads the engine and the full answer files once and
// keeps its tables between requests. Bundled by server/build.mjs, with the search helper and the scoring worker in threads, as the benchmarks run them

// The answer files, next to the bundle, gzipped
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
// The compiled Rust search code
import wasm from "../search/pkg/puzzly_search_bg.wasm";
// Engine setup and the calls a request may make
import { loadEngine } from "../src/engine/setup";
import { solveStep, stepCandidates } from "../src/engine/step/step";
import { runMethod } from "../src/engine/method/run";
import { searchMethod } from "../src/engine/method/search";
import { beamSearchMethod } from "../src/engine/method/beam";
import type { BatchCalls } from "../src/engine/worker/protocol";
// The search worker, run in this thread, its helpers and the scoring worker in threads of their own
import { sameThreadSearchWorker } from "../src/engine/worker/search-worker";
import { nodeHelper, nodeScoringWorker } from "../bench/node-helper";
// Arguments and results as JSON
import { fromWire, toWire } from "../src/engine/remote/wire";
// The month's spend
import { addUsage, reserveUsage, thisMonth, usedThisMonth } from "./usage";

// The engine functions a request may call, by name
const CALLS: BatchCalls = { solveStep, stepCandidates, runMethod, searchMethod, beamSearchMethod };
// GB-seconds the server may run a month (BUDGET_GBS; none = no limit), and the memory each second is billed for
const BUDGET_GBS = Number(process.env.BUDGET_GBS ?? Infinity);
const MEMORY_GB = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? 1024) / 1024;

// The full answer files next to the bundle (answers/*.answers.gz), unzipped
function answerFiles(): Uint8Array[] {
  const folder = new URL("./answers/", import.meta.url);
  return readdirSync(folder)
    .filter((name) => name.endsWith(".answers.gz"))
    .map((name) => gunzipSync(readFileSync(new URL(name, folder))));
}

// When this container started (its first request is billed for its start too), and the engine loading meanwhile: idle stops are put off for good,
// since a stopped search worker would lose its tables
let startedAt: number | null = Date.now();
const search = sameThreadSearchWorker({ wasm, helper: nodeHelper, tableDatabase: null });
const ready = loadEngine({ searchWorker: () => search, scoringWorker: nodeScoringWorker, wasm, workerIdleMs: 2 ** 31 - 1, answerFiles: answerFiles() });

// A function URL request (payload format 2.0): the parts the server reads
interface UrlEvent {
  requestContext?: { http?: { method?: string } };
  body?: string;
  isBase64Encoded?: boolean;
}

// The part of a request's invocation context the server reads (none when check.ts calls it in this process)
interface UrlContext {
  getRemainingTimeInMillis(): number;
}

// A JSON reply (the function URL adds the CORS headers)
function reply(statusCode: number, body: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Answer a request, counting the time it took (with the container's start, for its first) in the month's spend. An engine call counts the most it may
// run before it starts (see answer) and gives back what it didn't use here, so one Lambda stops at its time limit, which never gets here, counts in full
export async function handler(event: UrlEvent, context?: UrlContext) {
  const begun = startedAt ?? Date.now();
  startedAt = null;
  const spent = () => ((Date.now() - begun) / 1000) * MEMORY_GB;
  const charge = { reserved: 0 };
  try {
    return await answer(event, () => spent() + ((context?.getRemainingTimeInMillis() ?? 0) / 1000) * MEMORY_GB, charge);
  } finally {
    await (charge.reserved ? addUsage(spent() - charge.reserved, 0) : addUsage(spent()));
  }
}

// GET: the month's spend. POST { call, args }: the call's result as { value }, or { error }. Before a call runs, the most it may cost (`most`: its time so
// far and all it may still run) is counted in the month's spend, in `charge`, only if it fits in the budget: a call that may not fit is refused
async function answer(event: UrlEvent, most: () => number, charge: { reserved: number }) {
  if (event.requestContext?.http?.method === "GET") return reply(200, { month: thisMonth(), ...(await usedThisMonth()), budgetGbs: BUDGET_GBS });
  let request: { call?: string; args?: unknown };
  try {
    request = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : (event.body ?? ""));
  } catch {
    return reply(400, { error: "The request isn't JSON" });
  }
  const run = Object.hasOwn(CALLS, request.call ?? "") ? (CALLS[request.call as keyof BatchCalls] as (...args: unknown[]) => Promise<unknown>) : null;
  if (!run || !Array.isArray(request.args)) return reply(400, { error: `Send { call, args }, call one of ${Object.keys(CALLS).join(", ")}` });
  const reserved = most();
  if (!(await reserveUsage(reserved, BUDGET_GBS))) return reply(429, { error: "The solve server has spent this month's budget: solve in the page", budget: true });
  charge.reserved = reserved;
  try {
    await ready;
    return reply(200, { value: toWire(await run(...(fromWire(request.args) as unknown[]))) });
  } catch (error) {
    return reply(500, { error: error instanceof Error ? error.message : String(error) });
  }
}
