// Whole solves through the solve server, as an app makes them with remoteEngine: CFOP levels 2 and 3 on 3 seeded scrambles (random(77), as plan-speed's
// rules ask), each with its solution as the hands make it and how long the request took. SERVER_URL=<function URL> asks the server on AWS; without it
// the handler answers in this process (server/out/check.js, next to the bundled handler and answer files), through the same JSON.
// METHODS=name1,name2 and SOLVES=n pick others (CORES=n: the threads the local handler sees, default 1)
import { random, scramble } from "../bench/setup";
import { loadEngine, readMethod, remoteEngine } from "../src/engine";
import examples from "../src/demo/example-methods.json";

const METHODS = (process.env.METHODS ?? "CFOP level 2,CFOP level 3").split(",");
const SOLVES = Number(process.env.SOLVES ?? 3);

// No server address: the handler answers fetch in this process
if (!process.env.SERVER_URL) {
  const { handler } = await import("./handler");
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const answer = await handler({ requestContext: { http: { method: init?.method ?? "GET" } }, body: init?.body as string });
    return new Response(answer.body, { status: answer.statusCode, headers: answer.headers });
  }) as typeof fetch;
}
// The cube definition, which reading a method needs (no workers: the server searches)
await loadEngine();
const engine = remoteEngine(process.env.SERVER_URL ?? "http://local");

for (const name of METHODS) {
  const method = readMethod((examples as any[]).find((example) => example.name.startsWith(name)));
  const rand = random(77);
  let all = 0;
  for (let at = 0; at < SOLVES; at++) {
    const scrambled = scramble(rand);
    const begun = performance.now();
    const result = await engine.runMethod(scrambled, method);
    const took = performance.now() - begun;
    all += took;
    console.log(`${name} #${at}: ${result.moves} moves, ${(took / 1000).toFixed(1)} s (engine ${(result.ms / 1000).toFixed(1)} s): ${result.wide ?? result.solution}`);
  }
  console.log(`${name}: ${(all / 1000).toFixed(1)} s in all`);
}
// The engine's threads would keep the process alive (as in the benchmarks)
process.exit(0);
