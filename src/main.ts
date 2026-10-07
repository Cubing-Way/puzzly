// Test page for the cube engine: pick a start position and a goal, solve, check, replay

// Cube engine (no page code in there)
import {
  PIECE_NAMES,
  loadEngine,
  parseMoves,
  parseGoalText,
  splitAlternatives,
  readAlternatives,
  goalOnCube,
  gripRotations,
  joinMoves,
  invertMoves,
  offsetsFromText,
  roleFromSuffix,
  roleSuffix,
  randomScramble,
  solveStep,
  solveFull,
  reachesGoal,
  countMoves,
  runMethod,
  type GoalPiece,
  type Role,
  type Method,
  type StepConfig,
  type TableProgress,
} from "./engine";
// Example, saved and file methods
import { exampleMethods, savedMethods, saveMethod, deleteSavedMethod, downloadMethod, readMethodFile } from "./method-store";
// 3D cube viewer (importing it also registers <twisty-player>)
import { TwistyPlayer } from "cubing/twisty";

// One finished solve
interface Run {
  scramble: string; // start position
  done: string; // moves earlier steps did after the scramble
  mode: "step" | "full" | "method"; // one step, the whole cube, or every step of a method
  pieces: string; // goal pieces solved, named in the grip the solution ends in ("" for full solves; every step's pieces for a method)
  alternatives: string[]; // goal texts the step could pick from (one for most steps; none for full solves and whole methods)
  alternative: number; // which of them won (0 = the first, or the only one)
  offsets: string[]; // offsets the goal counted up to ([""] = none)
  goal: string; // label shown in the runs table
  solution: string; // grip rotation (if any), then the moves
  offset: string; // offset the solution ended up to ("" = none), still in the cube
  moves: number;
  ms: number;
  ok: boolean; // scramble + done + solution really reaches the goal (up to one of the offsets)
}

// Find a page element by id
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Page elements
const form = $<HTMLFormElement>("solve-form");
const scrambleInput = $<HTMLTextAreaElement>("scramble-input");
const scrambleError = $("scramble-error");
const doneInput = $<HTMLInputElement>("done-input");
const doneError = $("done-error");
const randomButton = $<HTMLButtonElement>("random-button");
const clearButton = $<HTMLButtonElement>("clear-button");
const stepOptions = $<HTMLFieldSetElement>("step-options");
const presetSelect = $<HTMLSelectElement>("preset-select");
const piecesInput = $<HTMLTextAreaElement>("pieces-input");
const piecesError = $("pieces-error");
const addAlternativeButton = $<HTMLButtonElement>("add-alternative");
const roleSelect = $<HTMLSelectElement>("role-select");
const anyFrontBox = $<HTMLInputElement>("any-front");
const offsetsInput = $<HTMLInputElement>("offsets-input");
const offsetsError = $("offsets-error");
const searchCount = $("search-count");
const maxDepthInput = $<HTMLInputElement>("max-depth");
const firstFoundBox = $<HTMLInputElement>("first-found");
const solveButton = $<HTMLButtonElement>("solve-button");
const statusText = $("status");
const solutionText = $("solution");
const movesStat = $("moves-stat");
const timeStat = $("time-stat");
const checkStat = $("check-stat");
const offsetStat = $("offset-stat");
const alternativeStat = $("alternative-stat");
const continueButton = $<HTMLButtonElement>("continue-button");
const copyButton = $<HTMLButtonElement>("copy-button");
const runsBody = $("runs-body");
const runsEmpty = $("runs-empty");
const methodEditor = $<HTMLFieldSetElement>("method-editor");
const methodSelect = $<HTMLSelectElement>("method-select");
const methodNameInput = $<HTMLInputElement>("method-name");
const saveMethodButton = $<HTMLButtonElement>("save-method");
const deleteMethodButton = $<HTMLButtonElement>("delete-method");
const exportMethodButton = $<HTMLButtonElement>("export-method");
const importMethodButton = $<HTMLButtonElement>("import-method");
const methodFileInput = $<HTMLInputElement>("method-file");
const stepList = $("step-list");
const stepsEmpty = $("steps-empty");
const stepNameInput = $<HTMLInputElement>("step-name");
const keepBox = $<HTMLInputElement>("step-keep");
const addStepButton = $<HTMLButtonElement>("add-step");
const updateStepButton = $<HTMLButtonElement>("update-step");
const runMethodButton = $<HTMLButtonElement>("run-method");
const methodBody = $("method-body");
const methodEmpty = $("method-empty");

// 3D viewer: shows the start position, then plays the solution
const player = new TwistyPlayer({
  puzzle: "3x3x3",
  background: "none",
  controlPanel: "bottom-row",
  colorScheme: "auto",
});
$("player-slot").append(player);

