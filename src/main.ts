// Test page for the cube engine: pick a start position and a goal, solve, check, replay

// Cube engine (no page code in there)
import {
  PIECE_NAMES,
  loadEngine,
  parseMoves,
  parseGoalText,
  goalFromText,
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
  type GoalPiece,
  type Role,
} from "./engine";
// 3D cube viewer (importing it also registers <twisty-player>)
import { TwistyPlayer } from "cubing/twisty";

// One finished solve
interface Run {
  scramble: string; // start position
  done: string; // moves earlier steps did after the scramble
  mode: "step" | "full";
  pieces: string; // goal pieces ("" for full solves)
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
const piecesInput = $<HTMLInputElement>("pieces-input");
const piecesError = $("pieces-error");
const roleSelect = $<HTMLSelectElement>("role-select");
const anyFrontBox = $<HTMLInputElement>("any-front");
const offsetsInput = $<HTMLInputElement>("offsets-input");
const offsetsError = $("offsets-error");
const searchCount = $("search-count");
const maxDepthInput = $<HTMLInputElement>("max-depth");
const solveButton = $<HTMLButtonElement>("solve-button");
const statusText = $("status");
const solutionText = $("solution");
const movesStat = $("moves-stat");
const timeStat = $("time-stat");
const checkStat = $("check-stat");
const offsetStat = $("offset-stat");
const continueButton = $<HTMLButtonElement>("continue-button");
const copyButton = $<HTMLButtonElement>("copy-button");
const runsBody = $("runs-body");
const runsEmpty = $("runs-empty");

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
}

// Time as "850 ms" or "1.42 s"
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// Count with its word, e.g. "1 grip" or "4 grips"
function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
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

