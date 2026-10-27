// Steps answered from an answer file against the same steps searched (plan-speed Part 3, item 2): every step of seeded solves of an example method that
// the file stands for, asked as the method asks it (with lookahead: its list of candidates with all its extra moves, and as a judging run, one answer
// with one extra move at most; without: its own answer), searched as the method runs it, searched going on past the cap (as the file was listed), and
// looked up. The answers are compared in order (as the hands make them, with their speeds and tiers), and timed. Differences are printed with SHOW=1.
// With CUT=<cut file> (answer-cut.ts, gzipped), each lookup is made in it too: how many it answers (the others are searched) and whether those are the
// very answers the file given answers with. FILEONLY=1 searches nothing (the solves and the lookaheads' cubes come from the file given).
// CASES_OUT=<file> writes the file's cases the lookups asked for (a JSON list of their places), for answer-cut.ts's CASES.
// Usage: [CUT=<cut file>] [FILEONLY=1] [CASES_OUT=<file>] node bench/out/answer-check.js <answer file> [method prefix, default CFOP level 2] [solves, default 8]
import { inProcessWorker, random, scramble } from "./setup";
import { nodeHelper, nodeScoringWorker } from "./node-helper";
import wasm from "../search/pkg/puzzly_search_bg.wasm";
import { runSearchWorker } from "../src/engine/worker/search-worker.ts";
import { loadEngine, readMethod, stepCandidates, readAnswerFile, loadAnswerFile, clearAnswerFiles, type StepResult, type Goal, type CandidateOptions } from "../src/engine/index.ts";
import { avoided, handTurns, handsMoves, heldBack, methodStepOptions, nextStep, piecesAfter, runMethodRows } from "../src/engine/method/run.ts";
import { fileCandidates, cutMisses, caseKey } from "../src/engine/step/file-step.ts";
import { plannedCombos } from "../src/engine/step/step-combos.ts";
import { kpuzzle } from "../src/engine/core/puzzle.ts";
import { MAX_CANDIDATES } from "../src/engine/step/step.ts";
import { joinMoves, joinStep, NO_STEPS, type JoinedSteps } from "../src/engine/core/moves.ts";
import examples from "../src/demo/example-methods.json";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const [fileName, methodName = "CFOP level 2", countText = "8"] = process.argv.slice(2);
if (!fileName) throw new Error("usage: node bench/out/answer-check.js <answer file> [method prefix] [solves]");
// A cut file is gzipped as the page takes it (see answer-cut.ts)
const readFile = (name: string) => readAnswerFile(name.endsWith(".gz") ? gunzipSync(readFileSync(name)) : readFileSync(name));
const file = readFile(fileName);
const cutFile = process.env.CUT ? readFile(process.env.CUT) : null;
runSearchWorker({ wasm, helper: nodeHelper });
await loadEngine({ searchWorker: inProcessWorker, scoringWorker: nodeScoringWorker, wasm });
const method = readMethod((examples as any[]).find((m) => m.name.startsWith(methodName)));
// The solves themselves are searched; the file is loaded for each lookup only
// The file's cases the lookups asked for (CASES_OUT)
const caseIndex = new Map(file.header.cases.map((entry, at) => [entry.key, at]));
const asked = new Set<number>();
const lookUp = (scramble: string, pieces: string, options: CandidateOptions, from = file) => {
  if (process.env.CASES_OUT && from === file) {
    try {
      for (const combo of plannedCombos(scramble, pieces, options).candidates) if (caseIndex.has(caseKey(combo))) asked.add(caseIndex.get(caseKey(combo))!);
    } catch {}
  }
  loadAnswerFile(from);
  const found = fileCandidates(scramble, pieces, options, Math.max(1, options.maxCandidates ?? MAX_CANDIDATES));
  clearAnswerFiles();
  return found;
};

// Where each step of the solves started: the scramble, the moves before it, the earlier pieces and the earlier steps' moves as the hands make them
const fileOnly = Boolean(process.env.FILEONLY);
if (fileOnly) loadAnswerFile(file);
const rand = random(77);
const positions: { scramble: string; index: number; done: string; earlier: Goal; previous: JoinedSteps; solve: number; name: string }[] = [];
for (let solve = 0; solve < Number(countText); solve++) {
  const s = scramble(rand);
  const { steps } = await runMethodRows(s, method);
  let earlier: Goal = {};
  let previous = NO_STEPS;
  for (const row of steps) {
    positions.push({ scramble: s, index: row.step, done: row.done, earlier, previous, solve, name: row.name });
    earlier = piecesAfter(earlier, row);
    previous = joinStep(previous, handsMoves(row));
  }
}