// Every solve so far, newest first
const runs: Run[] = [];
// Solve shown in the result panel
let shown: Run | null = null;
// True while the solver or scrambler is working
let busy = false;
// Example methods (filled in once the engine is loaded)
let examples: Method[] = [];
// Method being edited: steps run in order
let method: Method = { name: "", steps: [] };
// Step loaded into the form for editing (-1 = none)
let editing = -1;
// True when the method has changes that aren't saved
let dirty = false;
// Rows of the last method run: one per step, then the total
let methodRows: { label: string; run: Run }[] = [];

// Show a message in the status line (kind sets its color)
function setStatus(text: string, kind: "info" | "ok" | "error" = "info"): void {
  statusText.textContent = text;
  statusText.dataset.kind = kind;
}

// Lock the action buttons while the worker is busy
function setBusy(on: boolean): void {
  busy = on;
  solveButton.disabled = on;
  randomButton.disabled = on;
  // The method can't change while something runs
  methodEditor.disabled = on;
}

// Time as "850 ms" or "1.42 s"
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// Count with its word, e.g. "1 grip" or "4 grips"
function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

// Follows the search worker's table work during one solve: a note for the live status while a table is built or loaded, and counts for the final status
function tableTracker() {
  let note = "";
  let built = 0;
  let loaded = 0;
  return {
    // Progress listener for solveStep / runMethod
    onProgress(progress: TableProgress): void {
      if (!progress.finished) note = progress.action === "build" ? " · building tables…" : " · loading stored tables…";
      else {
        note = "";
        if (progress.states && progress.action === "build") built++;
        if (progress.states && progress.action === "load") loaded++;
      }
    },
    // Note for the live status line ("" when no table is being built or loaded)
    note: () => note,
    // Counts for the final status, e.g. ", built 2 tables"
    summary: () => (built ? `, built ${plural(built, "table")}` : "") + (loaded ? `, loaded ${plural(loaded, "stored table")}` : ""),
  };
}

// Goal mode picked in the form
function currentMode(): "step" | "full" {
  return (form.elements.namedItem("mode") as RadioNodeList).value as "step" | "full";
}

// Read a moves field; returns the moves cleaned up, or null and shows why under the field
function readMoves(input: HTMLTextAreaElement | HTMLInputElement, error: HTMLElement): string | null {
  try {
    const moves = parseMoves(input.value);
    error.textContent = "";
    return moves;
  } catch (problem) {
    error.textContent = (problem as Error).message;
    return null;
  }
}

// Check the goal pieces, one alternative per line; returns false and shows why on a typo or an empty goal (empty is fine for a step that keeps earlier pieces)
function readPieces(): boolean {
  try {
    readAlternatives(piecesInput.value, !keepBox.checked);
    piecesError.textContent = "";
  } catch (error) {
    piecesError.textContent = (error as Error).message;
  }
  return piecesError.textContent === "";
}

// Number of the pieces line the caret is on (the chips, preset and viewer follow that alternative)
function currentLine(): number {
  return piecesInput.value.slice(0, piecesInput.selectionStart).split("\n").length - 1;
}

// Goal text on the caret's line
function currentLineText(): string {
  return piecesInput.value.split("\n")[currentLine()] ?? "";
}

// Put new goal text on the caret's line, leaving the caret at that line's end
function setCurrentLine(text: string): void {
  const lines = piecesInput.value.split("\n");
  const at = currentLine();
  lines[at] = text;
  piecesInput.value = lines.join("\n");
  const end = lines.slice(0, at + 1).join("\n").length;
  piecesInput.setSelectionRange(end, end);
}

// Grow the pieces box to show every line (one line per alternative)
function fitPieces(): void {
  piecesInput.rows = Math.max(1, piecesInput.value.split("\n").length);
}

// Which alternative won, as " (alt 2 of 3)" ("" when the run had only one)
function alternativeNote(run: Run): string {
  return run.alternatives.length > 1 ? ` (alt ${run.alternative + 1} of ${run.alternatives.length})` : "";
}

// Read the offsets field; returns the offsets (no offset first), or null and shows why under the field
function readOffsets(): string[] | null {
  try {
    const offsets = offsetsFromText(offsetsInput.value);
    offsetsError.textContent = "";
    return offsets;
  } catch (problem) {
    offsetsError.textContent = (problem as Error).message;
    return null;
  }
}

// Offsets back as field text (no offset left out; commas only when an offset has several moves)
function offsetsText(offsets: string[]): string {
  const typed = offsets.filter(Boolean);
  return typed.join(typed.some((offset) => offset.includes(" ")) ? ", " : " ");
}

