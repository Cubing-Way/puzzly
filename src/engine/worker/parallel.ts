// Parallel split searches: helper workers each hold a copy of a goal's sub-tables and search some of an IDA* iteration's first moves, so a long search uses
// every core. Answers stay the same as one search's: an iteration visits paths in turn order, so its answer is the one under the first prefix that has one

// Types of the Rust search crate's glue (built by `npm run build-search`)
import type { DistanceTable, SplitSearch } from "../../../search/pkg/puzzly_search.js";

// Error texts, the same as the Rust side's (thrown as plain strings, like the wasm calls throw them)
const NO_SOLUTION = "No solution found!";
export const NODE_LIMIT = "Node limit reached";
// Longest answer a split search looks for (the Rust MAX_LENGTH): bounds stop below this + 1
const MAX_LENGTH = 40;
// Nodes a search first spends here alone, in one plain call (~60 ms): almost every search ends within it, exactly as without helpers
const ALONE_NODES = 20_000;
// Moves each task starts with: 2 gives ~240 tasks per iteration with face turns, so the work spreads evenly however lopsided the subtrees are,
// and the tasks still running when the answer turns up are a small share
const PREFIX_LENGTH = 2;
// An iteration predicted to visit at least this many nodes (~0.15 s alone) is spread over the helpers; smaller ones run here (each task costs a message round trip)
const PARALLEL_NODES = 50_000;
// Assumed growth of an iteration's nodes per extra move, to predict the next one from the last (face turns grow ~13× per move, DR moves less)
const GROWTH = 10;

// What one iteration (or one task of it) gave, as Rust's SplitSearch.iterate says: the first prefix with an answer (index, -1 = none) and the answer,
// whether a deeper bound could still find one, the nodes visited, and whether the node budget ran out
interface Iteration {
  found: number;
  answer: string;
  cut: boolean;
  nodes: number;
  gaveUp: boolean;
}

// A goal as helpers rebuild it: the same planned split (same puzzle, targets, moves and sub-table limit) with its sub-tables, by cache key, in sub-table order
// (worked out only when the helpers don't hold the goal yet)
export interface ParallelGoal {
  id: number;
  split: SplitSearch;
  kpuzzle: string;
  targets: string;
  moves: string;
  limit: number;
  tables: () => { key: string; targets: string; table: DistanceTable }[];
}

// Messages a helper gets: a table's bytes, a goal to plan, goals and tables to free, or one task (an iteration through some prefixes) to search
export type HelperMessage =
  | { kind: "table"; key: string; kpuzzle: string; targets: string; moves: string; bytes: Uint8Array }
  | { kind: "goal"; goal: number; kpuzzle: string; targets: string; moves: string; limit: number; keys: string[] }
  | { kind: "drop"; goals: number[]; keys: string[] }
  | { kind: "iterate"; task: number; goal: number; start: string; bound: number; prefixes: string; maxNodes: number };

// A helper's reply: a task's result as JSON, or the error it threw
export interface HelperReply {
  task: number;
  result?: string;
  error?: string;
}

