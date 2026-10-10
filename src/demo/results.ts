// Test bench page: finished solves (runs), the result panel, the runs table and the method results table

// Cube engine
import { type MethodStepResult, stickeringMask, joinMoves, invertMoves, offsetsToText } from "../engine";
// Page elements
import {
  solutionText,
  movesStat,
  timeStat,
  checkStat,
  offsetStat,
  alternativeStat,
  continueButton,
  copyButton,
  runsEmpty,
  runsBody,
  methodEmpty,
  methodBody,
  scrambleInput,
  doneInput,
  form,
  piecesInput,
  offsetsInput,
  solvableInput,
} from "./dom";
// Reads the step form
import { type Bld, showBld } from "./form";
// Status line and busy state
import { formatMs, plural, busy } from "./status";
// 3D cube viewer
import { player, syncViewer } from "./viewer";

// One finished solve
export interface Run {
  scramble: string; // start position
  done: string; // moves earlier steps did after the scramble
  mode: "step" | "full" | "method"; // one step, the whole cube, or every step of a method
  pieces: string; // goal pieces solved, named in the grip the solution ends in ("" for full solves; every step's pieces for a method)
  alternatives: string[]; // goal texts the step could pick from (one for most steps; none for full solves and whole methods)
  alternative: number; // which of them won (0 = the first, or the only one)
  offsets: string[]; // offsets the goal counted up to ([""] = none)
  solvableWith: string[]; // moves that may finish the goal later ([] = none)
  goal: string; // label shown in the runs table
  solution: string; // grip rotation (if any), then the moves
  offset: string; // offset the solution ended up to ("" = none), still in the cube
  moves: number;
  ms: number;
  ok: boolean; // scramble + done + solution really reaches the goal (up to one of the offsets)
  lookahead?: MethodStepResult["lookahead"]; // method steps with lookahead: candidates compared and the winner's moves over the steps they were judged by
  bld?: Bld; // step runs: the blindfolded fields it was solved with (untouched steps show the whole cube)
  untimed?: boolean; // a step of a method search (steps aren't timed one by one there)
}

// Every solve so far, newest first
export const runs: Run[] = [];
// Solve shown in the result panel
export let shown: Run | null = null;

// Rows of the last method run: one per step, then the total
export let methodRows: { label: string; run: Run }[] = [];

// Replace the method results' rows (the caller redraws them)
export function setMethodRows(rows: { label: string; run: Run }[]): void {
  methodRows = rows;
}

// Which alternative won, as " (alt 2 of 3)" ("" when the run had only one)
function alternativeNote(run: Run): string {
  return run.alternatives.length > 1 ? ` (alt ${run.alternative + 1} of ${run.alternatives.length})` : "";
}

// Fill the result panel and the viewer's solution (null = clear)
export function showResult(run: Run | null): void {
  shown = run;
  // Viewer: start position + solution, rewound to the start
  player.alg = run?.solution ?? "";
  player.timestamp = "start";
  // Mask the goal pieces of the grip the solution ends in (it may start with a rotation); full solves and untouched steps show the whole cube
  if (run) player.experimentalStickeringMaskOrbits = stickeringMask(run.mode === "full" || run.bld?.untouched ? null : run.pieces, run.scramble, joinMoves(run.done, run.solution));
  // Text and stats
  solutionText.textContent = run ? run.solution || "(already solved)" : "—";
  movesStat.textContent = run ? String(run.moves) : "—";
  timeStat.textContent = run ? formatMs(run.ms) : "—";
  checkStat.textContent = run ? (run.ok ? "✓ reaches goal" : "✗ misses goal") : "—";
  checkStat.dataset.kind = run ? (run.ok ? "ok" : "error") : "";
  // Offset still in the cube, with the moves that undo it
  offsetStat.textContent = run ? (run.offset ? `${run.offset} (undo: ${invertMoves(run.offset)})` : "none") : "—";
  // Alternative that won (its goal text on hover), when the step had several
  const several = run !== null && run.alternatives.length > 1;
  alternativeStat.textContent = several ? `${run.alternative + 1} of ${run.alternatives.length}` : "—";
  alternativeStat.title = several ? run.alternatives[run.alternative] : "";
  // Actions need a non-empty solution
  continueButton.disabled = copyButton.disabled = !run?.solution;
  renderRuns();
  renderMethodRows();
}

