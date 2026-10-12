// Test bench page: the New scramble and Solve actions

// Cube engine
import { type Rank, randomScramble, splitAlternatives, solveFull, solveStep, stepCandidates, joinMoves, reachesGoal, countMoves, speedCost } from "../engine";
// Piece chips and presets
import { goalLabel } from "./chips";
// Page elements
import { scrambleInput, doneInput, scrambleError, doneError, piecesInput, maxDepthInput, firstFoundBox, extraMovesInput, candidatesInput, xTurnsBox, zTurnsBox, undoOffsetBox } from "./dom";
// Reads the step form
import { readMoves, currentMode, readBld, chosenMoves, chosenGrips, chosenRank, chosenAvoid, readOffsets, readSolvable } from "./form";
// Result panel and runs tables
import { showResult, type Run, runs } from "./results";
// Status line and busy state
import { setBusy, setStatus, busy, plural, tableTracker, formatMs } from "./status";
// Method steps to and from the form
import { wholeNumber } from "./step-form";
// 3D cube viewer
import { onInputChange, syncViewer } from "./viewer";

// Put a new random-state scramble in the start position (a new attempt, so nothing is done yet)
export async function newScramble(): Promise<void> {
  setBusy(true);
  setStatus("Generating scramble…");
  try {
    scrambleInput.value = await randomScramble();
    doneInput.value = "";
    onInputChange();
    setStatus("Ready.");
  } catch (error) {
    setStatus(`Scramble error: ${(error as Error).message}`, "error");
  } finally {
    setBusy(false);
  }
}

