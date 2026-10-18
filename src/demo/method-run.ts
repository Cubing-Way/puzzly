// Test bench page: running the method, and searching its runs for the fewest moves or the lowest speed cost

// Cube engine
import { type Method, type MethodStepResult, splitAlternatives, type MethodResult, runMethod, searchMethod, beamSearchMethod, BEAM_WIDTH } from "../engine";
// Page elements
import { scrambleInput, scrambleError, doneInput, doneError, searchSecondsInput, stopSearchButton, runMethodButton, searchMethodButton, beamMethodButton, beamWidthInput } from "./dom";
// Reads the step form
import { readMoves } from "./form";
// Method editor
import { method, currentMethod } from "./method-editor";
// Result panel and runs tables
import { type Run, showResult, setMethodRows, renderMethodRows, methodRows, runs } from "./results";
// Status line and busy state
import { setStatus, busy, setBusy, tableTracker, formatMs, plural } from "./status";
// Method steps to and from the form
import { wholeNumber } from "./step-form";

// True once Stop was pressed during a method search
let stopRequested = false;

// Start position and a copy of the method to run (so the steps can't change mid-run); null, with the reason in the status line, when a field is wrong or there are no steps
function methodStart(): { scramble: string; done: string; running: Method } | null {
  const scramble = readMoves(scrambleInput, scrambleError);
  const done = readMoves(doneInput, doneError);
  if (scramble === null || done === null) {
    setStatus("Fix the marked field first.", "error");
    return null;
  }
  if (!method.steps.length) {
    setStatus("Add at least one step first.", "error");
    return null;
  }
  return { scramble, done, running: structuredClone(currentMethod()) };
}

// One method step as a run (a row of the method results; click it to see that step on the cube)
function methodStepRun(scramble: string, running: Method, step: MethodStepResult, untimed = false): Run {
  const config = running.steps[step.step];
  return {
    scramble,
    done: step.done,
    mode: "step",
    pieces: step.pieces,
    alternatives: splitAlternatives(config.pieces),
    alternative: step.alternative,
    offsets: step.offsets,
    solvableWith: step.solvableWith,
    goal: `${running.name}: ${step.name}`,
    solution: step.solution.toString(),
    offset: step.offset,
    moves: step.moves,
    ms: step.ms,
    ok: step.ok,
    lookahead: step.lookahead,
    ...(step.wide ? { turned: step.wide } : {}),
    ...(step.alg ? { alg: step.alg } : {}),
    bld: { untouched: Boolean(config.untouched), buffer: config.buffer ?? "", targetsPerStep: config.targetsPerStep ?? 2, parity: config.parity ?? "" },
    untimed,
  };
}

// A whole method run as one run: every step's moves, with every step's pieces shown on the cube
function methodTotalRun(scramble: string, done: string, running: Method, result: MethodResult, ms: number): Run {
  return {
    scramble,
    done,
    mode: "method",
    pieces: result.pieces,
    alternatives: [],
    alternative: 0,
    offsets: result.steps.at(-1)?.offsets ?? [""],
    solvableWith: result.steps.at(-1)?.solvableWith ?? [],
    goal: running.name,
    solution: result.solution,
    offset: result.offset,
    moves: result.moves,
    ms,
    ok: result.ok,
    ...(result.wide ? { turned: result.wide } : {}),
    // Where each step starts, so the total is scored with each step's own counts
    ...(result.starts ? { starts: result.starts } : {}),
  };
}