// The part of a Worker the pool uses (a browser Worker, or a Node worker_threads one wrapped to look like it)
export interface HelperWorker {
  postMessage(message: HelperMessage, transfer?: Transferable[]): void;
  onmessage: ((event: { data: HelperReply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

// One helper, the task it is searching (one at a time) and what to do with its reply
interface Helper {
  worker: HelperWorker;
  task: { id: number; done: (result: Iteration | null, error?: unknown) => void } | null;
}

// One iteration being spread: its prefixes, the next one to hand out, the first one with an answer so far (end: tasks from it on aren't needed),
// the merged result, the prefixes being searched, and how it ends (a helper's error ends it at once)
interface Job {
  goal: ParallelGoal;
  start: string;
  bound: number;
  budget: number;
  list: string[];
  next: number;
  end: number;
  total: Iteration;
  running: Set<number>;
  settled: boolean;
  resolve: (result: Iteration) => void;
  reject: (error: unknown) => void;
}

// Let messages from helpers in (their replies hand out the next tasks) before this thread searches again: setImmediate in Node, a message to itself in browsers
// (setTimeout waits at least 4 ms once nested)
const channel = typeof setImmediate === "function" ? null : new MessageChannel();
const yielded: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => yielded.shift()?.();
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    if (!channel) return setImmediate(resolve);
    yielded.push(resolve);
    channel.port2.postMessage(null);
  });
}

// Helper workers started on the first long search, the goals and tables they all hold (the same ones in each), and the search nodes the last search used
export class HelperPool {
  private helpers: Helper[] = [];
  // Goals the helpers hold, least recently used first, with their tables' keys; each table's memory in MB (a table no goal uses is freed)
  private goals = new Map<number, string[]>();
  private tables = new Map<string, number>();
  // Each goal's prefixes (move texts), worked out once
  private prefixes = new Map<number, string[]>();
  // The iteration being spread (helpers that finish a task take their next one from it), and the last task number
  private job: Job | null = null;
  private nextTask = 0;
  // Set when a helper failed: searches run here alone from then on
  private broken = false;
  // Search nodes the last search used, here and in the helpers
  nodes = 0;

  // `count` helpers made by `spawn`, each holding at most about maxMb of tables (always the current goal's, whatever its size)
  constructor(
    private spawn: () => HelperWorker,
    private count: number,
    private maxMb: number,
  ) {}

  // Shortest answer from a start (twips's contract: answers shorter than maxDepth; NO_SOLUTION / NODE_LIMIT thrown as strings), with a node budget:
  // first one plain search here for up to ALONE_NODES, then IDA* one iteration at a time, small ones here, big ones spread over the helpers and this thread
  async search(goal: ParallelGoal, start: string, maxDepth: number | undefined, maxNodes: number): Promise<string> {
    // One plain search here: the whole search without helpers, else its first ALONE_NODES nodes
    const alone = this.broken || this.count === 0 ? maxNodes : Math.min(maxNodes, ALONE_NODES);
    try {
      const answer = goal.split.search(start, JSON.stringify({ ...(maxDepth === undefined ? {} : { maxDepth }), ...(alone === Infinity ? {} : { maxNodes: alone }) }));
      this.nodes = goal.split.nodes();
      return answer;
    } catch (error) {
      this.nodes = goal.split.nodes();
      if (alone >= maxNodes || !String(error).includes(NODE_LIMIT)) throw error;
    }
    // A long search goes on where that one stopped: the rest of its iteration over the helpers (from the first moves it was on), then deeper ones
    const stop = JSON.parse(goal.split.stopped()) as { bound: number; path: string; cut: boolean };
    const list = this.prefixList(goal);
    const on = stop.path.split(" ").filter(Boolean).slice(0, PREFIX_LENGTH);
    let from = Math.max(0, list.findIndex((prefix) => prefix.split(" ").slice(0, on.length).join(" ") === on.join(" ")));
    let cut = stop.cut;
    let last = this.nodes;
    const limit = Math.min(maxDepth ?? Infinity, MAX_LENGTH + 1);
    for (let bound = stop.bound; bound < limit; bound++) {
      // A big iteration over the helpers, a small one here (also once a helper failed)
      const budget = maxNodes - this.nodes;
      const spread = !this.broken && last * GROWTH >= PARALLEL_NODES;
      const result = spread ? await this.spread(goal, start, bound, budget, from).catch(() => this.alone(goal, start, bound, budget)) : this.local(goal.split, start, bound, [""], budget);
      this.nodes += result.nodes;
      if (result.gaveUp) throw NODE_LIMIT;
      if (result.found >= 0) return result.answer;
      // Nothing was cut by the bound: no deeper answer either
      if (!result.cut && !cut) break;
      last = result.nodes;
      from = 0;
      cut = false;
    }
    throw NO_SOLUTION;
  }

  // Free a goal's copy in the helpers (its search here was freed), and the tables no other goal uses
  dropGoal(id: number): void {
    this.prefixes.delete(id);
    if (!this.goals.delete(id)) return;
    this.post({ kind: "drop", goals: [id], keys: this.unused() });
  }

