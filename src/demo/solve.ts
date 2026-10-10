// Test bench page: the New scramble and Solve actions

// Cube engine
import { randomScramble, splitAlternatives, solveFull, solveStep, joinMoves, reachesGoal, countMoves } from "../engine";
// Piece chips and presets
import { goalLabel } from "./chips";
// Page elements
import { scrambleInput, doneInput, scrambleError, doneError, piecesInput, maxDepthInput, firstFoundBox } from "./dom";
// Reads the step form
import { readMoves, currentMode, readBld, chosenMoves, chosenGrips, readOffsets, readSolvable } from "./form";
// Result panel and runs tables
import { showResult, type Run, runs } from "./results";
// Status line and busy state
import { setBusy, setStatus, busy, plural, tableTracker, formatMs } from "./status";
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
    // Solve from scramble + done (a step tries every alternative × chosen grip × offset and keeps the shortest answer)
    let solution: string;
    // Goal pieces the winner solved (named in the grip it ends in), and which alternative it was
    let solved = "";
    let alternative = 0;
    let offset = "";
    let searches = 1;
    // Untouched steps: the spots the answer may change, checked against the cube before it (in its grip)
    let untouched: { from: string; changed: string } | undefined;
    if (mode === "full") solution = (await solveFull(scramble, done)).toString();
    else {
      const result = await solveStep(scramble, pieces, { generatorMoves, maxDepth, rotations, done, offsets, solvableWith, firstFound, ...bld, onProgress: tables.onProgress });
      solution = result.solution.toString();
      solved = result.pieces;
      alternative = result.alternative;
      offset = result.offset;
      searches = result.searches;
      if (result.changed !== undefined) untouched = { from: joinMoves(done, result.rotation), changed: result.changed };
    }
    const ms = performance.now() - started;
    clearInterval(timer);
    // Double-check the answer on our own pattern (the winning alternative; any of the step's offsets counts, what the solvable-with moves can still do, and the untouched pieces)
    const ok = reachesGoal(scramble, joinMoves(done, solution), mode === "full" ? null : solved, offsets, solvableWith, untouched);
    // Record and show the run
    const run: Run = { scramble, done, mode, pieces: solved, alternatives, alternative, offsets, solvableWith, goal, solution, offset, moves: countMoves(solution), ms, ok, bld };
    runs.unshift(run);
    showResult(run);
    // Mention how many searches ran (all compared, or up to the first answer), the alternative that won, the offset left in and the moves that may finish it
    const compared = firstFound ? `, first answer at search ${searches}` : searches > 1 ? `, best of ${searches} searches` : "";
    const wonNote = alternatives.length > 1 ? `, alternative ${alternative + 1}: ${goalLabel(alternatives[alternative])}` : "";
    const offsetNote =
      (offset ? `, offset ${offset}` : "") + (solvableWith.length ? `, solvable with ${solvableWith.join(" ")}` : "") + (untouched ? `, sent home ${solved || "nothing"}, changed ${untouched.changed || "nothing"}` : "");
    setStatus(
      ok ? `${goal} solved in ${plural(run.moves, "move")} (${formatMs(ms)}${compared}${wonNote}${offsetNote}${tables.summary()}).` : `${goal}: the solution doesn't reach the goal!`,
      ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Solver error: ${(error as Error).message}`, "error");
  } finally {
    clearInterval(timer);
    setBusy(false);
  }
}
