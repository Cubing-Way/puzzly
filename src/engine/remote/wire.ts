// The engine's calls and results as JSON, between the solve server (server/handler.ts) and the apps calling it (client.ts): each Alg as its text under
// ALG_TEXT, as batch mode sends them, and what JSON can't hold (Infinity, NaN, undefined in a list) as text under WIRE_VALUE; callbacks are left out

// Alg, the type a step's solution comes in
import { Alg } from "cubing/alg";
// Key an Alg's text goes under (the same as batch mode's)
import { ALG_TEXT } from "../worker/protocol";

// Key a value JSON can't hold goes under, as its text
const WIRE_VALUE = "$value";

// A call's arguments or result as plain JSON data
export function toWire(value: unknown): unknown {
  if (value instanceof Alg) return { [ALG_TEXT]: value.toString() };
  if (typeof value === "number" && !Number.isFinite(value)) return { [WIRE_VALUE]: String(value) };
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? { [WIRE_VALUE]: "undefined" } : toWire(item)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== undefined && typeof field !== "function")
        .map(([key, field]) => [key, toWire(field)]),
    );
  return value;
}

// The arguments or result again, Algs as Algs
export function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (!value || typeof value !== "object") return value;
  if (ALG_TEXT in value) return new Alg((value as Record<string, string>)[ALG_TEXT]);
  if (WIRE_VALUE in value) {
    const text = (value as Record<string, string>)[WIRE_VALUE];
    return text === "undefined" ? undefined : Number(text);
  }
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, fromWire(field)]));
}