// Read one word of goal text, or null if it has a typo
function pieceOf(word: string): GoalPiece | null {
  try {
    return parseGoalText(word)[0] ?? null;
  } catch {
    return null;
  }
}

// Roles in a goal text by "ORBIT:number" (words with typos are skipped here; readPieces reports them)
function rolesIn(text: string): Map<string, Role> {
  const roles = new Map<string, Role>();
  for (const word of text.split(/[\s,]+/).filter(Boolean)) {
    const piece = pieceOf(word);
    if (piece) roles.set(`${piece.orbit}:${piece.index}`, piece.role);
  }
  return roles;
}

// Order-free key of a goal text, for matching it against the presets
function goalKey(text: string): string {
  return [...rolesIn(text)].map(([piece, role]) => `${piece}=${role}`).sort().join(" ");
}

// Viewer mask letter for a role: full color, only the orientation sticker, orientation sticker dimmed, or dimmed for swap groups
function maskChar(role: Role): string {
  if (role === "solve") return "-";
  if (role === "place") return "P";
  return role.startsWith("orient") ? "O" : "D";
}

// Viewer mask for the grip after scramble + done: goal pieces drawn by role, the rest grey (null = whole cube)
function maskFor(pieces: string | null, scramble: string, done: string): string {
  const goal = pieces === null ? null : goalOnCube(pieces, scramble, done);
  return Object.entries(PIECE_NAMES)
    .map(([orbit, names]) => {
      // One letter per piece: its role's letter, or "I" when the goal ignores it
      const letters = names.map((_, i) => {
        const role = goal ? goal[orbit]?.[i] : "solve";
        return role ? maskChar(role) : "I";
      });
      return `${orbit}:${letters.join("")}`;
    })
    .join(",");
}

// Make one chip per edge, corner and center; clicking gives it the picked role
function buildChips(): void {
  for (const [orbit, box] of [
    ["EDGES", $("edge-chips")],
    ["CORNERS", $("corner-chips")],
    ["CENTERS", $("center-chips")],
  ] as const) {
    PIECE_NAMES[orbit].forEach((name, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = name;
      chip.dataset.piece = `${orbit}:${index}`;
      chip.addEventListener("click", () => togglePiece(orbit, index, name));
      box.append(chip);
    });
  }
}

// Show each chip's role from the caret's line of the pieces box (pressed = in that goal, data-tag = its role suffix)
function renderChips(): void {
  const roles = rolesIn(currentLineText());
  // No center typed means all six are kept
  const allCenters = ![...roles.keys()].some((piece) => piece.startsWith("CENTERS:"));
  for (const chip of document.querySelectorAll<HTMLButtonElement>(".chip")) {
    const piece = chip.dataset.piece ?? "";
    const role = roles.get(piece);
    chip.setAttribute("aria-pressed", String(Boolean(role)));
    chip.dataset.tag = role ? roleSuffix(role) : "";
    chip.dataset.auto = String(allCenters && piece.startsWith("CENTERS:"));
  }
}

// Give one piece the role picked in "Chip click sets" on the caret's line, or remove it when it already has that role
function togglePiece(orbit: string, index: number, name: string): void {
  const words = currentLineText().split(/[\s,]+/).filter(Boolean);
  // Find this piece's word, if it's already there
  const at = words.findIndex((word) => {
    const piece = pieceOf(word);
    return piece?.orbit === orbit && piece.index === index;
  });
  // Role a click gives (the picker only holds valid suffixes)
  const role = roleFromSuffix(roleSelect.value) ?? "solve";
  // Same role again removes the word; otherwise write name + role suffix
  if (at !== -1 && pieceOf(words[at])?.role === role) words.splice(at, 1);
  else if (at === -1) words.push(name + roleSuffix(role));
  else words[at] = name + roleSuffix(role);
  setCurrentLine(words.join(" "));
  onInputChange();
}

// Preset whose pieces match a goal text (undefined = none)
function presetFor(text: string): HTMLOptionElement | undefined {
  const typed = goalKey(text);
  return [...presetSelect.options].find((option) => option.value && goalKey(option.value) === typed);
}

// Select the preset that matches the caret's goal line, or "Custom"
function syncPreset(): void {
  presetSelect.value = presetFor(currentLineText())?.value ?? "";
}

// Name for a goal text in the runs table: its preset's name when it matches one, else the text
function goalLabel(text: string): string {
  return presetFor(text)?.text ?? text;
}

