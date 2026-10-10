// Test bench page: the 3D cube, kept in step with the form

// 3D cube viewer (importing it also registers <twisty-player>)
import { TwistyPlayer } from "cubing/twisty";
// Cube engine
import { joinMoves, stickeringMask } from "../engine";
// Piece chips and presets
import { renderChips, syncPreset } from "./chips";
// Page elements
import { $, stepOptions, scrambleInput, scrambleError, doneInput, doneError, piecesError, offsetsError, solvableError, bldError } from "./dom";
// Reads the step form
import { currentMode, fitPieces, readMoves, readPieces, readOffsets, readSolvable, readBld, showSearchCount, currentLineText } from "./form";
// Result panel and runs tables
import { showResult, shown } from "./results";

// 3D viewer: shows the start position, then plays the solution
export const player = new TwistyPlayer({
  puzzle: "3x3x3",
  background: "none",
  controlPanel: "bottom-row",
  colorScheme: "auto",
});
$("player-slot").append(player);

// Push the form into the viewer; returns false if something can't be read
export function syncViewer(): boolean {
  const step = currentMode() === "step";
  // Step options only matter for step solves
  stepOptions.disabled = !step;
  fitPieces();
  renderChips();
  syncPreset();
  // Validate the inputs (step pieces, offsets, solvable-with moves and blindfolded fields only in step mode)
  const scramble = readMoves(scrambleInput, scrambleError);
  const done = readMoves(doneInput, doneError);
  const piecesOk = step ? readPieces() : true;
  const offsets = step ? readOffsets() : [""];
  const solvableWith = step ? readSolvable() : [];
  const bld = step ? readBld() : null;
  if (!step) piecesError.textContent = offsetsError.textContent = solvableError.textContent = bldError.textContent = "";
  showSearchCount(offsets);
  // Update the cube for whatever parsed (mask the caret line's goal in the grip the cube is held in now; untouched steps care about every piece, so the whole cube shows)
  if (scramble !== null && done !== null) player.experimentalSetupAlg = joinMoves(scramble, done);
  if (piecesOk) player.experimentalStickeringMaskOrbits = stickeringMask(step && !bld?.untouched ? currentLineText() : null, scramble ?? "", done ?? "");
  return scramble !== null && done !== null && piecesOk && offsets !== null && solvableWith !== null && (!step || bld !== null);
}

// Form edited by hand: refresh the viewer and drop the outdated result
export function onInputChange(): void {
  syncViewer();
  showResult(null);
}

// Caret moved in the pieces box: the chips, preset and viewer follow that line's alternative (a shown result stays on the cube)
export function onCaretMove(): void {
  if (shown) {
    renderChips();
    syncPreset();
  } else syncViewer();
}
