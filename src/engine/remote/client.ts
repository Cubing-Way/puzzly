// The engine on a solve server (server/handler.ts): the calls batch mode takes, sent over HTTP, so a page solves without building tables or loading
// answer files itself (see the README's "Solve server")

// The calls a server answers, as the engine has them
import type { BatchCalls } from "../worker/protocol";
// Arguments and results as JSON
import { fromWire, toWire } from "./wire";

// A call the server didn't answer. `local` says the page should solve it itself instead: the server can't be reached, it's busy, it spent its
// monthly budget or it ran out of time; otherwise (a bad call, an error in the engine) solving it in the page would fail the same way
export class RemoteEngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly local: boolean,
  ) {
    super(message);
    this.name = "RemoteEngineError";
  }
}

// The engine functions a solve server answers (callbacks in their options are left out: they can't go over the network), given the function URL
export function remoteEngine(url: string): BatchCalls {
  const call = async (name: keyof BatchCalls, args: unknown[]): Promise<any> => {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call: name, args: toWire(args) }) });
    } catch (error) {
      throw new RemoteEngineError(`The solve server can't be reached (${error instanceof Error ? error.message : error})`, 0, true);
    }
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) {
      const local = response.status === 429 || response.status >= 502;
      throw new RemoteEngineError(reply.error ?? reply.message ?? `The solve server answered ${response.status}`, response.status, local);
    }
    return fromWire(reply.value);
  };
  return {
    solveStep: (...args) => call("solveStep", args),
    stepCandidates: (...args) => call("stepCandidates", args),
    runMethod: (...args) => call("runMethod", args),
    searchMethod: (...args) => call("searchMethod", args),
    beamSearchMethod: (...args) => call("beamSearchMethod", args),
  };
}
