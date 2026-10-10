// Test bench page: its elements, looked up once by id

// Find a page element by id
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// Page elements
export const form = $<HTMLFormElement>("solve-form");
export const scrambleInput = $<HTMLTextAreaElement>("scramble-input");
export const scrambleError = $("scramble-error");
export const doneInput = $<HTMLInputElement>("done-input");
export const doneError = $("done-error");
export const randomButton = $<HTMLButtonElement>("random-button");
export const clearButton = $<HTMLButtonElement>("clear-button");
export const stepOptions = $<HTMLFieldSetElement>("step-options");
export const presetSelect = $<HTMLSelectElement>("preset-select");
export const piecesInput = $<HTMLTextAreaElement>("pieces-input");
export const piecesError = $("pieces-error");
export const addAlternativeButton = $<HTMLButtonElement>("add-alternative");
export const roleSelect = $<HTMLSelectElement>("role-select");
export const anyFrontBox = $<HTMLInputElement>("any-front");
export const offsetsInput = $<HTMLInputElement>("offsets-input");
export const offsetsError = $("offsets-error");
export const solvableInput = $<HTMLInputElement>("solvable-input");
export const solvableError = $("solvable-error");
export const untouchedBox = $<HTMLInputElement>("untouched-box");
export const bufferInput = $<HTMLInputElement>("buffer-input");
export const perStepInput = $<HTMLInputElement>("per-step-input");
export const parityInput = $<HTMLInputElement>("parity-input");
export const bldError = $("bld-error");
export const searchCount = $("search-count");
export const maxDepthInput = $<HTMLInputElement>("max-depth");
export const firstFoundBox = $<HTMLInputElement>("first-found");
export const solveButton = $<HTMLButtonElement>("solve-button");
export const statusText = $("status");
export const solutionText = $("solution");
export const movesStat = $("moves-stat");
export const timeStat = $("time-stat");
export const checkStat = $("check-stat");
export const offsetStat = $("offset-stat");
export const alternativeStat = $("alternative-stat");
export const continueButton = $<HTMLButtonElement>("continue-button");
export const copyButton = $<HTMLButtonElement>("copy-button");
export const runsBody = $("runs-body");
export const runsEmpty = $("runs-empty");
export const methodEditor = $<HTMLFieldSetElement>("method-editor");
export const methodSelect = $<HTMLSelectElement>("method-select");
export const methodNameInput = $<HTMLInputElement>("method-name");
export const saveMethodButton = $<HTMLButtonElement>("save-method");
export const deleteMethodButton = $<HTMLButtonElement>("delete-method");
export const exportMethodButton = $<HTMLButtonElement>("export-method");
export const importMethodButton = $<HTMLButtonElement>("import-method");
export const methodFileInput = $<HTMLInputElement>("method-file");
export const stepList = $("step-list");
export const stepsEmpty = $("steps-empty");
export const stepNameInput = $<HTMLInputElement>("step-name");
export const keepBox = $<HTMLInputElement>("step-keep");
export const repeatBox = $<HTMLInputElement>("step-repeat");
export const lookaheadInput = $<HTMLInputElement>("step-lookahead");
export const extraMovesInput = $<HTMLInputElement>("step-extra");
export const addStepButton = $<HTMLButtonElement>("add-step");
export const updateStepButton = $<HTMLButtonElement>("update-step");
export const runMethodButton = $<HTMLButtonElement>("run-method");
export const searchMethodButton = $<HTMLButtonElement>("search-method");
export const searchSecondsInput = $<HTMLInputElement>("search-seconds");
export const stopSearchButton = $<HTMLButtonElement>("stop-search");
export const methodBody = $("method-body");
export const methodEmpty = $("method-empty");
