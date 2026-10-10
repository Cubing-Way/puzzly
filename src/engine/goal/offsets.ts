// Offsets: moves the cube may still be off by when a goal counts (a pseudo-cross's D turn, AUF): reading their text, and grouping the ones that share a table

// Parses alg text into moves
import { Alg } from "cubing/alg";
// Lookup caches
import { remember } from "../core/cache";
// Move text helpers
import { rotationsIn } from "../core/moves";
// Loaded cube definition and held cubes
import { parseMoves } from "../core/puzzle";

// Offsets in groups searched together: the ones the allowed moves can make (each move allowed, or a power of an allowed quarter turn) share one table with no offset,
// any other offset (e.g. D when only U R are allowed) gets its own group, since its target differs on spots the moves never touch
export function offsetGroups(offsets: string[], moves: string[]): string[][] {
  return remember(offsetGroupsMade, `${offsets.join(",")}/${moves.join(" ")}`, () => groupOffsets(offsets, moves));
}

// Offset groups already worked out, by offsets and moves
const offsetGroupsMade = new Map<string, string[][]>();

// Work out offsetGroups' answer
function groupOffsets(offsets: string[], moves: string[]): string[][] {
  const leaves = (text: string) => Array.from(new Alg(text).experimentalLeafMoves());
  // Faces the allowed moves turn by a quarter (every power of those is allowed too), and the exact allowed moves
  const quarter = new Set(moves.flatMap(leaves).filter((move) => Math.abs(move.amount) === 1).map((move) => move.family));
  const exact = new Set(moves.flatMap(leaves).map((move) => move.toString()));
  const shared: string[] = [];
  const alone: string[][] = [];
  for (const offset of offsets) {
    if (leaves(offset).every((move) => quarter.has(move.family) || exact.has(move.toString()))) shared.push(offset);
    else alone.push([offset]);
  }
  return shared.length ? [shared, ...alone] : alone;
}

// Read offset text into a step's offsets list, no offset first: spaces split one-move offsets ("D D2 D'"),
// commas split offsets of several moves ("U, U D"); throws a clear error on a bad move or a whole-cube turn
export function offsetsFromText(text: string): string[] {
  const offsets = [""];
  for (const part of text.split(text.includes(",") ? "," : /\s+/)) {
    // Clean up the moves (throws on moves the 3x3x3 doesn't have)
    const offset = parseMoves(part);
    // Whole-cube turns are grips, not offsets
    if (rotationsIn(offset)) throw new Error(`Offset "${offset}" turns the whole cube: use Bottom face / any front for grips.`);
    // Keep each offset once
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  return offsets;
}

// Offsets back as text (no offset left out; commas only when an offset has several moves)
export function offsetsToText(offsets: string[]): string {
  const typed = offsets.filter(Boolean);
  return typed.join(typed.some((offset) => offset.includes(" ")) ? ", " : " ");
}