// Lookahead cell of a method step: candidates compared → the winner's moves over this step and the ones it was judged by, with the details on hover
function lookaheadCell(run: Run): { text: string; title: string } {
  const ahead = run.lookahead;
  if (!ahead) return { text: "—", title: "" };
  const total = ahead.total === null ? "—" : String(ahead.total);
  const title = `Compared ${plural(ahead.candidates, "candidate answer")}; the winner takes ${ahead.total === null ? "?" : plural(ahead.total, "move")} over this step and the next ${plural(ahead.steps, "step")}`;
  return { text: `${ahead.candidates} → ${total}`, title };
}

// One table row for a run: label, moves, offset, lookahead, time, check and solution cells (pick and order them with `cells`)
function runRow(run: Run, label: string, cells: string[], onClick: () => void): HTMLTableRowElement {
  const row = document.createElement("tr");
  // Text for each kind of cell
  const ahead = lookaheadCell(run);
  const texts: Record<string, string> = {
    label,
    moves: String(run.moves),
    offset: run.offset || "—",
    lookahead: ahead.text,
    time: run.untimed ? "—" : formatMs(run.ms),
    check: run.ok ? "✓" : "✗",
    solution: run.solution || "(already solved)",
  };
  for (const kind of cells) {
    const cell = document.createElement("td");
    cell.textContent = texts[kind];
    cell.dataset.col = kind;
    if (kind === "lookahead") cell.title = ahead.title;
    row.append(cell);
  }
  // Highlight the shown run and failed checks
  row.classList.toggle("selected", run === shown);
  row.classList.toggle("bad", !run.ok);
  row.addEventListener("click", onClick);
  return row;
}

// Redraw the runs table; clicking a row shows that run again
function renderRuns(): void {
  runsEmpty.hidden = runs.length > 0;
  runsBody.replaceChildren(
    ...runs.map((run, index) => {
      // Number column first, then the goal (and the alternative that won) as the label
      const row = runRow(run, run.goal + alternativeNote(run), ["label", "moves", "offset", "time", "check", "solution"], () => loadRun(run));
      const number = document.createElement("td");
      number.textContent = String(runs.length - index);
      row.prepend(number);
      return row;
    }),
  );
}

// Redraw the method results: one row per step, then the total; clicking a row shows it on the cube
export function renderMethodRows(): void {
  methodEmpty.hidden = methodRows.length > 0;
  methodBody.replaceChildren(
    ...methodRows.map(({ label, run }) => {
      const row = runRow(run, label + alternativeNote(run), ["label", "moves", "offset", "lookahead", "check", "time", "solution"], () => showResult(run));
      row.classList.toggle("total", run.mode === "method");
      return row;
    }),
  );
}

// Put a past run back in the form and viewer
function loadRun(run: Run): void {
  if (busy) return;
  scrambleInput.value = run.scramble;
  doneInput.value = run.done;
  // Method runs only bring back the start position (their steps stay in the method panel)
  if (run.mode !== "method") (form.elements.namedItem("mode") as RadioNodeList).value = run.mode;
  // Step runs bring back their pieces (every alternative, one per line), offsets, solvable-with moves and blindfolded fields too
  if (run.mode === "step") {
    piecesInput.value = run.alternatives.join("\n");
    offsetsInput.value = offsetsToText(run.offsets);
    solvableInput.value = run.solvableWith.join(" ");
    if (run.bld) showBld(run.bld);
  }
  syncViewer();
  showResult(run);
}
