// Test bench page: a method step read from the step form, put back into it, and summed up in one line

// Cube engine
import { type StepConfig, splitAlternatives, offsetsToText } from "../engine";
// Page elements
import {
  form,
  stepNameInput,
  piecesInput,
  keepBox,
  anyFrontBox,
  maxDepthInput,
  firstFoundBox,
  lookaheadInput,
  extraMovesInput,
  repeatBox,
  offsetsInput,
  solvableInput,
} from "./dom";
// Reads the step form
import { currentMode, readPieces, readOffsets, readSolvable, readBld, chosenMoves, showBld, showMoves } from "./form";
// Status line and busy state
import { setStatus, plural } from "./status";
// 3D cube viewer
import { onInputChange } from "./viewer";

// A number field's value as a whole number of at least 0 (empty or unreadable = 0)
export function wholeNumber(value: string): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

// Read the step form into a method step (named `Step N` when the name is blank); returns null and shows why when a field can't be read
export function stepFromForm(number: number): StepConfig | null {
  if (currentMode() !== "step") {
    setStatus("Switch Goal to Step to set up a method step.", "error");
    return null;
  }
  // Pieces, offsets, solvable-with moves and blindfolded fields, checked like a step solve
  const piecesOk = readPieces();
  const offsets = readOffsets();
  const solvableWith = readSolvable();
  const bld = readBld();
  const moves = chosenMoves();
  const bottom = [...form.querySelectorAll<HTMLInputElement>('input[name="bottom"]:checked')].map((box) => box.value);
  if (!piecesOk || !offsets || !solvableWith || !bld) setStatus("Fix the marked field first.", "error");
  else if (!moves.length) setStatus("Pick at least one allowed move.", "error");
  else if (!bottom.length) setStatus("Pick at least one bottom face.", "error");
  else {
    return {
      name: stepNameInput.value.trim() || `Step ${number}`,
      // One alternative per line in the form, " | " between them in the method
      pieces: splitAlternatives(piecesInput.value).join(" | "),
      keep: keepBox.checked,
      grips: { bottom, anyFront: anyFrontBox.checked },
      offsets: offsetsToText(offsets),
      solvableWith: solvableWith.join(" "),
      // Blindfolded fields: every other piece untouched, buffer, targets per step, parity pieces
      ...bld,
      moves,
      maxDepth: maxDepthInput.value ? Number(maxDepthInput.value) : null,
      firstFound: firstFoundBox.checked,
      // Lookahead (later steps that judge this step's answers) and extra moves: whole numbers, 0 when empty
      lookahead: wholeNumber(lookaheadInput.value),
      extraMoves: wholeNumber(extraMovesInput.value),
      // Run again until nothing is left to do
      repeat: repeatBox.checked,
    };
  }
  return null;
}

// Put a method step into the form (and the step name / keep fields) for editing
export function stepToForm(step: StepConfig): void {
  (form.elements.namedItem("mode") as RadioNodeList).value = "step";
  // Each alternative on its own line
  piecesInput.value = splitAlternatives(step.pieces).join("\n");
  offsetsInput.value = step.offsets;
  solvableInput.value = step.solvableWith ?? "";
  showBld({ untouched: Boolean(step.untouched), buffer: step.buffer ?? "", targetsPerStep: step.targetsPerStep ?? 2, parity: step.parity ?? "" });
  // Grips and allowed moves as checkboxes
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="bottom"]')) box.checked = step.grips.bottom.includes(box.value);
  anyFrontBox.checked = step.grips.anyFront;
  showMoves(step.moves);
  maxDepthInput.value = step.maxDepth == null ? "" : String(step.maxDepth);
  firstFoundBox.checked = Boolean(step.firstFound);
  stepNameInput.value = step.name;
  keepBox.checked = Boolean(step.keep);
  repeatBox.checked = Boolean(step.repeat);
  lookaheadInput.value = String(step.lookahead ?? 0);
  extraMovesInput.value = String(step.extraMoves ?? 0);
  onInputChange();
}

// One-line summary of a step's settings for the step list
export function stepSummary(step: StepConfig): string {
  return [
    step.buffer ? `BLD from ${step.buffer}, ${plural(step.targetsPerStep ?? 2, "target")} per step` : step.pieces || "no new pieces",
    step.keep ? "+ earlier pieces" : "",
    step.untouched && !step.buffer ? "rest untouched" : "",
    step.parity ? `parity ${step.parity}` : "",
    `bottom ${step.grips.bottom.join("/")}${step.grips.anyFront ? " any front" : ""}`,
    step.offsets ? `offsets ${step.offsets}` : "",
    step.solvableWith ? `solvable with ${step.solvableWith}` : "",
    `moves ${step.moves.join(" ")}`,
    step.maxDepth == null ? "" : `max ${step.maxDepth}`,
    step.firstFound ? "first answer" : "",
    step.lookahead ? `lookahead ${step.lookahead}${step.extraMoves ? ` (+${step.extraMoves} moves)` : ""}` : "",
    step.repeat ? "repeat until done" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
