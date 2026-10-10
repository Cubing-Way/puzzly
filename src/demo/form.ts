// Test bench page: reading the step form's fields (moves, pieces, offsets, solvable-with moves, blindfolded fields, grips and allowed moves), with their error lines

// Cube engine
import { parseMoves, readAlternatives, offsetsFromText, solvableFromText, bufferFromText, parityFromText, splitAlternatives, gripRotations } from "../engine";
// Page elements
import {
  form,
  piecesInput,
  keepBox,
  bufferInput,
  piecesError,
  offsetsInput,
  offsetsError,
  solvableInput,
  solvableError,
  parityInput,
  perStepInput,
  untouchedBox,
  bldError,
  anyFrontBox,
  searchCount,
} from "./dom";
// Status line and busy state
import { plural } from "./status";

// Blindfolded fields of a step: every other piece untouched, the buffer ("" = none), targets per step and parity pieces
export interface Bld {
  untouched: boolean;
  buffer: string;
  targetsPerStep: number;
  parity: string;
}

// Goal mode picked in the form
export function currentMode(): "step" | "full" {
  return (form.elements.namedItem("mode") as RadioNodeList).value as "step" | "full";
}

// Read a moves field; returns the moves cleaned up, or null and shows why under the field
export function readMoves(input: HTMLTextAreaElement | HTMLInputElement, error: HTMLElement): string | null {
  try {
    const moves = parseMoves(input.value);
    error.textContent = "";
    return moves;
  } catch (problem) {
    error.textContent = (problem as Error).message;
    return null;
  }
}

// Check the goal pieces, one alternative per line; returns false and shows why on a typo or an empty goal (empty is fine for a step that keeps earlier pieces, or has a buffer)
export function readPieces(): boolean {
  try {
    readAlternatives(piecesInput.value, !keepBox.checked && !bufferInput.value.trim());
    piecesError.textContent = "";
  } catch (error) {
    piecesError.textContent = (error as Error).message;
  }
  return piecesError.textContent === "";
}

// Number of the pieces line the caret is on (the chips, preset and viewer follow that alternative)
export function currentLine(): number {
  return piecesInput.value.slice(0, piecesInput.selectionStart).split("\n").length - 1;
}

// Goal text on the caret's line
export function currentLineText(): string {
  return piecesInput.value.split("\n")[currentLine()] ?? "";
}

// Put new goal text on the caret's line, leaving the caret at that line's end
export function setCurrentLine(text: string): void {
  const lines = piecesInput.value.split("\n");
  const at = currentLine();
  lines[at] = text;
  piecesInput.value = lines.join("\n");
  const end = lines.slice(0, at + 1).join("\n").length;
  piecesInput.setSelectionRange(end, end);
}

// Grow the pieces box to show every line (one line per alternative)
export function fitPieces(): void {
  piecesInput.rows = Math.max(1, piecesInput.value.split("\n").length);
}

// Read the offsets field; returns the offsets (no offset first), or null and shows why under the field
export function readOffsets(): string[] | null {
  try {
    const offsets = offsetsFromText(offsetsInput.value);
    offsetsError.textContent = "";
    return offsets;
  } catch (problem) {
    offsetsError.textContent = (problem as Error).message;
    return null;
  }
}

// Read the solvable-with field; returns its moves ([] = none), or null and shows why under the field
export function readSolvable(): string[] | null {
  try {
    const moves = solvableFromText(solvableInput.value);
    solvableError.textContent = "";
    return moves;
  } catch (problem) {
    solvableError.textContent = (problem as Error).message;
    return null;
  }
}

// Read the blindfolded fields; returns them (buffer and parity pieces cleaned up, untouched always on with a buffer), or null and shows why under them
export function readBld(): Bld | null {
  try {
    const buffer = bufferFromText(bufferInput.value);
    const parity = parityFromText(parityInput.value);
    const targetsPerStep = Math.max(1, Math.floor(Number(perStepInput.value) || 2));
    const untouched = untouchedBox.checked || Boolean(buffer);
    // A buffer step picks its own pieces; untouched steps take no offsets or solvable-with moves
    if (buffer && splitAlternatives(piecesInput.value).some(Boolean)) throw new Error("A step with a buffer picks its own pieces (the buffer's next targets): leave Pieces empty.");
    if (untouched && (offsetsInput.value.trim() || solvableInput.value.trim())) throw new Error("A step that keeps every other piece untouched can't have offsets or solvable-with moves.");
    bldError.textContent = "";
    return { untouched, buffer, targetsPerStep, parity };
  } catch (problem) {
    bldError.textContent = (problem as Error).message;
    return null;
  }
}

// Put blindfolded fields into the form
export function showBld(bld: Bld): void {
  untouchedBox.checked = bld.untouched;
  bufferInput.value = bld.buffer;
  perStepInput.value = String(bld.targetsPerStep);
  parityInput.value = bld.parity;
}

// Grips the step search may use, from the bottom-face boxes and the any-front switch
export function chosenGrips(): string[] {
  const bottoms = [...form.querySelectorAll<HTMLInputElement>('input[name="bottom"]:checked')].map((box) => box.value);
  return gripRotations(bottoms, anyFrontBox.checked);
}

// Moves the step search may use, from the move boxes: a letter allows every turn of that layer, its 2 box only the half turn (dropped when the letter is ticked too)
export function chosenMoves(): string[] {
  const ticked = [...form.querySelectorAll<HTMLInputElement>('input[name="move"]:checked')].map((box) => box.value);
  return ticked.filter((move) => !(move.endsWith("2") && ticked.includes(move.slice(0, -1))));
}

// Tick the move boxes for these moves (R and R' tick R's box, R2 and R2' its 2 box)
export function showMoves(moves: string[]): void {
  const boxes = new Set(moves.map((move) => move.replace(/'$/, "")));
  for (const box of form.querySelectorAll<HTMLInputElement>('input[name="move"]')) box.checked = boxes.has(box.value);
}

// Show how many searches a step solve may run: alternatives × grips × offsets (null = offsets unreadable, so no count)
export function showSearchCount(offsets: string[] | null): void {
  const grips = chosenGrips().length;
  const alternatives = splitAlternatives(piecesInput.value).length;
  // Alternatives are only mentioned when there are several
  const each = alternatives > 1 ? `${plural(alternatives, "alternative")} × ` : "";
  // One search per alternative × grip covers every offset (they share one table)
  const allOffsets = offsets && offsets.length > 1 ? `, each covering all ${offsets.length} offsets (counting none)` : "";
  // Untouched steps search each way the goal can end instead (every cycle-break choice, free twists, parity)
  const untouched = untouchedBox.checked || bufferInput.value.trim();
  searchCount.textContent = !offsets
    ? ""
    : untouched
      ? `Every way the goal can end (with a buffer: each cycle-break choice) is measured in ${plural(grips, "grip")}, then searched closest first; repeats and ones that can't beat the best are skipped.`
      : `Up to ${plural(alternatives * grips, "search", "searches")}: ${each}${plural(grips, "grip")}${allOffsets}. Repeats, and grips whose distance can't beat the best, are skipped.`;
}

// Offsets or grips edited: check the offsets and update the search count (the shown result stays)
export function onSearchChange(): void {
  showSearchCount(readOffsets());
}
