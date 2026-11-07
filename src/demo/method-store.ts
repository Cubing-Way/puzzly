// Method storage for the test page: examples shipped as JSON, methods saved in this browser, and .json files, each for the puzzle picked now

// Example methods of the 3x3x3 (plain data, no method code; written without a puzzle)
import examples3x3x3 from "./example-methods.json";
// Example methods of the 2x2x2 (each says "puzzle": "2x2x2")
import examples2x2x2 from "./example-methods-2x2x2.json";
// Checks and cleans up method data, the puzzle picked now, and the one a method without a puzzle is for
import { readMethod, activePuzzle, DEFAULT_PUZZLE, type Method } from "../engine";

// Every example method of every puzzle, in the order the picker lists them (a method without a puzzle is the 3x3x3's)
const EXAMPLES: { puzzle?: string }[] = [...examples3x3x3, ...examples2x2x2];

// localStorage key for a puzzle's saved methods (an object of name → method): the 3x3x3's keep the key they had before puzzles, every other puzzle gets its own
function storageKey(id: string): string {
  return id === DEFAULT_PUZZLE.id ? "puzzly.methods" : `puzzly.methods.${id}`;
}

// The picked puzzle's example methods shipped with the page, checked like any loaded file (call after loadEngine)
export function exampleMethods(): Method[] {
  return EXAMPLES.filter((data) => (data.puzzle ?? DEFAULT_PUZZLE.id) === activePuzzle.id).map((data) => readMethod(data));
}

// A puzzle's saved methods by name (empty when storage is blocked or holds something unreadable)
function readSaved(id = activePuzzle.id): Record<string, unknown> {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey(id)) ?? "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// The picked puzzle's methods saved in this browser, sorted by name (unreadable entries are skipped)
export function savedMethods(): Method[] {
  return Object.values(readSaved())
    .flatMap((data) => {
      try {
        return [readMethod(data)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Save a method in this browser under its name, with its puzzle's methods, replacing one with the same name (throws when storage is blocked or full)
export function saveMethod(method: Method): void {
  const id = method.puzzle ?? DEFAULT_PUZZLE.id;
  localStorage.setItem(storageKey(id), JSON.stringify({ ...readSaved(id), [method.name]: method }));
}

// Remove one of the picked puzzle's saved methods by name (does nothing when storage is blocked)
export function deleteSavedMethod(name: string): void {
  const saved = readSaved();
  delete saved[name];
  try {
    localStorage.setItem(storageKey(activePuzzle.id), JSON.stringify(saved));
  } catch {
    // Storage blocked: nothing was saved there anyway
  }
}

// Method as file text: the same JSON a saved method and the examples use
export function methodJson(method: Method): string {
  return `${JSON.stringify(method, null, 2)}\n`;
}

// Download a method as a .json file named after it
export function downloadMethod(method: Method): void {
  const url = URL.createObjectURL(new Blob([methodJson(method)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  // File name from the method name, e.g. "CFOP (cross + 4 pairs)" → "cfop-cross-4-pairs.json"
  link.download = `${method.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "method"}.json`;
  link.click();
  // Free the file once the download has started
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Read a method from a chosen .json file; throws a clear error on bad JSON, a bad field, or a method for another puzzle than the picked one
export async function readMethodFile(file: File): Promise<Method> {
  return readMethod(JSON.parse(await file.text()));
}
