// Test bench page: finished solves (runs), the result panel (with the solution's fingering and the answers it was compared with), the runs table and the method results table

// Cube engine
import { type MethodStepResult, type Rank, type Fingering, stickeringMask, joinMoves, invertMoves, offsetsToText, fingering, speedCost, THUMBS } from "../engine";
// Page elements
import {
  solutionText,
  fingeringBox,
  fingeringBody,
  candidatesBox,
  candidatesNote,
  candidatesBody,
  movesStat,
  speedStat,
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
import { type Bld, showBld, showRank } from "./form";
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
  lookahead?: MethodStepResult["lookahead"]; // method steps with lookahead: candidates compared and the winner's total over the steps they were judged by
  bld?: Bld; // step runs: the blindfolded fields it was solved with (untouched steps show the whole cube)
  untimed?: boolean; // a step of a method search (steps aren't timed one by one there)
  rank?: Rank; // step solves: what the step's answers were ranked by
  turned?: string; // step solves: the solution as the hands make it, when some turns are made as wide or slice turns; shown and scored in place of `solution`, which stays the one to check and go on from
  alg?: string; // a step answered from an alg set: the case it recognised (shown beside the step's name)
  candidates?: Run[]; // step solves: the answers the step compared, best first (this run is one of them); each is a run of its own, so it can be shown
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

// A run's moves as the hands make them: its wide-turn writing when it has one, otherwise its solution
export function handsMoves(run: Run): string {
  return run.turned ?? run.solution;
}

// Each run's speed cost, worked out once (the tables are redrawn often)
const speeds = new WeakMap<Run, number>();

// A run's speed cost: its solution's cheapest fingering (a rotation before the first turn is free when nothing was done before the run)
function runSpeed(run: Run): number {
  let speed = speeds.get(run);
  if (speed === undefined) {
    speed = speedCost(handsMoves(run), undefined, !run.done.trim());
    speeds.set(run, speed);
  }
  return speed;
}

// Which alternative won, as " (alt 2 of 3)" ("" when the run had only one), and for a step answered from an alg set the case it recognised (" (T perm)")
function alternativeNote(run: Run): string {
  return (run.alternatives.length > 1 ? ` (alt ${run.alternative + 1} of ${run.alternatives.length})` : "") + (run.alg ? ` (${run.alg})` : "");
}

// A table row with one cell per text
function textRow(texts: string[]): HTMLTableRowElement {
  const row = document.createElement("tr");
  for (const text of texts) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.append(cell);
  }
  return row;
}

// A muted row of the fingering table for a hand that moves without turning anything (a regrip, or coming back home), with its score
function gripRow(text: string, cost: number): HTMLTableRowElement {
  const row = textRow(["↻", text, String(cost), "", ""]);
  row.classList.add("regrip");
  return row;
}

// Rows of the fingering table: one per regrip and one per move, with who makes it, its score, the other ways from that hand position (with their scores)
// and where both wrists are after it; then one per hand that has to come back home after the last move
function fingeringRows(hands: Fingering): HTMLTableRowElement[] {
  const moves = hands.steps.flatMap((step) => {
    // Regrips before the move, each a row of its own
    const regrips = step.regrips.map((regrip) => gripRow(`regrip ${regrip.hand}: ${THUMBS[regrip.to]}`, regrip.cost));
    // Who makes the move: a hand's wrist or finger, or nobody (a rotation, or a move no trick makes)
    const by = step.hand ? `${step.hand} ${step.finger}` : step.finger === "other" ? "no trick" : step.finger;
    const others = step.others.map((way) => `${way.hand} ${way.finger} ${way.cost}`).join(", ");
    // Finger regrips, an awkward grip (both hands away from home), a twisted one (the wrists turned opposite ways), turning a slow layer again and leaving
    // the rhythm for a slow layer cost more, and a turn that keeps the rhythm of the one before it costs less: all of it is in the move's score, and named
    // beside who makes it
    const notes =
      (step.fingerRegrips ? ` · finger regrip +${step.fingerRegrips}` : "") +
      (step.awkward ? ` · awkward grip +${step.awkward}` : "") +
      (step.twisted ? ` · twisted wrists +${step.twisted}` : "") +
      (step.again ? ` · ${step.move[0].toUpperCase()} again +${step.again}` : "") +
      (step.leave ? ` · leaves the rhythm +${step.leave}` : "") +
      (step.open ? ` · opposite layer open +${step.open}` : "") +
      (step.flow ? ` · in rhythm −${step.flow}` : "");
    const score = Math.round((step.cost + step.fingerRegrips + step.awkward + step.twisted + step.again + step.leave + step.open - step.flow) * 100) / 100;
    return [...regrips, textRow([step.move, by + notes, String(score), others || "—", `R ${step.wrists.right} · L ${step.wrists.left}`])];
  });
  return [...moves, ...hands.ending.map((end) => gripRow(`${end.hand} back home`, end.cost))];
}

