// A cut answer file for the page from a full one (bench/answer-file.ts makes those, 137–188 MB): per case and hold only the answers a step needs most
// often (see AnswerFileCut in src/engine/step/answer-file.ts and cut-case.ts), and what was left out, so a step that could need one of those is searched
// instead. Cases are cut on worker threads (THREADS=n, default one per thread the machine has). Written gzipped into the page's answers/ folder (the
// page unpacks it), and listed in answers/answers.json there. For trying rules: CASES=<file> cuts only the cases listed there (a JSON list of their
// places, as answer-check.ts's CASES_OUT writes it) into bench/out/pairs/<name>.some.answers.gz (the others left out: searched), and a count of
// cases looks at the first ones without writing.
// Usage: [CASES=<file>] node bench/out/answer-cut.js <full file> [rank] [margin] [cancel margin] [cases]
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { loadEngine } from "../src/engine/index.ts";
import { readAnswerFile, answerFileWriter, type DroppedHold } from "../src/engine/step/answer-file.ts";
import { prepareCase, cutCase, type CutRule } from "./cut-case";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { gzipSync } from "node:zlib";

// One case cut: which of its answers are kept (their places in the full file), and what the rest leave
interface Cut {
  at: number;
  kept: number[];
  dropped: DroppedHold<string>[];
}

// The speed model in Rust (speedCost and speedFloor; leastCostAfter stays in TypeScript)
await loadEngine({ wasm });

if (!isMainThread) {
  // A worker: every `shards`th of the cases asked for from `shard` on
  const { fileName, rule, shard, shards, cases } = workerData as { fileName: string; rule: CutRule; shard: number; shards: number; cases: number[] };
  const full = readAnswerFile(readFileSync(fileName));
  for (const at of cases.filter((_, place) => place % shards === shard)) {
    const answers = prepareCase(full, full.header.cases[at]);
    const { keep, dropped } = cutCase(answers, full.header.holds.length, rule);
    parentPort!.postMessage({ at, kept: answers.flatMap((answer, index) => (keep.has(answer) ? [index] : [])), dropped } satisfies Cut);
  }
  parentPort!.close();
} else {
  const [fileName, rankText = "4", marginText = "1", cancelText = "0", casesText] = process.argv.slice(2);
  if (!fileName) throw new Error("usage: node bench/out/answer-cut.js <full file> [rank] [margin] [cancel margin] [cases]");
  const started = performance.now();
  const seconds = () => `${((performance.now() - started) / 1000).toFixed(0)} s`;
  const bytes = readFileSync(fileName);
  const full = readAnswerFile(bytes);
  if (full.header.cut) throw new Error(`${fileName} is cut already`);
  const { header } = full;
  const rule: CutRule = { rank: Number(rankText), margin: Number(marginText), cancelMargin: Number(cancelText) };
  // The cases to cut: those listed, the first few, or all
  const asked = process.env.CASES ? new Set<number>(JSON.parse(readFileSync(process.env.CASES, "utf8"))) : null;
  const cases = header.cases.map((_, at) => at).filter((at) => (asked ? asked.has(at) : at < (casesText ? Number(casesText) : header.cases.length)));
  const cuts: Cut[] = [];
  const shards = Math.max(1, Math.min(cases.length, Number(process.env.THREADS ?? availableParallelism())));
  await Promise.all(
    Array.from({ length: shards }, (_, shard) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { fileName, rule, shard, shards, cases } });
      worker.on("message", (cut: Cut) => {
        cuts[cut.at] = cut;
        const done = cuts.filter(Boolean).length;
        if (done % 100 === 0) console.log(`${done} cases cut, ${seconds()}`);
      });
      return new Promise<void>((resolve, reject) => {
        worker.on("error", reject);
        worker.on("exit", () => resolve());
      });
    }),
  );
  const cut = { ...rule, answers: 0, bytes: bytes.length };
  const writer = answerFileWriter({ pieces: header.pieces, options: header.options, holds: header.holds, cut });
  let kept = 0;
  for (const at of cases) {
    const entry = header.cases[at];
    const answers = prepareCase(full, entry);
    writer.add({ key: entry.key, bound: entry.bound, shortest: entry.shortest, first: entry.first }, cuts[at].kept.map((index) => answers[index].prepared), cuts[at].dropped);
    kept += cuts[at].kept.length;
    cut.answers += answers.length;
  }
  const out = writer.finish();
  const packed = gzipSync(out, { level: 9 });
  const summary = `${kept} of ${cut.answers} answers kept (rank ${rule.rank}, margin ${rule.margin}, cancel margin ${rule.cancelMargin}), ${(out.length / 1e6).toFixed(2)} MB, ${(packed.length / 1e6).toFixed(2)} MB gzipped`;
  if (asked) {
    const some = new URL(`./pairs/${basename(fileName).replace(/\.answers$/, "")}.some.answers.gz`, import.meta.url);
    writeFileSync(some, packed);
    console.log(`${cases.length} cases asked: ${summary} → ${some.pathname} in ${seconds()}`);
    process.exit(0);
  }
  if (cases.length < header.cases.length) {
    console.log(`first ${cases.length} cases: ${summary} in ${seconds()} (not written)`);
    process.exit(0);
  }
  // Next to the page (src/demo/page/answers/), listed for it to fetch
  const dir = new URL("../../src/demo/page/answers/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const name = `${basename(fileName).replace(/\.answers$/, "")}.answers.gz`;
  writeFileSync(new URL(name, dir), packed);
  const listing = new URL("answers.json", dir);
  const listed: string[] = existsSync(listing) ? JSON.parse(readFileSync(listing, "utf8")) : [];
  writeFileSync(listing, JSON.stringify([...new Set([...listed, name])].sort(), null, 1) + "\n");
  console.log(`${fileName}: ${summary} → src/demo/page/answers/${name} in ${seconds()}`);
  process.exit(0);
}