// Grips the step search may use, from the bottom-face boxes and the any-front switch
function chosenGrips(): string[] {
  const bottoms = [...form.querySelectorAll<HTMLInputElement>('input[name="bottom"]:checked')].map((box) => box.value);
  return gripRotations(bottoms, anyFrontBox.checked);
}

// Show how many searches a step solve may run: alternatives × grips × offsets (null = offsets unreadable, so no count)
function showSearchCount(offsets: string[] | null): void {
  const grips = chosenGrips().length;
  const alternatives = splitAlternatives(piecesInput.value).length;
  // Alternatives are only mentioned when there are several
  const each = alternatives > 1 ? `${plural(alternatives, "alternative")} × ` : "";
  // One search per alternative × grip covers every offset (they share one table)
  const allOffsets = offsets && offsets.length > 1 ? `, each covering all ${offsets.length} offsets (counting none)` : "";
  searchCount.textContent = offsets
    ? `Up to ${plural(alternatives * grips, "search", "searches")}: ${each}${plural(grips, "grip")}${allOffsets}. Repeats, and grips whose distance can't beat the best, are skipped.`
    : "";
}

// Offsets or grips edited: check the offsets and update the search count (the shown result stays)
function onSearchChange(): void {
  showSearchCount(readOffsets());
}

// Push the form into the viewer; returns false if something can't be read
function syncViewer(): boolean {
  const step = currentMode() === "step";
  // Step options only matter for step solves
  stepOptions.disabled = !step;
  fitPieces();
  renderChips();
  syncPreset();
  // Validate the inputs (step pieces and offsets only in step mode)
  const scramble = readMoves(scrambleInput, scrambleError);
  const done = readMoves(doneInput, doneError);
  const piecesOk = step ? readPieces() : true;
  const offsets = step ? readOffsets() : [""];
  if (!step) piecesError.textContent = offsetsError.textContent = "";
  showSearchCount(offsets);
  // Update the cube for whatever parsed (mask the caret line's goal in the grip the cube is held in now)
  if (scramble !== null && done !== null) player.experimentalSetupAlg = joinMoves(scramble, done);
  if (piecesOk) player.experimentalStickeringMaskOrbits = maskFor(step ? currentLineText() : null, scramble ?? "", done ?? "");
  return scramble !== null && done !== null && piecesOk && offsets !== null;
}

// Form edited by hand: refresh the viewer and drop the outdated result
function onInputChange(): void {
  syncViewer();
  showResult(null);
}

// Caret moved in the pieces box: the chips, preset and viewer follow that line's alternative (a shown result stays on the cube)
function onCaretMove(): void {
  if (shown) {
    renderChips();
    syncPreset();
  } else syncViewer();
}