// Run the chosen solver, check its answer and record the run
export async function solve(): Promise<void> {
  if (busy) return;
  // Stop on unreadable fields (their messages are already shown)
  if (!syncViewer()) {
    setStatus("Fix the marked field first.", "error");
    return;
  }
  // Gather the inputs
  const scramble = readMoves(scrambleInput, scrambleError) ?? "";
  const done = readMoves(doneInput, doneError) ?? "";
  const mode = currentMode();
  // Step goal: one alternative per line, any one counts (labelled with preset names where they match); blindfolded fields (syncViewer already checked them)
  const alternatives = mode === "step" ? splitAlternatives(piecesInput.value) : [];
  const pieces = alternatives.join(" | ");
  const bld = mode === "step" ? (readBld() ?? undefined) : undefined;
  const goal =
    mode === "full"
      ? "Full cube"
      : bld?.buffer
        ? `BLD from ${bld.buffer} (${plural(bld.targetsPerStep, "target")})`
        : alternatives.map(goalLabel).join(" | ") + (bld?.untouched ? ", rest untouched" : "");
  const generatorMoves = chosenMoves();
  const maxDepth = maxDepthInput.value ? Number(maxDepthInput.value) : undefined;
  // First-answer mode only applies to steps
  const firstFound = mode === "step" && firstFoundBox.checked;
  const rotations = chosenGrips();
  // Offsets and solvable-with moves only apply to steps (syncViewer already checked the fields)
  const offsets = mode === "step" ? (readOffsets() ?? [""]) : [""];
  const solvableWith = mode === "step" ? (readSolvable() ?? []) : [];
  // What a step's best answer is (fewest moves, or speed), how much longer than the shortest an answer may be, and how many other answers to list
  const rank: Rank = mode === "step" ? chosenRank() : "moves";
  const extraMoves = wholeNumber(extraMovesInput.value);
  const others = wholeNumber(candidatesInput.value);
  // A step search needs at least one move and one grip to work with
  if (mode === "step" && generatorMoves.length === 0) {
    setStatus("Pick at least one allowed move.", "error");
    return;
  }
  if (mode === "step" && rotations.length === 0) {
    setStatus("Pick at least one bottom face.", "error");
    return;
  }

  setBusy(true);
  showResult(null);
  // Live timer in the status line while the solver works (noting table builds and loads)
  const started = performance.now();
  const tables = tableTracker();
  const tick = () => setStatus(`Solving ${goal}… ${formatMs(performance.now() - started)}${tables.note()}`);
  tick();
  const timer = setInterval(tick, 100);
  try {
    // Solve from scramble + done (a step tries every alternative × chosen grip × offset; its best answer is the shortest, or by speed the fastest to turn)
    let run: Run;
    let searches = 1;
    // Untouched steps: the spots the answer may change, checked against the cube before it (in its grip)
    let untouched: { from: string; changed: string } | undefined;
    if (mode === "full") {
      const solution = (await solveFull(scramble, done)).toString();
      const ms = performance.now() - started;
      // Double-check the answer on our own pattern
      const ok = reachesGoal(scramble, joinMoves(done, solution), null, offsets, solvableWith);
      run = { scramble, done, mode, pieces: "", alternatives, alternative: 0, offsets, solvableWith, goal, solution, offset: "", moves: countMoves(solution), ms, ok, bld };
    } else {
      const options = { generatorMoves, maxDepth, rotations, done, offsets, solvableWith, firstFound, ...bld, rank, extraMoves, avoid: chosenAvoid(), wideAxes: [...(xTurnsBox.checked ? ["x"] : []), ...(zTurnsBox.checked ? ["z"] : [])], undoOffset: undoOffsetBox.checked, onProgress: tables.onProgress };
      // The best answer alone, or with the other answers it was compared with (best first)
      const results = others > 0 ? await stepCandidates(scramble, pieces, { ...options, maxCandidates: others + 1 }) : [await solveStep(scramble, pieces, options)];
      const ms = performance.now() - started;
      // Each answer as a run of its own, double-checked on our own pattern (the alternative it solved; any of the step's offsets counts, what the solvable-with
      // moves can still do, and the untouched pieces); they share one list, so any of them can be shown with the others beside it
      const candidates: Run[] = [];
      for (const result of results) {
        const solution = result.solution.toString();
        const changed = result.changed === undefined ? undefined : { from: joinMoves(done, result.rotation), changed: result.changed };
        const ok = reachesGoal(scramble, joinMoves(done, solution), result.pieces, offsets, solvableWith, changed);
        const answer: Run = { scramble, done, mode, pieces: result.pieces, alternatives, alternative: result.alternative, offsets, solvableWith, goal, solution, offset: result.offset, moves: countMoves(solution), ms, ok, bld, rank, ...(result.wide ? { turned: result.wide } : {}) };
        candidates.push(results.length > 1 ? { ...answer, candidates } : answer);
      }
      run = candidates[0];
      searches = results[0].searches;
      if (results[0].changed !== undefined) untouched = { from: joinMoves(done, results[0].rotation), changed: results[0].changed };
    }
    clearInterval(timer);
    const { ok, ms, alternative, offset, pieces: solved } = run;
    // Record and show the run
    runs.unshift(run);
    showResult(run);
    // Mention how many searches ran (all compared, or up to the first answer), the alternative that won, the offset left in and the moves that may finish it
    const compared = firstFound ? `, first answer at search ${searches}` : searches > 1 ? `, best of ${searches} searches` : "";
    const wonNote = alternatives.length > 1 ? `, alternative ${alternative + 1}: ${goalLabel(alternatives[alternative])}` : "";
    // By speed: the winner's speed cost; and how many other answers are listed under the result
    const rankNote = (rank === "speed" ? `, fastest to turn: speed ${speedCost(run.turned ?? run.solution, undefined, !done.trim())}` : "") + (run.candidates ? `, ${plural(run.candidates.length - 1, "other answer")} listed` : "");
    const offsetNote =
      (offset ? `, offset ${offset}` : "") + (solvableWith.length ? `, solvable with ${solvableWith.join(" ")}` : "") + (untouched ? `, sent home ${solved || "nothing"}, changed ${untouched.changed || "nothing"}` : "");
    setStatus(
      ok ? `${goal} solved in ${plural(run.moves, "move")} (${formatMs(ms)}${compared}${wonNote}${rankNote}${offsetNote}${tables.summary()}).` : `${goal}: the solution doesn't reach the goal!`,
      ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Solver error: ${(error as Error).message}`, "error");
  } finally {
    clearInterval(timer);
    setBusy(false);
  }
}
