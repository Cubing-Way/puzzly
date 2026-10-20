// Scoring worker: scores a step's listed answers by speed (step/scoring.ts) off the page's thread, while the search worker lists more of them. With
// helpers, chunks of the answers go to them as they free up: each works out its chunk's looks and writings against this worker's bars as they are then,
// and this worker, which still scores every answer in order, takes those numbers instead of working them out again (only where every input is the
// same, so the solves are too). An app's scoring worker script calls runScoringWorker once, passing the compiled Rust code and how to start helpers

// Cube patterns
import { KPattern } from "cubing/kpuzzle";
// The speed model in Rust (wasm-bindgen glue for the search crate, built by `npm run build-search`)
import { SpeedModel, type InitInput } from "../../../search/pkg/puzzly_search.js";
// The cube definition, loaded here too (looks and held cubes need it)
import { kpuzzle, loadPuzzle } from "../core/puzzle";
// Scores with the speed model in Rust
import { useRustSpeed } from "../speed/fingering";
// One alternative × grip of a step
import type { Combo } from "../step/combo";
// A step's scoring by speed, the same as on the page, and what it shares with helpers
import { makeScorer, type Ahead, type Scorer, type Sharing } from "../step/scoring";
// How many scoring helpers to start at most, and from how many threads on
import { MAX_SCORING_HELPERS, SCORING_HELPER_THREADS } from "./limits";
// Messages to and from the page and the helpers
import type { ComboData, ListedData, RankedData, ScoringBegin, ScoringHelperReply, ScoringHelperWorker, ScoringReply, ScoringRequest } from "./protocol";
// Loads the Rust code once per thread
import { loadWasm } from "./wasm";

// What the app's scoring worker script gives the scoring worker
export interface ScoringWorkerOptions {
  // The compiled Rust code (search/pkg/puzzly_search_bg.wasm): its bytes, a URL to fetch it from, or a compiled module
  wasm: InitInput | Promise<InitInput>;
  // Starts one helper: a worker whose script calls runScoringHelper (see scoring-helper.ts). Left out: this worker works alone
  helper?: () => ScoringHelperWorker;
  // Most helpers to start (default MAX_SCORING_HELPERS): none on a device reporting SCORING_HELPER_THREADS threads or fewer, else one per 2 threads more,
  // up to this many
  maxHelpers?: number;
}

// Answers in a chunk: what this worker or one helper works out at a time (a few milliseconds of scoring)
const CHUNK = 64;

// A step's combos as the page has them, from their data: patterns rebuilt, twins linked (start and bound aren't scored, so they're the held cube and 0)
export function combosOf(data: ComboData[]): Combo[] {
  const combos = data.map((combo): Combo => {
    const held = new KPattern(kpuzzle, combo.held);
    return {
      alternative: combo.alternative,
      rotation: combo.rotation,
      goal: combo.goal,
      fresh: combo.fresh,
      held,
      start: held,
      offsets: combo.offsets,
      targets: combo.targets.map((target) => new KPattern(kpuzzle, target)),
      bound: 0,
      ...(combo.cube ? { cube: new KPattern(kpuzzle, combo.cube) } : {}),
    };
  });
  data.forEach((combo, place) => {
    if (combo.twins) combos[place].twins = combo.twins.map((twin) => combos[twin]);
  });
  return combos;
}

// One chunk of a scoring's answers, and the looks and writings a helper is working out for it (none: this worker works them out itself)
interface Chunk {
  answers: ListedData[];
  ahead?: Promise<Ahead | undefined>;
}

// One helper: its worker, the scorings it has begun, the chunk it's working on (one at a time, so the next one goes out with the bars as they are then)
// and whether it still works
interface Helper {
  worker: ScoringHelperWorker;
  begun: Set<number>;
  busy: ((ahead: Ahead | undefined) => void) | null;
  alive: boolean;
}

// One step's scoring here: how it began (sent to helpers when they first get a chunk of it), the scorer and the step's combos, what it shares with
// helpers, its chunks so far, the next one to score, how many were handed out or taken here, whether chunks are being scored, who waits for every
// chunk to be scored (its finish), and the error that stopped it
interface Scoring {
  begin: ScoringBegin;
  scorer: Scorer;
  combos: Combo[];
  share: Sharing;
  chunks: Chunk[];
  next: number;
  given: number;
  running: boolean;
  idle: (() => void)[];
  error?: string;
}

