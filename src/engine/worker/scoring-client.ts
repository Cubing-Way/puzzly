// Page side of the scoring worker: a step ranked by speed sends it its answers as they're listed, so they're scored while the search worker lists
// more and the page stays free; without a scoring worker (the app gave none) the step scores on the page, as before

// One alternative × grip of a step
import type { Combo } from "../step/combo";
// A step's scoring by speed, the same on the page and in the worker
import { makeScorer, type Listed, type Places, type ScoringOptions } from "../step/scoring";
// Messages to and from the scoring worker
import type { ComboData, ScoringReply, ScoringWorker } from "./protocol";

// How the app using the engine runs its scoring worker
export interface ScoringClientOptions {
  // Starts the scoring worker: a worker whose script calls runScoringWorker (see scoring-worker.ts). Left out: steps ranked by speed score on the page
  scoringWorker?: () => ScoringWorker;
}

// How the app starts the scoring worker (null: steps score on the page), the worker once started, scorings waiting for their ranked answers, and the
// number for the next scoring
let startWorker: (() => ScoringWorker) | null = null;
let scoringWorker: ScoringWorker | null = null;
const waiting = new Map<number, { resolve: (reply: ScoringReply) => void; reject: (error: Error) => void }>();
let nextScoring = 0;

// Set how the scoring worker is started (left out: as it was); a worker started another way is stopped
export function configureScoring(options: ScoringClientOptions): void {
  if (options.scoringWorker && options.scoringWorker !== startWorker) {
    stopScoringWorker();
    startWorker = options.scoringWorker;
  }
}

// Stop the scoring worker (the next scoring starts a fresh one)
function stopScoringWorker(): void {
  scoringWorker?.terminate();
  scoringWorker = null;
}

// Start the scoring worker on first use, the way the app said to
function getScoringWorker(start: () => ScoringWorker): ScoringWorker {
  if (scoringWorker) return scoringWorker;
  const worker = start();
  // Hand each ranked list or error to the scoring that asked for it
  worker.onmessage = ({ data }) => {
    const entry = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error !== undefined) entry?.reject(new Error(data.error));
    else entry?.resolve(data);
  };
  // A crashed worker fails every waiting scoring, and the next one starts a fresh worker
  worker.onerror = (event) => {
    for (const entry of waiting.values()) entry.reject(new Error(event.message || "Scoring worker failed."));
    waiting.clear();
    stopScoringWorker();
  };
  scoringWorker = worker;
  return worker;
}

// How long a step scores on the page before it gives the page a turn (so a timer keeps running and the page still answers), in milliseconds
const SCORING_SLICE_MS = 25;
// When a scoring step last gave the page a turn (one clock for all of them: a lookahead scores many steps at once)
let lastTurnGiven = 0;

// Give the page a turn if scoring has held it for a slice
async function givePageATurn(): Promise<void> {
  if (performance.now() - lastTurnGiven < SCORING_SLICE_MS) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  lastTurnGiven = performance.now();
}

// A step's scoring by speed: its listed answers are added as they come (the step's own shortest first), then `finish` gives them ranked (see makeScorer)
export interface ScoringSession {
  add(entries: Listed[]): void;
  finish(): Promise<Listed[]>;
}

// The scoring of one step's answers (scramble, pieces and options as the step was given them, `places` as it shares them out, `queue` its combos):
// in the scoring worker when the app gave one, else on the page once every answer is listed, with a turn for the page every few milliseconds
export function scoringSession(scramble: string, pieces: string, options: ScoringOptions, places: Places, queue: Combo[]): ScoringSession {
  if (!startWorker) {
    const scorer = makeScorer(scramble, pieces, options, places);
    const pending: Listed[] = [];
    return {
      add: (entries) => void pending.push(...entries),
      finish: async () => {
        for (const raw of pending) {
          scorer.add(raw);
          await givePageATurn();
        }
        return scorer.rank();
      },
    };
  }
  const worker = getScoringWorker(startWorker);
  const id = nextScoring++;
  // The step's combos and their twin grips as one list, each known by its place there
  const combos: Combo[] = [];
  const placeOf = new Map<Combo, number>();
  for (const combo of queue) {
    for (const each of [combo, ...(combo.twins ?? [])]) {
      if (placeOf.has(each)) continue;
      placeOf.set(each, combos.length);
      combos.push(each);
    }
  }
  // The targets only matter to answers that undo their offset (see endingOf)
  const data = combos.map(
    (combo): ComboData => ({
      alternative: combo.alternative,
      rotation: combo.rotation,
      goal: combo.goal,
      fresh: combo.fresh,
      held: combo.held.patternData,
      ...(combo.cube ? { cube: combo.cube.patternData } : {}),
      offsets: combo.offsets,
      targets: options.undoOffset ? combo.targets.map((target) => target.patternData) : [],
      ...(combo.twins?.length ? { twins: combo.twins.map((twin) => placeOf.get(twin)!) } : {}),
    }),
  );
  worker.postMessage({ id, kind: "begin", scramble, pieces, options, places, combos: data });
  return {
    add: (entries) => {
      if (entries.length) worker.postMessage({ id, kind: "add", answers: entries.map((entry) => [placeOf.get(entry.answer.combo)!, entry.answer.moves, entry.length, entry.order]) });
    },
    finish: async () => {
      const reply = await new Promise<ScoringReply>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ id, kind: "finish" });
      });
      // The ranked answers with their combos back
      return (reply.ranked ?? []).map(({ combo, moves, ...rest }) => ({ ...rest, answer: { combo: combos[combo], moves } }));
    },
  };
}
