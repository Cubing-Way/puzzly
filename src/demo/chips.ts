// Test bench page: the piece chips and the preset picker, both following the caret's line of the pieces box

// Cube engine
import { type GoalPiece, parseGoalText, type Role, PIECE_NAMES, roleSuffix, roleFromSuffix } from "../engine";
// Page elements
import { $, roleSelect, presetSelect } from "./dom";
// Reads the step form
import { currentLineText, setCurrentLine } from "./form";
// 3D cube viewer
import { onInputChange } from "./viewer";

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

// Make one chip per edge, corner and center; clicking gives it the picked role
export function buildChips(): void {
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
export function renderChips(): void {
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
export function syncPreset(): void {
  presetSelect.value = presetFor(currentLineText())?.value ?? "";
}

// Name for a goal text in the runs table: its preset's name when it matches one, else the text
export function goalLabel(text: string): string {
  return presetFor(text)?.text ?? text;
}
