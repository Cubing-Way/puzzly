// Scoring helper (started by the scoring worker, see scoring-worker.ts): works out the looks and writings of chunks of a step's answers ahead of the
// scoring worker, from the worker's sure answers, and sends them back. An app's scoring helper script calls runScoringHelper once, passing the compiled Rust code

// The speed model in Rust (wasm-bindgen glue for the search crate, built by `npm run build-search`)
import { SpeedModel, type InitInput } from "../../../search/pkg/puzzly_search.js";
// The cube definition, loaded here too (looks and held cubes need it)
import { loadPuzzle } from "../core/puzzle";
// Scores with the speed model in Rust
import { useRustSpeed } from "../speed/fingering";
// One alternative × grip of a step
import type { Combo } from "../step/combo";
// A step's scoring by speed, the same as the scoring worker's, and what it shares with it
import { makeScorer, type Ahead, type Scorer } from "../step/scoring";
// Messages to and from the scoring worker
import type { ScoringHelperMessage, ScoringHelperReply } from "./protocol";
// A step's combos rebuilt from their data, as the scoring worker does it
import { combosOf } from "./scoring-worker";
// Loads the Rust code once per thread
import { loadWasm } from "./wasm";

// What the app's scoring helper script gives the scoring helper
export interface ScoringHelperOptions {
  // The compiled Rust code (search/pkg/puzzly_search_bg.wasm): its bytes, a URL to fetch it from, or a compiled module
  wasm: InitInput | Promise<InitInput>;
}

// One step's scoring here: a scorer that ranks nothing (it goes on from the worker's sure answers for each chunk), the step's combos, and what it shares
// (where its looks and writings are noted)
interface Scoring {
  scorer: Scorer;
  combos: Combo[];
  share: { idOf: (combo: Combo) => number; helper: true; record: Ahead };
}

// Start handling the scoring worker's messages in this worker: load the cube definition and the Rust code, then take them in order; call it once from the
// helper's script
export function runScoringHelper(options: ScoringHelperOptions): void {
  // Worker-side global (tsconfig only has the page's DOM types)
  const scope = self as unknown as Worker;
  // Scorings begun, by the scoring worker's number
  const scorings = new Map<number, Scoring>();
  // One message: begin a scoring, work out one chunk's looks and writings and send them back, or end a scoring
  const handle = (message: ScoringHelperMessage): void => {
    if (message.kind === "begin") {
      const combos = combosOf(message.combos);
      const ids = new Map(combos.map((combo, place) => [combo, place]));
      const share = { idOf: (combo: Combo) => ids.get(combo)!, helper: true as const, record: { looks: new Map(), writings: new Map() } };
      scorings.set(message.id, { scorer: makeScorer(message.scramble, message.pieces, message.options, message.places, share), combos, share });
    } else if (message.kind === "end") {
      scorings.delete(message.id);
    } else {
      const scoring = scorings.get(message.id);
      try {
        if (!scoring) throw new Error("Scoring never began.");
        // The chunk scored as the worker will score it, from its sure answers as they were when it sent the chunk; what that works out is noted
        const { scorer, combos, share } = scoring;
        scorer.resume(message.sures);
        share.record = { looks: new Map(), writings: new Map() };
        for (const [combo, moves, length, order] of message.answers) scorer.add({ answer: { combo: combos[combo], moves }, length, order, key: "", speed: Infinity });
        scope.postMessage({ id: message.id, chunk: message.chunk, looks: [...share.record.looks], writings: [...share.record.writings] } satisfies ScoringHelperReply);
      } catch (error) {
        scope.postMessage({ id: message.id, chunk: message.chunk, error: String((error as Error).message ?? error) } satisfies ScoringHelperReply);
      }
    }
  };
  // Messages are handled one at a time, in order, once the cube definition and the Rust code are loaded (if they can't be, each chunk says why)
  const ready = Promise.all([loadPuzzle(), loadWasm(options.wasm).then(() => useRustSpeed(SpeedModel))]);
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = ({ data }: MessageEvent<ScoringHelperMessage>) => {
    queue = queue.then(() => ready).then(
      () => handle(data),
      (error) => {
        if (data.kind === "chunk") scope.postMessage({ id: data.id, chunk: data.chunk, error: `The scoring helper couldn't load: ${String(error?.message ?? error)}` } satisfies ScoringHelperReply);
      },
    );
  };
}
