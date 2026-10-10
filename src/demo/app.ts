// Test bench page for the cube engine: pick a start position and a goal, solve, check, replay. This wires the form and starts the page

// Cube engine
import { joinMoves, invertMoves, type SearchWorker, loadEngine } from "../engine";
// Piece chips and presets
import { buildChips } from "./chips";
// Page elements
import {
  form,
  scrambleInput,
  piecesInput,
  addAlternativeButton,
  doneInput,
  offsetsInput,
  anyFrontBox,
  solvableInput,
  untouchedBox,
  bufferInput,
  perStepInput,
  parityInput,
  presetSelect,
  randomButton,
  clearButton,
  continueButton,
  copyButton,
  keepBox,
} from "./dom";
// Reads the step form
import { currentLine, onSearchChange, showMoves, readSolvable, setCurrentLine } from "./form";
// Method editor
import { wireMethodEditor, showExamples } from "./method-editor";
// Method run and method search
import { wireMethodRun } from "./method-run";
// Result panel and runs tables
import { shown } from "./results";
// Scramble and solve actions
import { solve, newScramble } from "./solve";
// Status line and busy state
import { setStatus } from "./status";
// 3D cube viewer
import { onCaretMove, onInputChange, syncViewer } from "./viewer";

// Wire the form: solving, typing, quick picks, presets, the scramble buttons and the result's actions
function wireForm(): void {
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

  // Move quick picks tick exactly their moves
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-moves]")) {
    button.addEventListener("click", () => showMoves((button.dataset.moves ?? "").split(" ")));
  }

  // Typing solvable-with moves checks them; its quick picks fill in the field
  solvableInput.addEventListener("input", readSolvable);
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-solvable]")) {
    button.addEventListener("click", () => {
      solvableInput.value = button.dataset.solvable ?? "";
      readSolvable();
    });
  }

  // Blindfolded fields: editing them rechecks the form (the pieces box may be empty with a buffer) and the cube shows whole for untouched steps
  for (const input of [untouchedBox, bufferInput, perStepInput, parityInput]) input.addEventListener("input", onInputChange);
  // Their quick picks fill in the buffer and parity pieces ("buffer|parity"); a buffer means untouched and an empty pieces box (it traces its own), None clears the box too
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[data-bld]")) {
    button.addEventListener("click", () => {
      const [buffer, parity] = (button.dataset.bld ?? "|").split("|");
      bufferInput.value = buffer;
      parityInput.value = parity;
      untouchedBox.checked = Boolean(buffer);
      if (buffer) piecesInput.value = "";
      onInputChange();
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
}

// Start the page: wire its events, load the engine (searchWorker starts the page's search worker), build the chips,
// show the default goal and the first example method, get a first scramble
export async function startPage(searchWorker: () => SearchWorker): Promise<void> {
  wireForm();
  wireMethodEditor();
  wireMethodRun();
  await loadEngine({ searchWorker });
  buildChips();
  piecesInput.value = presetSelect.value;
  showExamples();
  syncViewer();
  await newScramble();
}
