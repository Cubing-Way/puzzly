// Method storage for the test page: examples shipped as JSON, methods saved in this browser, and .json files

// Example methods (plain data, no method code)
import examples from "./example-methods.json";
// Checks and cleans up method data
import { readMethod, type Method } from "../engine";

// localStorage key for the saved methods (an object of name → method)
const STORAGE_KEY = "puzzly.methods";

// Example methods shipped with the page, checked like any loaded file (call after loadEngine)
export function exampleMethods(): Method[] {
  return examples.map((data) => readMethod(data));
}

// Saved methods by name (empty when storage is blocked or holds something unreadable)
function readSaved(): Record<string, unknown> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// Methods saved in this browser, sorted by name (unreadable entries are skipped)
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

// Save a method in this browser under its name, replacing one with the same name (throws when storage is blocked or full)
export function saveMethod(method: Method): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readSaved(), [method.name]: method }));
}

// Remove a saved method by name (does nothing when storage is blocked)
export function deleteSavedMethod(name: string): void {
  const saved = readSaved();
  delete saved[name];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
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

// Read a method from a chosen .json file; throws a clear error on bad JSON or a bad field
export async function readMethodFile(file: File): Promise<Method> {
  return readMethod(JSON.parse(await file.text()));
}