// Check the goal pieces; returns false and shows why on a typo or an empty list
function readPieces(): boolean {
  try {
    goalFromText(piecesInput.value);
    piecesError.textContent = rolesIn(piecesInput.value).size ? "" : "Pick at least one piece.";
  } catch (error) {
    piecesError.textContent = (error as Error).message;
  }
  return piecesError.textContent === "";
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

// Show each chip's role from the pieces box (pressed = in the goal, data-tag = its role suffix)
function renderChips(): void {
  const roles = rolesIn(piecesInput.value);
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

// Give one piece the role picked in "Chip click sets", or remove it when it already has that role
function togglePiece(orbit: string, index: number, name: string): void {
  const words = piecesInput.value.split(/[\s,]+/).filter(Boolean);
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
  piecesInput.value = words.join(" ");
  onInputChange();
}

// Select the preset that matches the typed goal, or "Custom"
function syncPreset(): void {
  const typed = goalKey(piecesInput.value);
  const match = [...presetSelect.options].find((option) => option.value && goalKey(option.value) === typed);
  presetSelect.value = match?.value ?? "";
}

// Grips the step search may use, from the bottom-face boxes and the any-front switch
function chosenGrips(): string[] {
  const bottoms = [...form.querySelectorAll<HTMLInputElement>('input[name="bottom"]:checked')].map((box) => box.value);
  return gripRotations(bottoms, anyFrontBox.checked);
}

// Show how many searches a step solve may run: grips × offsets (null = offsets unreadable, so no count)
function showSearchCount(offsets: string[] | null): void {
  const grips = chosenGrips().length;
  searchCount.textContent = offsets
    ? `Up to ${plural(grips * offsets.length, "search", "searches")}: ${plural(grips, "grip")} × ${plural(offsets.length, "offset")} (counting none). Repeats are skipped.`
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
  renderChips();
  syncPreset();
  // Validate the inputs (step pieces and offsets only in step mode)
  const scramble = readMoves(scrambleInput, scrambleError);
  const done = readMoves(doneInput, doneError);
  const piecesOk = step ? readPieces() : true;
  const offsets = step ? readOffsets() : [""];
  if (!step) piecesError.textContent = offsetsError.textContent = "";
  showSearchCount(offsets);
  // Update the cube for whatever parsed (mask the goal in the grip the cube is held in now)
  if (scramble !== null && done !== null) player.experimentalSetupAlg = joinMoves(scramble, done);
  if (piecesOk) player.experimentalStickeringMaskOrbits = maskFor(step ? piecesInput.value : null, scramble ?? "", done ?? "");
  return scramble !== null && done !== null && piecesOk && offsets !== null;
}

// Form edited by hand: refresh the viewer and drop the outdated result
function onInputChange(): void {
  syncViewer();
  showResult(null);
}

// Fill the result panel and the viewer's solution (null = clear)
function showResult(run: Run | null): void {
  shown = run;
  // Viewer: start position + solution, rewound to the start
  player.alg = run?.solution ?? "";
  player.timestamp = "start";
  // Mask the goal pieces of the grip the solution ends in (it may start with a rotation)
  if (run) player.experimentalStickeringMaskOrbits = maskFor(run.mode === "step" ? run.pieces : null, run.scramble, joinMoves(run.done, run.solution));
  // Text and stats
  solutionText.textContent = run ? run.solution || "(already solved)" : "—";
  movesStat.textContent = run ? String(run.moves) : "—";
  timeStat.textContent = run ? formatMs(run.ms) : "—";
  checkStat.textContent = run ? (run.ok ? "✓ reaches goal" : "✗ misses goal") : "—";
  checkStat.dataset.kind = run ? (run.ok ? "ok" : "error") : "";
  // Offset still in the cube, with the moves that undo it
  offsetStat.textContent = run ? (run.offset ? `${run.offset} (undo: ${invertMoves(run.offset)})` : "none") : "—";
  // Actions need a non-empty solution
  continueButton.disabled = copyButton.disabled = !run?.solution;
  renderRuns();
}

// Redraw the runs table; clicking a row shows that run again
function renderRuns(): void {
  runsEmpty.hidden = runs.length > 0;
  runsBody.replaceChildren(
    ...runs.map((run, index) => {
      const row = document.createElement("tr");
      // One cell per column
      for (const text of [
        String(runs.length - index),
        run.goal,
        String(run.moves),
        run.offset || "—",
        formatMs(run.ms),
        run.ok ? "✓" : "✗",
        run.solution || "(already solved)",
      ]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      // Highlight the shown run and failed checks
      row.classList.toggle("selected", run === shown);
      row.classList.toggle("bad", !run.ok);
      row.addEventListener("click", () => loadRun(run));
      return row;
    }),
  );
}

// Put a past run back in the form and viewer
function loadRun(run: Run): void {
  if (busy) return;
  scrambleInput.value = run.scramble;
  doneInput.value = run.done;
  (form.elements.namedItem("mode") as RadioNodeList).value = run.mode;
  // Step runs bring back their pieces and offsets too
  if (run.mode === "step") {
    piecesInput.value = run.pieces;
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
  const pieces = mode === "step" ? piecesInput.value.trim() : "";
  const goal = mode === "full" ? "Full cube" : presetSelect.value ? presetSelect.selectedOptions[0].text : pieces;
  const generatorMoves = [...form.querySelectorAll<HTMLInputElement>('input[name="move"]:checked')].map((box) => box.value);
  const maxDepth = maxDepthInput.value ? Number(maxDepthInput.value) : undefined;
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
  // Live timer in the status line while the solver works
  const started = performance.now();
  const tick = () => setStatus(`Solving ${goal}… ${formatMs(performance.now() - started)}`);
  tick();
  const timer = setInterval(tick, 100);
  try {
    // Solve from scramble + done (a step tries every chosen grip × offset and keeps the shortest answer)
    let solution: string;
    let offset = "";
    let searches = 1;
    if (mode === "full") solution = (await solveFull(scramble, done)).toString();
    else {
      const result = await solveStep(scramble, pieces, { generatorMoves, maxDepth, rotations, done, offsets });
      solution = result.solution.toString();
      offset = result.offset;
      searches = result.searches;
    }
    const ms = performance.now() - started;
    clearInterval(timer);
    // Double-check the answer on our own pattern (any of the step's offsets counts)
    const ok = reachesGoal(scramble, joinMoves(done, solution), mode === "full" ? null : pieces, offsets);
    // Record and show the run
    const run: Run = { scramble, done, mode, pieces, offsets, goal, solution, offset, moves: countMoves(solution), ms, ok };
    runs.unshift(run);
    showResult(run);
    // Mention how many searches were compared when there was more than one, and the offset left in
    const compared = searches > 1 ? `, best of ${searches} searches` : "";
    const offsetNote = offset ? `, offset ${offset}` : "";
    setStatus(
      ok ? `${goal} solved in ${plural(run.moves, "move")} (${formatMs(ms)}${compared}${offsetNote}).` : `${goal}: the solution doesn't reach the goal!`,
      ok ? "ok" : "error",
    );
  } catch (error) {
    setStatus(`Solver error: ${(error as Error).message}`, "error");
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

// Ctrl+Enter in the moves box solves too (plain Enter adds a line)
scrambleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
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

// Picking a preset fills in its pieces ("Custom" just moves to the pieces box)
presetSelect.addEventListener("change", () => {
  if (presetSelect.value) piecesInput.value = presetSelect.value;
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

// Start: load the engine, build the chips, show the default goal, get a first scramble
async function start(): Promise<void> {
  await loadEngine();
  buildChips();
  piecesInput.value = presetSelect.value;
  syncViewer();
  await newScramble();
}
start();