const timed = async <T>(run: () => Promise<T> | T) => {
  const t = performance.now();
  const value = await run();
  return { value, ms: performance.now() - t };
};
const shown = (result: StepResult) => `${handsMoves(result)} ${result.speed?.toFixed(2)}${result.tier ? ` t${result.tier}` : ""}`;
const same = (a: StepResult, b: StepResult) => handsMoves(a) === handsMoves(b) && a.speed === b.speed && a.tier === b.tier;

type Kind = "list" | "judging" | "own" | "ahead";
// Per kind, with a cut file: lookups, those it answered, those the same as the file's, and the time it took
const cutTotals = new Map<Kind, { asked: number; answered: number; same: number; ms: number; why: Record<string, number> }>();
const totals = new Map<Kind, { asked: number; ms: number; pastMs: number; fileMs: number; pick: number; pickPast: number; all: number; allPast: number; gain: number; gainPast: number }>();
// The positions a lookahead judges are checked too (kind "ahead"): after each candidate of a list, the next step's judging run
const queue = [...positions];
while (queue.length) {
  const position = queue.shift()!;
  const step = method.steps[position.index];
  const next = nextStep(method, position.index);
  if (heldBack(method.steps, position.index, position.earlier)) continue;
  const base: CandidateOptions = { ...methodStepOptions(step, position.done, position.earlier, undefined, next, position.previous), ...(next ? {} : { last: true }), rank: step.rank, avoid: avoided(step), ...handTurns(step) };
  const judging: CandidateOptions = { ...base, extraMoves: Math.min(step.extraMoves ?? 0, 1), maxCandidates: 1 };
  const asks: [Kind, CandidateOptions][] =
    position.name === "ahead"
      ? [["ahead", judging]]
      : step.lookahead
        ? [
            ["list", { ...base, extraMoves: step.extraMoves ?? 0, ...(step.candidates ? { maxCandidates: step.candidates } : {}) }],
            ["judging", judging],
          ]
        : [["own", { ...base, extraMoves: step.extraMoves ?? 0, maxCandidates: 1 }]];
  for (const [kind, options] of asks) {
    const looked = await timed(() => lookUp(position.scramble, step.pieces, options));
    if (!looked.value) continue;
    if (cutFile) {
      const missed = { ...cutMisses };
      const cutLooked = await timed(() => lookUp(position.scramble, step.pieces, options, cutFile));
      const sum = cutTotals.get(kind) ?? { asked: 0, answered: 0, same: 0, ms: 0, why: {} };
      for (const [why, count] of Object.entries(cutMisses)) if (count > (missed[why] ?? 0)) sum.why[why] = (sum.why[why] ?? 0) + 1;
      cutTotals.set(kind, sum);
      sum.asked++;
      sum.ms += cutLooked.ms;
      if (cutLooked.value) {
        sum.answered++;
        const sameAll = cutLooked.value.length === looked.value.length && cutLooked.value.every((result, at) => same(result, looked.value![at]));
        sum.same += Number(sameAll);
        if (!sameAll) console.log(`solve ${position.solve} ${position.name} ${kind}: the cut file's answers differ: ${cutLooked.value.slice(0, 3).map(shown).join(", ")} against ${looked.value.slice(0, 3).map(shown).join(", ")}`);
      }
    }
    if (fileOnly) {
      if (kind === "list" && next && step.lookahead) {
        const after = step.repeat ? position.index : position.index + 1;
        for (const candidate of looked.value) {
          queue.push({ ...position, index: after, done: joinMoves(position.done, candidate.solution.toString()), earlier: piecesAfter(position.earlier, candidate), previous: joinStep(position.previous, handsMoves(candidate)), name: "ahead" });
        }
      }
      continue;
    }
    const today = await timed(() => stepCandidates(position.scramble, step.pieces, options));
    const past = await timed(() => stepCandidates(position.scramble, step.pieces, { ...options, pastCut: true }));
    const found = looked.value;
    // The next step at each candidate's end, judged later
    if (kind === "list" && next && step.lookahead) {
      const after = step.repeat ? position.index : position.index + 1;
      for (const candidate of today.value) {
        queue.push({ ...position, index: after, done: joinMoves(position.done, candidate.solution.toString()), earlier: piecesAfter(position.earlier, candidate), previous: joinStep(position.previous, handsMoves(candidate)), name: "ahead" });
      }
    }
    const sum = totals.get(kind) ?? { asked: 0, ms: 0, pastMs: 0, fileMs: 0, pick: 0, pickPast: 0, all: 0, allPast: 0, gain: 0, gainPast: 0 };
    totals.set(kind, sum);
    sum.asked++;
    sum.ms += today.ms;
    sum.pastMs += past.ms;
    sum.fileMs += looked.ms;
    const pick = same(found[0], today.value[0]);
    const pickPast = same(found[0], past.value[0]);
    const all = found.length === today.value.length && found.every((result, at) => same(result, today.value[at]));
    const allPast = found.length === past.value.length && found.every((result, at) => same(result, past.value[at]));
    sum.pick += Number(pick);
    sum.pickPast += Number(pickPast);
    sum.all += Number(all);
    sum.allPast += Number(allPast);
    sum.gain += today.value[0].speed! - found[0].speed!;
    sum.gainPast += past.value[0].speed! - found[0].speed!;
    // The positions a lookahead judges are many: only those that differ are printed
    if (kind !== "ahead" || !all) {
      console.log(
        `solve ${position.solve} ${position.name} ${kind}: today ${today.ms.toFixed(0)} ms, past the cap ${past.ms.toFixed(0)} ms, file ${looked.ms.toFixed(1)} ms; pick ${pick ? "same" : `${shown(today.value[0])} → ${shown(found[0])}`}${pickPast ? "" : ` (past the cap ${shown(past.value[0])})`}, list ${all ? "same" : allPast ? "same as past the cap" : "differs"}`,
      );
    }
    // A pick that differs: whether the searched step lists the file's pick at all (all its answers ranked)
    if (!pickPast) {
      const every = await stepCandidates(position.scramble, step.pieces, { ...options, pastCut: true, maxCandidates: 1_000_000 });
      loadAnswerFile(file);
      const filed = fileCandidates(position.scramble, step.pieces, { ...options, maxCandidates: 1_000_000 }, 1_000_000)!;
      clearAnswerFiles();
      // The same answer: the same turns on the cube, held the same way
      const sameTurns = (a: StepResult, b: StepResult) => kpuzzle.algToTransformation(a.solution.toString()).isIdentical(kpuzzle.algToTransformation(b.solution.toString()));
      const where = (list: StepResult[], result: StepResult) => {
        const at = list.findIndex((other) => sameTurns(other, result));
        return at < 0 ? "not there" : `#${at + 1} ${shown(list[at])}`;
      };
      console.log(`    the file's pick in the search: ${where(every, found[0])} (${every.length} answers); the search's pick in the file: ${where(filed, past.value[0])} (${filed.length})`);
    }
    if (process.env.SHOW && !allPast) {
      for (let at = 0; at < Math.max(found.length, past.value.length); at++) {
        const [a, b, c] = [today.value[at], past.value[at], found[at]];
        console.log(`    ${at + 1}. today ${a ? shown(a) : "-"} | past the cap ${b ? shown(b) : "-"} | file ${c ? shown(c) : "-"}`);
      }
    }
  }
}
for (const [kind, sum] of cutTotals) {
  const why = Object.entries(sum.why).map(([reason, count]) => `${reason} ${count}`).join(", ");
  console.log(`cut file, ${kind}: answered ${sum.answered} of ${sum.asked} (the others searched${why ? `: ${why}` : ""}), ${sum.same} the same as the file's; ${(sum.ms / sum.asked).toFixed(1)} ms a lookup`);
}
for (const [kind, sum] of totals) {
  const n = sum.asked;
  console.log(
    `${kind}: ${n} steps, today ${(sum.ms / n).toFixed(0)} ms a step, past the cap ${(sum.pastMs / n).toFixed(0)} ms, file ${(sum.fileMs / n).toFixed(1)} ms; same pick as today ${sum.pick}, as past the cap ${sum.pickPast}; same list ${sum.all}, as past the cap ${sum.allPast}; pick faster than today's by ${(sum.gain / n).toFixed(3)}, than past the cap's by ${(sum.gainPast / n).toFixed(3)}`,
  );
}
if (process.env.CASES_OUT) writeFileSync(process.env.CASES_OUT, JSON.stringify([...asked].sort((a, b) => a - b)));
process.exit(0);