  // Stop every helper (they hold copies of tables only, nothing else is lost)
  close(): void {
    for (const helper of this.helpers) helper.worker.terminate();
    this.helpers = [];
    this.goals.clear();
    this.tables.clear();
  }

  // One iteration through these prefixes here, with a node budget
  private local(split: SplitSearch, start: string, bound: number, prefixes: string[], budget: number): Iteration {
    return JSON.parse(split.iterate(start, bound, JSON.stringify(prefixes), Math.max(0, budget)));
  }

  // A helper failed: stop them all, and do this iteration here
  private alone(goal: ParallelGoal, start: string, bound: number, budget: number): Iteration {
    this.broken = true;
    this.close();
    return this.local(goal.split, start, bound, [""], budget);
  }

  // A goal's prefixes (the tasks an iteration is split into, in the order it visits them), worked out once
  private prefixList(goal: ParallelGoal): string[] {
    let list = this.prefixes.get(goal.id);
    if (!list) {
      list = JSON.parse(goal.split.prefixes(PREFIX_LENGTH)) as string[];
      this.prefixes.set(goal.id, list);
    }
    return list;
  }

  // One iteration over every helper and this thread, one prefix per task, handed out in order from prefix `from` (the ones before it are done);
  // it ends once every prefix before the first answer has been searched (an earlier prefix may still have one), without waiting for the tasks after it
  // (their helpers join the next iteration when done)
  private spread(goal: ParallelGoal, start: string, bound: number, budget: number, from: number): Promise<Iteration> {
    this.prepare(goal);
    const list = this.prefixList(goal);
    return new Promise((resolve, reject) => {
      const job: Job = {
        goal,
        start,
        bound,
        budget,
        list,
        next: from,
        end: list.length,
        total: { found: -1, answer: "", cut: false, nodes: 0, gaveUp: false },
        running: new Set(),
        settled: false,
        resolve,
        reject,
      };
      this.job = job;
      for (const helper of this.helpers) this.feed(helper);
      void this.work(job);
      this.settle(job);
    });
  }

  // This thread's share of an iteration: one prefix at a time, letting helpers' replies in between
  private async work(job: Job): Promise<void> {
    while (!job.settled) {
      await yieldToMessages();
      const index = this.take(job);
      if (index === null) return;
      try {
        this.record(job, index, this.local(job.goal.split, job.start, job.bound, [job.list[index]], job.budget - job.total.nodes));
      } catch (error) {
        this.fail(job, error);
      }
    }
  }

  // Give an idle helper its next task from the iteration being spread
  private feed(helper: Helper): void {
    const job = this.job;
    if (helper.task || !job) return;
    const index = this.take(job);
    if (index === null) return;
    const id = this.nextTask++;
    helper.task = {
      id,
      done: (result, error) => {
        helper.task = null;
        if (result) this.record(job, index, result);
        else this.fail(job, error);
        // Then the next task, from whichever iteration is being spread by now
        this.feed(helper);
      },
    };
    helper.worker.postMessage({ kind: "iterate", task: id, goal: job.goal.id, start: job.start, bound: job.bound, prefixes: JSON.stringify([job.list[index]]), maxNodes: Math.max(0, job.budget - job.total.nodes) });
  }

  // Whether prefixes are left to hand out: some before the first answer so far, with budget left
  private more(job: Job): boolean {
    return !job.settled && job.next < job.end && !job.total.gaveUp && job.total.nodes < job.budget;
  }

  // The next prefix to search, or null when none is left to hand out
  private take(job: Job): number | null {
    if (!this.more(job)) return null;
    job.running.add(job.next);
    return job.next++;
  }

  // Add one task's result to its iteration (an answer under an earlier prefix than any so far becomes the iteration's), then see whether it's done
  private record(job: Job, index: number, result: Iteration): void {
    job.running.delete(index);
    if (job.settled) return;
    const { total } = job;
    total.nodes += result.nodes;
    total.cut ||= result.cut;
    total.gaveUp ||= result.gaveUp;
    if (result.found >= 0 && index < job.end) {
      job.end = index;
      total.answer = result.answer;
    }
    this.settle(job);
  }

