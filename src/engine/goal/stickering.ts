// Sticker masks for cubing.js's 3D viewer (TwistyPlayer's experimentalStickeringMaskOrbits), so an app can show which pieces a goal is about

// Piece names per type
import { PIECE_NAMES } from "../core/cube";
// Roles a goal gives its pieces
import type { Role } from "../types";
// Goals named for the grip the cube is held in
import { goalOnCube } from "./grips";

// Viewer mask letter for a role: full color (solved, or solved relative to its group), only the orientation sticker, orientation sticker dimmed, dimmed for swap groups,
// or grey for a spot that may change (:x, the same as not listed)
function maskChar(role: Role): string {
  if (role === "free") return "I";
  if (role === "solve" || role.startsWith("relative")) return "-";
  if (role === "place") return "P";
  return role.startsWith("orient") ? "O" : "D";
}

// Viewer mask for the grip after scramble + done: goal pieces drawn by role, the rest grey (pieces = null: the whole cube in full color)
export function stickeringMask(pieces: string | null, scramble: string, done = ""): string {
  const goal = pieces === null ? null : goalOnCube(pieces, scramble, done);
  return Object.entries(PIECE_NAMES)
    .map(([orbit, names]) => {
      // One letter per piece: its role's letter, or "I" when the goal ignores it
      const letters = names.map((_, i) => {
        const role = goal ? goal[orbit]?.[i] : "solve";
        return role ? maskChar(role) : "I";
      });
      return `${orbit}:${letters.join("")}`;
    })
    .join(",");
}