// Run every step of the method from the start position (scramble, then Done so far), showing each step as it finishes
async function runWholeMethod(): Promise<void> {
  if (busy) return;
  const start = methodStart();
  if (!start) return;
  const { scramble, done, running } = start;
  setBusy(true);
  showResult(null);
  setMethodRows([]);
  renderMethodRows();
  // Live status: which step (and round of a repeated step) is searching, the time so far, and table builds or loads
  const started = performance.now();
  const tables = tableTracker();
  let index = 0;
  let round = 1;
  const tick = () => {
    const step = running.steps[index];
    const looking = step?.lookahead && (step.repeat || index < running.steps.length - 1) ? " · looking ahead" : "";
    const name = step ? (step.repeat ? `${step.name} ${round}` : step.name) : "…";
    setStatus(`Running ${running.name}: step ${index + 1} of ${running.steps.length} (${name})${looking}… ${formatMs(performance.now() - started)}${tables.note()}`);
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    const result = await runMethod(scramble, running, {
      done,
      onProgress: tables.onProgress,
      // Note which step (and round) runs now, for the live status
      onStart: (at, count) => ([index, round] = [at, count]),
      // Add each step's row as soon as it finishes
      onStep: (step, index) => {
        methodRows.push({ label: `${index + 1}. ${step.name}`, run: methodStepRun(scramble, running, step) });
        renderMethodRows();
      },
    });
    clearInterval(timer);
    // The whole solve as one run
    const total = methodTotalRun(scramble, done, running, result, performance.now() - started);
    methodRows.push({ label: "Total", run: total });
    runs.unshift(total);
    showResult(total);
    // Candidate answers the lookahead steps compared, for the status line
    const compared = result.steps.reduce((sum, step) => sum + (step.lookahead?.candidates ?? 0), 0);
    const comparedNote = compared ? `, lookahead compared ${plural(compared, "candidate")}` : "";
    setStatus(
      result.ok
        ? `${running.name} done in ${plural(result.moves, "move")} over ${plural(result.steps.length, "step")} (${formatMs(total.ms)}${comparedNote}${tables.summary()}).`
        : `${running.name}: a step's solution doesn't reach its goal!`,
      result.ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Method error: ${(error as Error).message}`, "error");
  } finally {
    clearInterval(timer);
    setBusy(false);
  }
}

// Search the method's runs for the fewest moves in total (for up to the seconds given, or until Stop), showing each shorter run's steps as it's found
async function searchWholeMethod(): Promise<void> {
  if (busy) return;
  const start = methodStart();
  if (!start) return;
  const { scramble, done, running } = start;
  const seconds = Math.max(1, wholeNumber(searchSecondsInput.value) || 30);
  setBusy(true);
  showResult(null);
  setMethodRows([]);
  renderMethodRows();
  stopRequested = false;
  stopSearchButton.disabled = false;
  stopSearchButton.hidden = false;
  // Live status: the best run so far, the fewest any run can have (once known), the time so far and table builds or loads
  const started = performance.now();
  const tables = tableTracker();
  let best: MethodResult | null = null;
  let atLeast: number | null = null;
  const tick = () => {
    const found = best ? `best so far ${plural(best.moves, "move")}` : "first run";
    const bound = atLeast === null ? "" : `, at least ${plural(atLeast, "move")}`;
    setStatus(`Searching ${running.name} for fewer moves (${found}${bound})… ${formatMs(performance.now() - started)} of ${seconds} s${tables.note()}`);
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    const found = await searchMethod(scramble, running, {
      done,
      budgetMs: seconds * 1000,
      stop: () => stopRequested,
      onProgress: tables.onProgress,
      // The fewest moves any run can have, for the live status
      onBound: (moves) => (atLeast = moves),
      // Show each shorter run's steps as soon as it's found (the plain run first)
      onBetter: (result) => {
        best = result;
        setMethodRows(result.steps.map((step) => ({ label: `${step.step + 1}. ${step.name}`, run: methodStepRun(scramble, running, step, true) })));
        methodRows.push({ label: "Total", run: methodTotalRun(scramble, done, running, result, result.ms) });
        renderMethodRows();
      },
    });
    clearInterval(timer);
    if (!found.best) {
      setStatus(`${running.name}: no run gets through every step${found.optimal ? "" : " (stopped before the search finished)"}.`, "error");
      return;
    }
    // The best run as one run: shown on the cube and kept in the runs table
    const total = methodRows.at(-1)!.run;
    runs.unshift(total);
    showResult(total);
    const from = found.seed === null ? "the plain run failed" : found.seed === found.best.moves ? "same as the plain run" : `plain run ${plural(found.seed, "move")}`;
    const proof = found.optimal ? ", the fewest this method can do" : "";
    // Not proven: how few moves a run could still have, and why the search ended
    const bound = found.optimal || found.bound === null ? "" : `; any run needs at least ${plural(found.bound, "move")}`;
    const unproven = found.optimal ? "" : `; ${stopRequested ? "stopped" : "time's up"} before it could rule out shorter runs`;
    setStatus(
      found.best.ok
        ? `${running.name}: ${plural(found.best.moves, "move")}${proof} (${from}${bound}; ${plural(found.states, "step start")} in ${formatMs(found.ms)}${unproven}${tables.summary()}).`
        : `${running.name}: a step's solution doesn't reach its goal!`,
      found.best.ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Method search error: ${(error as Error).message}`, "error");
  } finally {
    clearInterval(timer);
    stopSearchButton.hidden = true;
    setBusy(false);
  }
}

