// Test bench page: the method editor (its step list, and loading, saving, importing and exporting methods)

// Cube engine
import type { Method } from "../engine";
// Page elements
import {
  stepsEmpty,
  stepList,
  updateStepButton,
  stepNameInput,
  methodSelect,
  methodNameInput,
  deleteMethodButton,
  keepBox,
  repeatBox,
  lookaheadInput,
  extraMovesInput,
  addStepButton,
  saveMethodButton,
  exportMethodButton,
  importMethodButton,
  methodFileInput,
} from "./dom";
// Example, saved and file methods
import { savedMethods, exampleMethods, saveMethod, deleteSavedMethod, downloadMethod, readMethodFile } from "./method-store";
// Result panel and runs tables
import { setMethodRows, renderMethodRows } from "./results";
// Status line and busy state
import { setStatus } from "./status";
// Method steps to and from the form
import { stepSummary, stepToForm, stepFromForm } from "./step-form";

// Example methods (filled in once the engine is loaded)
let examples: Method[] = [];
// Method being edited: steps run in order
export let method: Method = { name: "", steps: [] };
// Step loaded into the form for editing (-1 = none)
let editing = -1;
// True when the method has changes that aren't saved
let dirty = false;

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
  setMethodRows([]);
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
  repeatBox.checked = false;
  lookaheadInput.value = "0";
  extraMovesInput.value = "0";
  methodChanged();
  dirty = false;
  syncDeleteButton();
}

// The method as it stands, with the name from its field
export function currentMethod(): Method {
  return { ...method, name: methodNameInput.value.trim() || "Untitled method" };
}

// Load the example methods (checked like any method file, so the engine must be loaded), fill the picker and open the first one
export function showExamples(): void {
  examples = exampleMethods();
  fillMethodSelect();
  loadMethod(examples[0]);
}

// Wire the method editor's buttons, name field, picker and file input
export function wireMethodEditor(): void {
  // Buttons under the step list
  addStepButton.addEventListener("click", addStep);
  updateStepButton.addEventListener("click", updateStep);

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
}