// Fill the result panel and the viewer's solution (null = clear)
function showResult(run: Run | null): void {
  shown = run;
  // Viewer: start position + solution, rewound to the start
  player.alg = run?.solution ?? "";
  player.timestamp = "start";
  // Mask the goal pieces of the grip the solution ends in (it may start with a rotation)
  if (run) player.experimentalStickeringMaskOrbits = maskFor(run.mode === "full" ? null : run.pieces, run.scramble, joinMoves(run.done, run.solution));
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

// One table row for a run: label, moves, offset, time, check and solution cells (pick and order them with `cells`)
function runRow(run: Run, label: string, cells: string[], onClick: () => void): HTMLTableRowElement {
  const row = document.createElement("tr");
  // Text for each kind of cell
  const texts: Record<string, string> = {
    label,
    moves: String(run.moves),
    offset: run.offset || "—",
    time: formatMs(run.ms),
    check: run.ok ? "✓" : "✗",
    solution: run.solution || "(already solved)",
  };
  for (const kind of cells) {
    const cell = document.createElement("td");
    cell.textContent = texts[kind];
    cell.dataset.col = kind;
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
function renderMethodRows(): void {
  methodEmpty.hidden = methodRows.length > 0;
  methodBody.replaceChildren(
    ...methodRows.map(({ label, run }) => {
      const row = runRow(run, label + alternativeNote(run), ["label", "moves", "offset", "check", "time", "solution"], () => showResult(run));
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
  // Step runs bring back their pieces (every alternative, one per line) and offsets too
  if (run.mode === "step") {
    piecesInput.value = run.alternatives.join("\n");
    offsetsInput.value = offsetsText(run.offsets);
  }
  syncViewer();
  showResult(run);
}

// Put a new random-state scramble in the start position (a new attempt, so nothing is done yet)
async function newScramble(): Promise<void> {
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
async function solve(): Promise<void> {
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
  // Step goal: one alternative per line, any one counts (labelled with preset names where they match)
  const alternatives = mode === "step" ? splitAlternatives(piecesInput.value) : [];
  const pieces = alternatives.join(" | ");
  const goal = mode === "full" ? "Full cube" : alternatives.map(goalLabel).join(" | ");
  const generatorMoves = [...form.querySelectorAll<HTMLInputElement>('input[name="move"]:checked')].map((box) => box.value);
  const maxDepth = maxDepthInput.value ? Number(maxDepthInput.value) : undefined;
  // First-answer mode only applies to steps
  const firstFound = mode === "step" && firstFoundBox.checked;
  const rotations = chosenGrips();
  // Offsets only apply to steps (syncViewer already checked the field)
  const offsets = mode === "step" ? (readOffsets() ?? [""]) : [""];
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
    if (mode === "full") solution = (await solveFull(scramble, done)).toString();
    else {
      const result = await solveStep(scramble, pieces, { generatorMoves, maxDepth, rotations, done, offsets, firstFound, onProgress: tables.onProgress });
      solution = result.solution.toString();
      solved = result.pieces;
      alternative = result.alternative;
      offset = result.offset;
      searches = result.searches;
    }
    const ms = performance.now() - started;
    clearInterval(timer);
    // Double-check the answer on our own pattern (the winning alternative; any of the step's offsets counts)
    const ok = reachesGoal(scramble, joinMoves(done, solution), mode === "full" ? null : solved, offsets);
    // Record and show the run
    const run: Run = { scramble, done, mode, pieces: solved, alternatives, alternative, offsets, goal, solution, offset, moves: countMoves(solution), ms, ok };
    runs.unshift(run);
    showResult(run);
    // Mention how many searches ran (all compared, or up to the first answer), the alternative that won and the offset left in
    const compared = firstFound ? `, first answer at search ${searches}` : searches > 1 ? `, best of ${searches} searches` : "";
    const wonNote = alternatives.length > 1 ? `, alternative ${alternative + 1}: ${goalLabel(alternatives[alternative])}` : "";
    const offsetNote = offset ? `, offset ${offset}` : "";
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

// Read the step form into a method step (named `Step N` when the name is blank); returns null and shows why when a field can't be read
function stepFromForm(number: number): StepConfig | null {
  if (currentMode() !== "step") {
    setStatus("Switch Goal to Step to set up a method step.", "error");
    return null;
  }
  // Pieces and offsets, checked like a step solve
  const piecesOk = readPieces();
  const offsets = readOffsets();
  const moves = [...form.querySelectorAll<HTMLInputElement>('input[name="move"]:checked')].map((box) => box.value);
  const bottom = [...form.querySelectorAll<HTMLInputElement>('input[name="bottom"]:checked')].map((box) => box.value);
  if (!piecesOk || !offsets) setStatus("Fix the marked field first.", "error");
  else if (!moves.length) setStatus("Pick at least one allowed move.", "error");
  else if (!bottom.length) setStatus("Pick at least one bottom face.", "error");
  else {
    return {
      name: stepNameInput.value.trim() || `Step ${number}`,
      // One alternative per line in the form, " | " between them in the method
      pieces: splitAlternatives(piecesInput.value).join(" | "),
      keep: keepBox.checked,
      grips: { bottom, anyFront: anyFrontBox.checked },
      offsets: offsetsText(offsets),
      moves,
      maxDepth: maxDepthInput.value ? Number(maxDepthInput.value) : null,
      firstFound: firstFoundBox.checked,
    };
  }
  return null;
}

// Put a method step into the form (and the step name / keep fields) for editing
function stepToForm(step: StepConfig): void {
  (form.elements.namedItem("mode") as RadioNodeList).value = "step";
  // Each alternative on its own line
  piecesInput.value = splitAlternatives(step.pieces).join("\n");
  offsetsInput.value = step.offsets;
  // Grips and allowed moves as checkboxes
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="bottom"]')) box.checked = step.grips.bottom.includes(box.value);
  anyFrontBox.checked = step.grips.anyFront;
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="move"]')) box.checked = step.moves.includes(box.value);
  maxDepthInput.value = step.maxDepth == null ? "" : String(step.maxDepth);
  firstFoundBox.checked = Boolean(step.firstFound);
  stepNameInput.value = step.name;
  keepBox.checked = Boolean(step.keep);
  onInputChange();
}

// One-line summary of a step's settings for the step list
function stepSummary(step: StepConfig): string {
  return [
    step.pieces || "no new pieces",
    step.keep ? "+ earlier pieces" : "",
    `bottom ${step.grips.bottom.join("/")}${step.grips.anyFront ? " any front" : ""}`,
    step.offsets ? `offsets ${step.offsets}` : "",
    `moves ${step.moves.join(" ")}`,
    step.maxDepth == null ? "" : `max ${step.maxDepth}`,
    step.firstFound ? "first answer" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Small button for a step's row
function stepButton(text: string, label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

// Redraw the step list (the step loaded in the form is highlighted) and the Update button
function renderSteps(): void {
  stepsEmpty.hidden = method.steps.length > 0;
  stepList.replaceChildren(
    ...method.steps.map((step, index) => {
      const item = document.createElement("li");
      item.classList.toggle("editing", index === editing);
      // Name, then the summary underneath
      const text = document.createElement("div");
      text.className = "step-text";
      const name = document.createElement("strong");
      name.textContent = step.name;
      const summary = document.createElement("small");
      summary.textContent = stepSummary(step);
      text.append(name, summary);
      // Edit, move up, move down, remove
      const actions = document.createElement("div");
      actions.className = "step-actions";
      actions.append(
        stepButton("Edit", `Edit ${step.name} in the form`, false, () => editStep(index)),
        stepButton("↑", `Move ${step.name} up`, index === 0, () => moveStep(index, -1)),
        stepButton("↓", `Move ${step.name} down`, index === method.steps.length - 1, () => moveStep(index, 1)),
        stepButton("✕", `Remove ${step.name}`, false, () => removeStep(index)),
      );
      item.append(text, actions);
      return item;
    }),
  );
  updateStepButton.disabled = editing === -1;
  updateStepButton.textContent = editing === -1 ? "Update step" : `Update step ${editing + 1}`;
}

// Steps changed: redraw them, drop the outdated method results, remember there's something to save
function methodChanged(): void {
  dirty = true;
  renderSteps();
  methodRows = [];
  renderMethodRows();
}

// Load a step into the form for editing
function editStep(index: number): void {
  editing = index;
  stepToForm(method.steps[index]);
  renderSteps();
  setStatus(`Editing step ${index + 1}: change the form, then Update step ${index + 1}.`);
}

// Move a step one place up (-1) or down (+1); the step being edited stays selected
function moveStep(index: number, by: number): void {
  const other = index + by;
  [method.steps[index], method.steps[other]] = [method.steps[other], method.steps[index]];
  if (editing === index) editing = other;
  else if (editing === other) editing = index;
  methodChanged();
}

// Remove a step (stops editing it if it was in the form)
function removeStep(index: number): void {
  method.steps.splice(index, 1);
  if (editing === index) editing = -1;
  else if (editing > index) editing--;
  methodChanged();
}

// Add the form as a new last step, and keep editing it
function addStep(): void {
  const step = stepFromForm(method.steps.length + 1);
  if (!step) return;
  method.steps.push(step);
  editing = method.steps.length - 1;
  stepNameInput.value = step.name;
  methodChanged();
  setStatus(`Added step ${editing + 1} (${step.name}).`, "ok");
}

// Save the form into the step being edited
function updateStep(): void {
  if (editing === -1) return;
  const step = stepFromForm(editing + 1);
  if (!step) return;
  method.steps[editing] = step;
  stepNameInput.value = step.name;
  methodChanged();
  setStatus(`Updated step ${editing + 1} (${step.name}).`, "ok");
}

// Fill the method picker: a placeholder, a new empty method, the examples, then the methods saved in this browser
function fillMethodSelect(): void {
  const examplesGroup = document.createElement("optgroup");
  examplesGroup.label = "Examples";
  examplesGroup.append(...examples.map((example, index) => new Option(example.name, `example:${index}`)));
  const saved = savedMethods();
  const savedGroup = document.createElement("optgroup");
  savedGroup.label = "Saved in this browser";
  savedGroup.append(...saved.map((entry) => new Option(entry.name, `saved:${entry.name}`)));
  methodSelect.replaceChildren(new Option("Load a method…", ""), new Option("New (empty)", "new"), examplesGroup, ...(saved.length ? [savedGroup] : []));
  methodSelect.value = "";
}

// Delete only works when a method with this name is saved
function syncDeleteButton(): void {
  const name = methodNameInput.value.trim();
  deleteMethodButton.disabled = !savedMethods().some((entry) => entry.name === name);
}

// Put a method in the editor (a copy, so edits don't change the original) and clear the old results
function loadMethod(next: Method): void {
  method = structuredClone(next);
  methodNameInput.value = method.name;
  editing = -1;
  stepNameInput.value = "";
  keepBox.checked = false;
  methodChanged();
  dirty = false;
  syncDeleteButton();
}

// The method as it stands, with the name from its field
function currentMethod(): Method {
  return { ...method, name: methodNameInput.value.trim() || "Untitled method" };
}

// Run every step of the method from the start position (scramble, then Done so far), showing each step as it finishes
async function runWholeMethod(): Promise<void> {
  if (busy) return;
  const scramble = readMoves(scrambleInput, scrambleError);
  const done = readMoves(doneInput, doneError);
  if (scramble === null || done === null) {
    setStatus("Fix the marked field first.", "error");
    return;
  }
  if (!method.steps.length) {
    setStatus("Add at least one step first.", "error");
    return;
  }
  // Run a copy, so the steps can't change mid-run
  const running = structuredClone(currentMethod());
  setBusy(true);
  showResult(null);
  methodRows = [];
  renderMethodRows();
  // Live status: which step is searching, the time so far, and table builds or loads
  const started = performance.now();
  const tables = tableTracker();
  const tick = () => {
    const index = methodRows.length;
    setStatus(`Running ${running.name}: step ${index + 1} of ${running.steps.length} (${running.steps[index]?.name ?? "…"})… ${formatMs(performance.now() - started)}${tables.note()}`);
  };
  tick();
  const timer = setInterval(tick, 100);
  try {
    const result = await runMethod(scramble, running, {
      done,
      onProgress: tables.onProgress,
      // Add each step's row as soon as it finishes
      onStep: (step, index) => {
        const run: Run = {
          scramble,
          done: step.done,
          mode: "step",
          pieces: step.pieces,
          alternatives: splitAlternatives(running.steps[index].pieces),
          alternative: step.alternative,
          offsets: step.offsets,
          goal: `${running.name}: ${step.name}`,
          solution: step.solution.toString(),
          offset: step.offset,
          moves: step.moves,
          ms: step.ms,
          ok: step.ok,
        };
        methodRows.push({ label: `${index + 1}. ${step.name}`, run });
        renderMethodRows();
      },
    });
    clearInterval(timer);
    // The whole solve as one run: every step's moves, with every step's pieces shown on the cube
    const total: Run = {
      scramble,
      done,
      mode: "method",
      pieces: result.pieces,
      alternatives: [],
      alternative: 0,
      offsets: result.steps.at(-1)?.offsets ?? [""],
      goal: running.name,
      solution: result.solution,
      offset: result.offset,
      moves: result.moves,
      ms: performance.now() - started,
      ok: result.ok,
    };
    methodRows.push({ label: "Total", run: total });
    runs.unshift(total);
    showResult(total);
    setStatus(
      result.ok
        ? `${running.name} done in ${plural(result.moves, "move")} over ${plural(result.steps.length, "step")} (${formatMs(total.ms)}${tables.summary()}).`
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

// Solve on submit (Solve button, or Enter in a field)
form.addEventListener("submit", (event) => {
  event.preventDefault();
  solve();
});

// Ctrl+Enter in the moves or pieces box solves too (plain Enter adds a line: in the pieces box, a new alternative)
for (const box of [scrambleInput, piecesInput]) {
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}

// Moving the caret in the pieces box makes the chips, preset and viewer follow its line
piecesInput.addEventListener("keyup", onCaretMove);
piecesInput.addEventListener("click", onCaretMove);

// Add an alternative under the caret's line, starting as a copy of it (e.g. the cross, then click a pair's chips for an XCross)
addAlternativeButton.addEventListener("click", () => {
  const lines = piecesInput.value.split("\n");
  const at = currentLine();
  lines.splice(at + 1, 0, lines[at]);
  piecesInput.value = lines.join("\n");
  // Caret at the end of the new line, so the chips and preset edit it
  const end = lines.slice(0, at + 2).join("\n").length;
  piecesInput.focus();
  piecesInput.setSelectionRange(end, end);
  onInputChange();
});

// Typing in the moves, done or pieces box, or switching mode, updates the viewer
scrambleInput.addEventListener("input", onInputChange);
doneInput.addEventListener("input", onInputChange);
piecesInput.addEventListener("input", onInputChange);
for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  radio.addEventListener("change", onInputChange);
}

// Typing offsets, or changing the grips, updates the search count
offsetsInput.addEventListener("input", onSearchChange);
anyFrontBox.addEventListener("change", onSearchChange);
for (const box of form.querySelectorAll<HTMLInputElement>('input[name="bottom"]')) {
  box.addEventListener("change", onSearchChange);
}

// Offset quick picks fill in the offsets field
for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-offsets]")) {
  button.addEventListener("click", () => {
    offsetsInput.value = button.dataset.offsets ?? "";
    onSearchChange();
  });
}

// Picking a preset puts its pieces on the caret's line ("Custom" just moves to the pieces box)
presetSelect.addEventListener("change", () => {
  if (presetSelect.value) setCurrentLine(presetSelect.value);
  else piecesInput.focus();
  onInputChange();
});

// Scramble buttons (Clear empties the done moves too)
randomButton.addEventListener("click", newScramble);
clearButton.addEventListener("click", () => {
  scrambleInput.value = "";
  doneInput.value = "";
  onInputChange();
});

// Add the shown solution to the done moves, ready for the next step
continueButton.addEventListener("click", () => {
  if (!shown) return;
  // Offset still in the cube (read before the result panel is cleared)
  const offset = shown.offset;
  scrambleInput.value = shown.scramble;
  doneInput.value = joinMoves(shown.done, shown.solution);
  onInputChange();
  // The next step needs the same offsets, or the undo moves first
  setStatus(
    offset
      ? `Solution added to Done so far. The cube is off by ${offset}: keep these offsets for the next step, or add ${invertMoves(offset)} to undo it.`
      : "Solution added to Done so far. Pick the next step.",
  );
});

// Copy the shown solution
copyButton.addEventListener("click", async () => {
  if (!shown) return;
  await navigator.clipboard.writeText(shown.solution);
  setStatus("Solution copied.", "ok");
});

// Ticking "keep earlier steps' pieces" decides whether an empty pieces box is allowed
keepBox.addEventListener("change", () => syncViewer());

// Step list buttons under it
addStepButton.addEventListener("click", addStep);
updateStepButton.addEventListener("click", updateStep);
runMethodButton.addEventListener("click", runWholeMethod);

// Renaming counts as a change, and decides whether Delete has a saved method to remove
methodNameInput.addEventListener("input", () => {
  dirty = true;
  syncDeleteButton();
});

// Picking a method loads it (after asking if unsaved changes would be lost), then the picker goes back to its placeholder
methodSelect.addEventListener("change", () => {
  const [kind, ...rest] = methodSelect.value.split(":");
  const key = rest.join(":");
  const next =
    kind === "new" ? { name: "", steps: [] } : kind === "example" ? examples[Number(key)] : savedMethods().find((entry) => entry.name === key);
  methodSelect.value = "";
  if (!next || (dirty && !confirm("Drop the unsaved changes to this method?"))) return;
  loadMethod(next);
  setStatus(kind === "new" ? "New method: set up a step in the form, then Add form as step." : `Loaded ${next.name}.`);
});

// Save the method in this browser under its name
saveMethodButton.addEventListener("click", () => {
  const name = methodNameInput.value.trim();
  if (!name) {
    setStatus("Name the method first.", "error");
    methodNameInput.focus();
    return;
  }
  if (!method.steps.length) {
    setStatus("Add at least one step first.", "error");
    return;
  }
  method.name = name;
  try {
    saveMethod(method);
  } catch (error) {
    setStatus(`Couldn't save in this browser: ${(error as Error).message}`, "error");
    return;
  }
  dirty = false;
  fillMethodSelect();
  syncDeleteButton();
  setStatus(`Saved ${name} in this browser.`, "ok");
});

// Delete the saved method with this name (the editor keeps it, now unsaved)
deleteMethodButton.addEventListener("click", () => {
  const name = methodNameInput.value.trim();
  if (!confirm(`Delete the saved method "${name}" from this browser?`)) return;
  deleteSavedMethod(name);
  dirty = true;
  fillMethodSelect();
  syncDeleteButton();
  setStatus(`Deleted ${name} from this browser (it's still in the editor).`);
});

// Download the method as a .json file
exportMethodButton.addEventListener("click", () => {
  downloadMethod(currentMethod());
  setStatus("Method file downloaded.", "ok");
});

// Import a .json method file (after asking if unsaved changes would be lost)
importMethodButton.addEventListener("click", () => {
  if (dirty && !confirm("Drop the unsaved changes to this method?")) return;
  methodFileInput.click();
});
methodFileInput.addEventListener("change", async () => {
  const file = methodFileInput.files?.[0];
  // Clear the picker so choosing the same file again still fires
  methodFileInput.value = "";
  if (!file) return;
  try {
    loadMethod(await readMethodFile(file));
    dirty = true;
    setStatus(`Imported ${method.name} from ${file.name} (not saved in this browser yet).`, "ok");
  } catch (error) {
    setStatus(`Couldn't import ${file.name}: ${(error as Error).message}`, "error");
  }
});

// Start: load the engine, build the chips, show the default goal and the first example method, get a first scramble
async function start(): Promise<void> {
  await loadEngine();
  buildChips();
  piecesInput.value = presetSelect.value;
  examples = exampleMethods();
  fillMethodSelect();
  loadMethod(examples[0]);
  syncViewer();
  await newScramble();
}
start();