// Search the method's solves for the lowest speed cost (a beam search from Run method's answer), showing the winner's steps when it's done
async function beamWholeMethod(): Promise<void> {
  if (busy) return;
  const start = methodStart();
  if (!start) return;
  const { scramble, done, running } = start;
  const width = Math.max(1, wholeNumber(beamWidthInput.value) || BEAM_WIDTH);
  setBusy(true);
  showResult(null);
  setMethodRows([]);
  renderMethodRows();
  stopRequested = false;
  stopSearchButton.disabled = false;
  stopSearchButton.hidden = false;
  // Live status: the plain run first, then which step (and round) the beam extends and how many partial solves, the time so far and table builds or loads
  const started = performance.now();
  const tables = tableTracker();
  let level: { index: number; round: number; partials: number } | null = null;
  const tick = () => {
    const step = level && running.steps[level.index];
    const name = step && level ? (step.repeat ? `${step.name} ${level.round}` : step.name) : "";
    const where = step && level ? `step ${level.index + 1} of ${running.steps.length} (${name}), ${plural(level.partials, "partial solve")}` : "Run method first";
    const cut = stopRequested ? ", finishing quickly" : "";
    setStatus(`Searching ${running.name} for the fastest solve (${where}${cut})… ${formatMs(performance.now() - started)}${tables.note()}`);
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    const found = await beamSearchMethod(scramble, running, {
      done,
      width,
      stop: () => stopRequested,
      onProgress: tables.onProgress,
      // Note which step (and round) the beam extends now, for the live status
      onLevel: (index, round, partials) => (level = { index, round, partials }),
    });
    clearInterval(timer);
    if (!found.best || found.cost === null) {
      setStatus(`${running.name}: no solve gets through every step.`, "error");
      return;
    }
    // The winner's steps, then the whole solve as one run: shown on the cube and kept in the runs table
    setMethodRows(found.best.steps.map((step) => ({ label: `${step.step + 1}. ${step.name}`, run: methodStepRun(scramble, running, step, true) })));
    const total = methodTotalRun(scramble, done, running, found.best, found.ms);
    methodRows.push({ label: "Total", run: total });
    renderMethodRows();
    runs.unshift(total);
    showResult(total);
    // Its cost against the plain run's (both with finding pieces), and how the search ended
    const cost = (value: number) => (Math.round(value * 10) / 10).toString();
    const from = found.seed === null ? "the plain run failed" : found.cost < found.seed - 1e-6 ? `plain run ${cost(found.seed)}` : "same as the plain run";
    const cut = found.stopped ? "; stopped: from then on each step took its own best answer" : "";
    setStatus(
      found.best.ok
        ? `${running.name}: speed cost ${cost(found.cost)} (finding pieces ${cost(found.look ?? 0)} of it), ${plural(found.best.moves, "move")} (${from}; ${plural(found.partials, "partial solve")} in ${formatMs(found.ms)}${cut}${tables.summary()}).`
        : `${running.name}: a step's solution doesn't reach its goal!`,
      found.best.ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Fastest search error: ${(error as Error).message}`, "error");
  } finally {
    clearInterval(timer);
    stopSearchButton.hidden = true;
    setBusy(false);
  }
}

// Wire the Run method, Search fewest moves, Search fastest and Stop search buttons
export function wireMethodRun(): void {
  // Run the method, or search its runs for the fewest moves or the lowest speed cost
  runMethodButton.addEventListener("click", runWholeMethod);
  searchMethodButton.addEventListener("click", searchWholeMethod);
  beamMethodButton.addEventListener("click", beamWholeMethod);
  // Stop asks a method search to end (it stops between worker requests, keeping its best run; the fastest search finishes quickly instead)
  stopSearchButton.addEventListener("click", () => {
    stopRequested = true;
    stopSearchButton.disabled = true;
  });
}
