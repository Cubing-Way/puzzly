// Test bench page: the status line, the busy lock, and small text helpers for both

// Cube engine
import type { TableProgress } from "../engine";
// Page elements
import { statusText, solveButton, randomButton, methodEditor } from "./dom";

// True while the solver or scrambler is working
export let busy = false;

// Show a message in the status line (kind sets its color)
export function setStatus(text: string, kind: "info" | "ok" | "error" = "info"): void {
  statusText.textContent = text;
  statusText.dataset.kind = kind;
}

// Lock the action buttons while the worker is busy
export function setBusy(on: boolean): void {
  busy = on;
  solveButton.disabled = on;
  randomButton.disabled = on;
  // The method can't change while something runs
  methodEditor.disabled = on;
}

// Time as "850 ms" or "1.42 s"
export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

// Count with its word, e.g. "1 grip" or "4 grips"
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

// Follows the search worker's table work during one solve: a note for the live status while a table is built or loaded, and counts for the final status
export function tableTracker() {
  let note = "";
  let built = 0;
  let loaded = 0;
  return {
    // Progress listener for solveStep / runMethod
    onProgress(progress: TableProgress): void {
      if (!progress.finished) note = progress.action === "build" ? " · building tables…" : " · loading stored tables…";
      else {
        note = "";
        if (progress.states && progress.action === "build") built++;
        if (progress.states && progress.action === "load") loaded++;
      }
    },
    // Note for the live status line ("" when no table is being built or loaded)
    note: () => note,
    // Counts for the final status, e.g. ", built 2 tables"
    summary: () => (built ? `, built ${plural(built, "table")}` : "") + (loaded ? `, loaded ${plural(loaded, "stored table")}` : ""),
  };
}
