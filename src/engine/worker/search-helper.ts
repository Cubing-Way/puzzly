// Search helper worker (started by the search worker, see parallel.ts): holds copies of the sub-tables of goals searched in parallel,
// plans each goal the same way the search worker did, and searches the chunks of IDA* iterations it is sent.
// An app's helper script calls runSearchHelper once, passing the compiled Rust code

// wasm-bindgen glue for the Rust search crate (built by `npm run build-search`)
import init, { DistanceTable, SplitSearch, type InitInput } from "../../../search/pkg/puzzly_search.js";
// Messages to and from the search worker's helper pool
import type { HelperMessage, HelperReply } from "./parallel";

// What the app's helper script gives the search helper
export interface SearchHelperOptions {
  // The compiled Rust search code (search/pkg/puzzly_search_bg.wasm): its bytes, a URL to fetch it from, or a compiled module
  wasm: InitInput | Promise<InitInput>;
}

// Tables by cache key, and goals (split searches with their tables attached) by the search worker's goal id
const tables = new Map<string, DistanceTable>();
const goals = new Map<number, SplitSearch>();

// Handle one message: keep a table, plan a goal, free goals and tables, or search one chunk and send back its result (or the error)
function handle(scope: Worker, message: HelperMessage): void {
  if (message.kind === "table") {
    tables.get(message.key)?.free();
    tables.set(message.key, DistanceTable.fromBytes(message.kpuzzle, message.targets, message.moves, message.bytes));
  } else if (message.kind === "goal") {
    // Same plan as the search worker's (same inputs), each sub-table attached from the copies sent before
    const split = new SplitSearch(message.kpuzzle, message.targets, message.moves, message.limit);
    message.keys.forEach((key, index) => split.attach(index, tables.get(key)!));
    goals.get(message.goal)?.free();
    goals.set(message.goal, split);
  } else if (message.kind === "drop") {
    for (const id of message.goals) {
      goals.get(id)?.free();
      goals.delete(id);
    }
    for (const key of message.keys) {
      tables.get(key)?.free();
      tables.delete(key);
    }
  } else {
    // One chunk of an iteration: its result as JSON, or the error
    let reply: HelperReply;
    try {
      const split = goals.get(message.goal);
      if (!split) throw new Error("Unknown goal");
      reply = { task: message.task, result: split.iterate(message.start, message.bound, message.prefixes, message.maxNodes) };
    } catch (error) {
      reply = { task: message.task, error: String(error) };
    }
    scope.postMessage(reply);
  }
}

// Start handling the search worker's messages in this worker: load the Rust code, then take them in order; call it once from the helper's script
export function runSearchHelper(options: SearchHelperOptions): void {
  // Worker-side global (tsconfig only has the page's DOM types)
  const scope = self as unknown as Worker;
  // Messages are handled one at a time, in order, once the Rust code is loaded; a table or goal that fails to load is left out
  // (searching that goal then answers with an error, and the search worker finishes the search by itself)
  let queue: Promise<void> = init({ module_or_path: options.wasm }).then(() => undefined);
  scope.onmessage = ({ data }: MessageEvent<HelperMessage>) => {
    queue = queue.then(() => handle(scope, data)).catch(() => undefined);
  };
}
