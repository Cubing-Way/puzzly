// Test bench page: the puzzle picker, and what the page shows of the picked puzzle (chips, move boxes, hand-turn rows, presets, quick picks, alg sets, the viewer)

// Cube engine
import { PUZZLES, activePuzzle, puzzleById, switchPuzzle, parseGoalText, parseMoves, splitAlternatives, offsetsFromText, solvableFromText, bufferFromText, parityFromText } from "../engine";
// Piece chips and presets
import { buildChips } from "./chips";
// Page elements
import { form, puzzleSelect, presetSelect, piecesInput, algsSelect, bufferInput, parityInput } from "./dom";
// Reads the step form
import { showMoves } from "./form";
// The method editor: its unsaved changes, and the picked puzzle's methods
import { mayDropMethod, showExamples } from "./method-editor";
// Each puzzle's runs table
import { showRunsOf } from "./results";
// Scramble action
import { newScramble } from "./solve";
// Status line and busy state
import { setBusy, setStatus } from "./status";
// 3D cube viewer
import { player } from "./viewer";

// True when some text reads on the active puzzle (the read throws on a piece or move it doesn't have)
function reads(read: () => unknown): boolean {
  try {
    read();
    return true;
  } catch {
    return false;
  }
}

// Show the active puzzle on the page: its chips and viewer, only its move boxes (its default moves ticked) and hand-turn rows, only the presets, quick picks and alg sets it can read,
// and its own runs table
export function showPuzzle(): void {
  const spec = activePuzzle;
  // Move boxes: a letter box or its half-turn box, for the puzzle's default and extra moves only
  const offered = new Set([...spec.defaultMoves, ...spec.extraMoves]);
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="move"]')) {
    const label = box.closest("label");
    if (label) label.hidden = !offered.has(box.value.replace(/2$/, ""));
  }
  showMoves(spec.defaultMoves);
  // Hand-turn rows for turn kinds the puzzle has (the 2x2x2 has no wide or slice turns)
  for (const [name, turns] of [["wide-axis", spec.turnFamilies.wide], ["slice-axis", spec.turnFamilies.slice]] as const) {
    const row = form.querySelector(`input[name="${name}"]`)?.closest<HTMLElement>(".hand-turns");
    if (row) row.hidden = !turns.length;
  }
  // Presets and quick picks the puzzle can read (e.g. no edge presets on the 2x2x2)
  for (const option of presetSelect.options) option.hidden = Boolean(option.value) && !reads(() => parseGoalText(option.value));
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-moves]")) button.hidden = !reads(() => (button.dataset.moves ?? "").split(" ").forEach(parseMoves));
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-offsets]")) button.hidden = !reads(() => offsetsFromText(button.dataset.offsets ?? ""));
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-solvable]")) button.hidden = !reads(() => solvableFromText(button.dataset.solvable ?? ""));
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-bld]")) {
    const [buffer, parity] = (button.dataset.bld ?? "|").split("|");
    button.hidden = !reads(() => [bufferFromText(buffer), parityFromText(parity)]);
  }
  // Alg sets that belong to the puzzle ("none" always)
  for (const option of algsSelect.options) option.hidden = Boolean(option.value) && !spec.algSets.includes(option.value);
  if (algsSelect.selectedOptions[0]?.hidden) algsSelect.value = "";
  // Goal and blindfolded fields the puzzle can't read start over: the first preset it can, no buffer or parity pieces
  if (!reads(() => splitAlternatives(piecesInput.value).forEach(parseGoalText))) piecesInput.value = [...presetSelect.options].find((option) => option.value && !option.hidden)?.value ?? "";
  if (!reads(() => bufferFromText(bufferInput.value))) bufferInput.value = "";
  if (!reads(() => parityFromText(parityInput.value))) parityInput.value = "";
  buildChips();
  // The viewer draws the puzzle cubing.js knows by that id
  player.puzzle = spec.viewer.puzzle as typeof player.puzzle;
  // Its solves so far (another puzzle's stay kept for when it's picked again)
  showRunsOf(spec.id);
}

// Fill the picker with the built-in puzzles; picking one (after asking if the method's unsaved changes would be lost) loads it into the engine, shows it
// with its example and saved methods, and gets a new scramble
export function wirePuzzlePicker(): void {
  for (const spec of Object.values(PUZZLES)) puzzleSelect.add(new Option(spec.name, spec.id));
  puzzleSelect.value = activePuzzle.id;
  puzzleSelect.addEventListener("change", async () => {
    const spec = puzzleById(puzzleSelect.value);
    // The method in the editor is the old puzzle's: it goes, so unsaved changes need an OK
    if (!mayDropMethod()) {
      puzzleSelect.value = activePuzzle.id;
      return;
    }
    setBusy(true);
    setStatus(`Loading the ${spec.name}…`);
    try {
      await switchPuzzle(spec);
    } catch (error) {
      setStatus(`Puzzle error: ${(error as Error).message}`, "error");
      puzzleSelect.value = activePuzzle.id;
      return;
    } finally {
      setBusy(false);
    }
    showPuzzle();
    showExamples();
    await newScramble();
  });
}