  // End the iteration once nothing is left to hand out and no prefix before the first answer is still being searched
  private settle(job: Job): void {
    if (job.settled || this.more(job) || [...job.running].some((running) => running < job.end)) return;
    job.settled = true;
    if (this.job === job) this.job = null;
    const { total } = job;
    if (total.nodes >= job.budget) total.gaveUp = true;
    total.found = job.end < job.list.length ? job.end : -1;
    job.resolve(total);
  }

  // A task failed: the iteration fails at once (the search then finishes here alone)
  private fail(job: Job, error: unknown): void {
    if (job.settled) return;
    job.settled = true;
    if (this.job === job) this.job = null;
    job.reject(error);
  }

  // Make sure every helper holds this goal (sending the tables they lack), freeing the least recently used other goals past the memory limit
  private prepare(goal: ParallelGoal): void {
    if (!this.helpers.length) this.start();
    // Held already: just mark it as recently used
    const keys = this.goals.get(goal.id);
    if (keys) {
      this.goals.delete(goal.id);
      this.goals.set(goal.id, keys);
      return;
    }
    // Room first: drop old goals (and the tables only they use) while this one's new tables wouldn't fit
    const tables = goal.tables();
    const keep = new Set(tables.map(({ key }) => key));
    const adding = tables.filter(({ key }) => !this.tables.has(key)).reduce((mb, { table }) => mb + table.bytes() / 2 ** 20, 0);
    const dropped: number[] = [];
    const freed: string[] = [];
    for (const id of [...this.goals.keys()]) {
      if (this.memory() + adding <= this.maxMb) break;
      this.goals.delete(id);
      this.prefixes.delete(id);
      dropped.push(id);
      freed.push(...this.unused(keep));
    }
    if (dropped.length) this.post({ kind: "drop", goals: dropped, keys: freed });
    // The tables they lack (a copy each), then the goal
    for (const { key, targets, table } of tables) {
      if (this.tables.has(key)) continue;
      const bytes = table.toBytes();
      this.helpers.forEach((helper, index) => {
        const copy = index === this.helpers.length - 1 ? bytes : bytes.slice();
        helper.worker.postMessage({ kind: "table", key, kpuzzle: goal.kpuzzle, targets, moves: goal.moves, bytes: copy }, [copy.buffer as ArrayBuffer]);
      });
      this.tables.set(key, table.bytes() / 2 ** 20);
    }
    this.goals.set(goal.id, [...keep]);
    this.post({ kind: "goal", goal: goal.id, kpuzzle: goal.kpuzzle, targets: goal.targets, moves: goal.moves, limit: goal.limit, keys: tables.map(({ key }) => key) });
  }

  // Start the helpers; a helper's error fails the task it was on (the search then finishes here)
  private start(): void {
    for (let index = 0; index < this.count; index++) {
      const helper: Helper = { worker: this.spawn(), task: null };
      helper.worker.onmessage = ({ data }) => {
        const task = helper.task;
        if (!task || task.id !== data.task) return;
        if (data.error !== undefined) task.done(null, data.error);
        else task.done(JSON.parse(data.result!));
      };
      // A helper that failed can't be trusted with more tasks: searches run here alone from then on
      helper.worker.onerror = (event) => {
        this.broken = true;
        helper.task?.done(null, event);
        if (this.job) this.fail(this.job, event);
      };
      this.helpers.push(helper);
    }
  }

  // Send the same message to every helper
  private post(message: HelperMessage): void {
    for (const helper of this.helpers) helper.worker.postMessage(message);
  }

  // Memory the helpers' tables take (each helper), in MB
  private memory(): number {
    let mb = 0;
    for (const size of this.tables.values()) mb += size;
    return mb;
  }

  // Forget the tables no held goal uses (nor the ones about to be), giving their keys so the helpers free them too
  private unused(keep = new Set<string>()): string[] {
    const used = new Set([...this.goals.values()].flat());
    const keys = [...this.tables.keys()].filter((key) => !used.has(key) && !keep.has(key));
    for (const key of keys) this.tables.delete(key);
    return keys;
  }
}