// Fill the list of answers the shown step compared, best first, each with its moves, speed and check (hidden when there's only one); clicking one shows it
function renderCandidates(run: Run | null): void {
  const list = run?.candidates ?? [];
  candidatesBox.hidden = list.length < 2;
  candidatesNote.textContent = `${run?.rank === "speed" ? "fastest" : "shortest"} first; click one to see it`;
  candidatesBody.replaceChildren(
    ...list.map((candidate, index) => {
      const row = textRow([String(index + 1), String(candidate.moves), String(runSpeed(candidate)), candidate.ok ? "✓" : "✗", handsMoves(candidate) || "(already solved)"]);
      // Highlight the shown answer
      row.classList.toggle("selected", candidate === run);
      row.addEventListener("click", () => showResult(candidate));
      return row;
    }),
  );
}

// Fill the result panel and the viewer's solution (null = clear)
export function showResult(run: Run | null): void {
  shown = run;
  // Viewer: start position + solution, rewound to the start
  player.alg = run ? handsMoves(run) : "";
  player.timestamp = "start";
  // Mask the goal pieces of the grip the solution ends in (it may start with a rotation); full solves and untouched steps show the whole cube
  if (run) player.experimentalStickeringMaskOrbits = stickeringMask(run.mode === "full" || run.bld?.untouched ? null : run.pieces, run.scramble, joinMoves(run.done, run.solution));
  // Text and stats
  solutionText.textContent = run ? handsMoves(run) || "(already solved)" : "—";
  movesStat.textContent = run ? String(run.moves) : "—";
  // Speed: the solution's cheapest fingering, as its cost with its regrips, and one table row per move
  const hands = run?.solution ? fingering(handsMoves(run), undefined, !run.done.trim()) : null;
  speedStat.textContent = hands ? `${hands.cost} (${plural(hands.regrips, "regrip")})` : "—";
  fingeringBox.hidden = !hands;
  fingeringBody.replaceChildren(...(hands ? fingeringRows(hands) : []));
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
  renderCandidates(run);
  renderRuns();
  renderMethodRows();
}

// Lookahead cell of a method step: candidates compared → the winner's total (moves, or speed cost) over this step and the ones it was judged by, with the details on hover
function lookaheadCell(run: Run): { text: string; title: string } {
  const ahead = run.lookahead;
  if (!ahead) return { text: "—", title: "" };
  const total = ahead.total === null ? "—" : String(ahead.total);
  // What the winner takes, in the unit its step ranks by
  const takes = ahead.total === null ? "?" : ahead.rank === "speed" ? `a speed cost of ${ahead.total}` : plural(ahead.total, "move");
  const title = `Compared ${plural(ahead.candidates, "candidate answer")}; the winner takes ${takes} over this step and the next ${plural(ahead.steps, "step")}`;
  return { text: `${ahead.candidates} → ${total}`, title };
}

// One table row for a run: label, moves, speed, offset, lookahead, time, check and solution cells (pick and order them with `cells`)
function runRow(run: Run, label: string, cells: string[], onClick: () => void): HTMLTableRowElement {
  const row = document.createElement("tr");
  // Text for each kind of cell
  const ahead = lookaheadCell(run);
  const texts: Record<string, string> = {
    label,
    moves: String(run.moves),
    speed: run.solution ? String(runSpeed(run)) : "—",
    offset: run.offset || "—",
    lookahead: ahead.text,
    time: run.untimed ? "—" : formatMs(run.ms),
    check: run.ok ? "✓" : "✗",
    solution: handsMoves(run) || "(already solved)",
  };
  for (const kind of cells) {
    const cell = document.createElement("td");
    cell.textContent = texts[kind];
    cell.dataset.col = kind;
    if (kind === "lookahead") cell.title = ahead.title;
    row.append(cell);
  }
  // Highlight the shown run (or the run whose other answer is shown) and failed checks
  row.classList.toggle("selected", run === shown || (shown !== null && Boolean(run.candidates?.includes(shown))));
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
      const row = runRow(run, run.goal + alternativeNote(run), ["label", "moves", "speed", "offset", "time", "check", "solution"], () => loadRun(run));
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
      const row = runRow(run, label + alternativeNote(run), ["label", "moves", "speed", "offset", "lookahead", "check", "time", "solution"], () => showResult(run));
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
  // Step runs bring back their pieces (every alternative, one per line), offsets, solvable-with moves, blindfolded fields and rank too
  if (run.mode === "step") {
    piecesInput.value = run.alternatives.join("\n");
    offsetsInput.value = offsetsToText(run.offsets);
    solvableInput.value = run.solvableWith.join(" ");
    if (run.bld) showBld(run.bld);
    if (run.rank) showRank(run.rank);
  }
  syncViewer();
  showResult(run);
}