// Start handling the page's scorings in this worker: load the cube definition and the Rust code, then take the messages in order; call it once from the
// worker's script
export function runScoringWorker(options: ScoringWorkerOptions): void {
  // Worker-side global (tsconfig only has the page's DOM types)
  const scope = self as unknown as Worker;
  // Scorings under way, by the page's number
  const scorings = new Map<number, Scoring>();
  // Helpers, started on first use: none on a small device, else one per 2 threads beyond SCORING_HELPER_THREADS
  const threads = globalThis.navigator?.hardwareConcurrency ?? 1;
  const most = options.helper ? Math.max(0, Math.min(Math.ceil((threads - SCORING_HELPER_THREADS) / 2), options.maxHelpers ?? MAX_SCORING_HELPERS)) : 0;
  let helpers: Helper[] | null = null;
  const helperPool = (): Helper[] => {
    helpers ??= Array.from({ length: most }, () => {
      const helper: Helper = { worker: options.helper!(), begun: new Set(), busy: null, alive: true };
      // A chunk's looks and writings, as one lookup each (an error leaves the chunk to this worker); the helper then takes the next chunk
      helper.worker.onmessage = ({ data }) => {
        const done = helper.busy;
        helper.busy = null;
        done?.(data.error === undefined ? { looks: new Map(data.looks), writings: new Map(data.writings) } : undefined);
        for (const scoring of scorings.values()) handOut(scoring);
      };
      // A crashed helper gets no more chunks, and this worker works out the one it had
      helper.worker.onerror = () => {
        helper.alive = false;
        helper.busy?.(undefined);
        helper.busy = null;
      };
      return helper;
    });
    return helpers;
  };
  // Hand the scoring's next chunks to the helpers that are free, with this worker's sure answers as they are now (its first chunk is this worker's own,
  // so a step with few answers never waits on a helper)
  const handOut = (scoring: Scoring): void => {
    const { id } = scoring.begin;
    for (const helper of most ? helperPool() : []) {
      if (!helper.alive || helper.busy) continue;
      scoring.given = Math.max(scoring.given, scoring.next, 1);
      if (scoring.given >= scoring.chunks.length) return;
      const chunk = scoring.chunks[scoring.given++];
      if (!helper.begun.has(id)) {
        helper.begun.add(id);
        helper.worker.postMessage(scoring.begin);
      }
      chunk.ahead = new Promise((done) => {
        helper.busy = done;
        helper.worker.postMessage({ id, kind: "chunk", chunk: scoring.given - 1, sures: scoring.scorer.sures(), answers: chunk.answers });
      });
    }
  };
  // Score the chunks in order: each with the numbers its helper worked out (waiting for them), or alone when no helper took it
  const run = async (scoring: Scoring): Promise<void> => {
    if (scoring.running) return;
    scoring.running = true;
    const { share, scorer, combos } = scoring;
    while (scoring.next < scoring.chunks.length) {
      handOut(scoring);
      const chunk = scoring.chunks[scoring.next];
      // Nobody took it: this worker works it out alone
      scoring.given = Math.max(scoring.given, scoring.next + 1);
      share.ahead = chunk.ahead && (await chunk.ahead);
      try {
        for (const [combo, moves, length, order] of chunk.answers) scorer.add({ answer: { combo: combos[combo], moves }, length, order, key: "", speed: Infinity });
      } catch (error) {
        scoring.error ??= String((error as Error).message ?? error);
      }
      share.ahead = undefined;
      scoring.next++;
    }
    scoring.running = false;
    for (const done of scoring.idle.splice(0)) done();
  };
  // Answers added: cut into chunks, handed out to free helpers, and scored in order
  const add = (scoring: Scoring, answers: ListedData[]): void => {
    for (let at = 0; at < answers.length; at += CHUNK) scoring.chunks.push({ answers: answers.slice(at, at + CHUNK) });
    handOut(scoring);
    void run(scoring);
  };
  // One scoring message: begin it, score the answers added (in the order they come), or finish it and send back the ranked answers
  const handle = async (request: ScoringRequest): Promise<void> => {
    const scoring = scorings.get(request.id);
    try {
      if (request.kind === "begin") {
        const combos = combosOf(request.combos);
        const ids = new Map(combos.map((combo, place) => [combo, place]));
        const share: Sharing = { idOf: (combo) => ids.get(combo)! };
        scorings.set(request.id, { begin: request, scorer: makeScorer(request.scramble, request.pieces, request.options, request.places, share), combos, share, chunks: [], next: 0, given: 0, running: false, idle: [] });
      } else if (scoring && request.kind === "add") {
        add(scoring, request.answers);
      } else if (request.kind === "finish") {
        if (!scoring) throw new Error("Scoring never began.");
        // Every chunk scored, the helpers told to drop it, then the ranked answers with their combos as places in the step's list
        if (scoring.running || scoring.next < scoring.chunks.length) await new Promise<void>((done) => scoring.idle.push(done));
        scorings.delete(request.id);
        for (const helper of helpers ?? []) {
          if (helper.begun.delete(request.id) && helper.alive) helper.worker.postMessage({ id: request.id, kind: "end" });
        }
        if (scoring.error) throw new Error(scoring.error);
        const places = new Map(scoring.combos.map((combo, place) => [combo, place]));
        const ranked = scoring.scorer.rank().map(({ answer, length, order, key, speed, wide, form, tier }): RankedData => ({ combo: places.get(answer.combo)!, moves: answer.moves, length, order, key, speed, wide, form, tier }));
        scope.postMessage({ id: request.id, ranked } satisfies ScoringReply);
      }
    } catch (error) {
      const message = String((error as Error).message ?? error);
      // A scoring that fails keeps its error until its finish, which sends it back
      if (request.kind === "finish") scope.postMessage({ id: request.id, error: message } satisfies ScoringReply);
      else if (scoring) scoring.error ??= message;
    }
  };
  // Messages are handled one at a time, in order, once the cube definition and the Rust code are loaded (if they can't be, each finish says why); answers
  // added go out to the helpers at once, and a finish waits for every answer of its scoring to be scored
  const ready = Promise.all([loadPuzzle(), loadWasm(options.wasm).then(() => useRustSpeed(SpeedModel))]);
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = ({ data }: MessageEvent<ScoringRequest>) => {
    queue = queue.then(() => ready).then(
      () => handle(data),
      (error) => {
        if (data.kind === "finish") scope.postMessage({ id: data.id, error: `The scoring worker couldn't load: ${String(error?.message ?? error)}` } satisfies ScoringReply);
      },
    );
  };
}
