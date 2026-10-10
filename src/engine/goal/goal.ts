// Goals: roles and their suffixes, goal text and its alternatives, merging goals, and hiding what a goal doesn't check

// Cube patterns
import { KPattern } from "cubing/kpuzzle";
// Piece names and grips
import { PIECE_NAMES, normalizeName, ORBIT_BY_LENGTH } from "../core/cube";
// Engine data shapes
import type { Role, GoalPiece, Goal } from "../types";

// Group role for each suffix letter: oriented, swap group, relative group
const GROUP_ROLES: Record<string, string> = { o: "orient", s: "swap", r: "relative" };

// Read a role suffix: "" = solve, ":p" = place, ":x" = free, ":o" / ":o2"… = oriented in group 1 / 2…, ":s" / ":s2"… = swap group, ":r" / ":r2"… = relative group (null if it isn't one)
export function roleFromSuffix(suffix: string): Role | null {
  const tag = suffix.toLowerCase();
  if (tag === "") return "solve";
  if (tag === ":p") return "place";
  if (tag === ":x") return "free";
  // Group roles: letter, then an optional group number (1 when left out)
  const group = /^:([osr])([1-9]\d*)?$/.exec(tag);
  if (!group) return null;
  return `${GROUP_ROLES[group[1]]}${Number(group[2] ?? 1)}` as Role;
}

// Suffix that writes a role in goal text ("" for solve, ":o" for group 1, ":o2" for group 2, ":r" for relative group 1…)
export function roleSuffix(role: Role): string {
  if (role === "solve") return "";
  if (role === "place") return ":p";
  if (role === "free") return ":x";
  // Group roles: first letter, plus the group number unless it's 1
  const group = role.replace(/^\D+/, "");
  return `:${role[0]}${group === "1" ? "" : group}`;
}

// True for roles whose pieces share one id per group (orient and swap groups; relative pieces keep their own ids)
function isGroupRole(role: Role): boolean {
  return role.startsWith("orient") || role.startsWith("swap");
}

// Group number of a relative role (0 for any other role)
export function relativeGroup(role: Role): number {
  return role.startsWith("relative") ? Number(role.slice("relative".length)) : 0;
}

// Piece number by name with its letters sorted, per piece type (so "RFU" finds UFR), made once
const PIECE_INDEX: Record<string, Map<string, number>> = Object.fromEntries(
  Object.entries(PIECE_NAMES).map(([orbit, names]) => [orbit, new Map(names.map((name, index) => [normalizeName(name), index]))]),
);

// Read goal text like "DF DR UF:o FR:o2 UFR:p L" into pieces with roles; throws a clear error on a typo
export function parseGoalText(text: string): GoalPiece[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((word) => {
      // Split the piece name from its optional role suffix
      const [name, ...suffix] = word.split(":");
      const role = roleFromSuffix(suffix.length ? `:${suffix.join(":")}` : "");
      // Pick the piece type from the name's length
      const orbit = ORBIT_BY_LENGTH[name.length];
      // Find the piece's number in that type's list
      const index = orbit ? (PIECE_INDEX[orbit]?.get(normalizeName(name)) ?? -1) : -1;
      // Stop with a clear message on a typo
      if (!orbit || index === -1) throw new Error(`Unknown piece: "${name}"`);
      if (!role) throw new Error(`Unknown role in "${word}" (use :o, :o2…, :s, :s2…, :r, :r2…, :p or :x)`);
      return { orbit, index, role };
    });
}

// Split goal text into its alternatives ("|" or a new line between them; blank ones are dropped, so no text at all = one empty goal)
export function splitAlternatives(text: string): string[] {
  const alternatives = text.split(/[|\n]/).map((part) => part.trim()).filter(Boolean);
  return alternatives.length ? alternatives : [""];
}

// Split goal text into its alternatives and check each one; throws a clear error on a typo (naming the alternative when there are several),
// or on an empty goal when needPieces is set (a step that doesn't keep earlier pieces needs some of its own)
export function readAlternatives(text: string, needPieces = false): string[] {
  const alternatives = splitAlternatives(text);
  alternatives.forEach((alternative, index) => {
    try {
      if (!parseGoalText(alternative).length && needPieces) throw new Error("Pick at least one piece, or keep earlier steps' pieces.");
    } catch (error) {
      throw new Error(alternatives.length > 1 ? `Alternative ${index + 1}: ${(error as Error).message}` : (error as Error).message);
    }
  });
  return alternatives;
}

// All six centers kept solved (a goal's centers when its text names none)
export function allCenters(): Record<number, Role> {
  return Object.fromEntries(PIECE_NAMES.CENTERS.map((_, index) => [index, "solve" as Role]));
}

// Turn goal text into the per-piece roles that maskPattern expects (defaultCenters = false leaves centers out when none is typed)
export function goalFromText(text: string, defaultCenters = true): Goal {
  const goal: Goal = {};
  // Add each typed piece with its role (a piece typed twice keeps its last role)
  for (const { orbit, index, role } of parseGoalText(text)) (goal[orbit] ??= {})[index] = role;
  // No center typed: keep all six, so slice moves can't move them
  if (defaultCenters) goal.CENTERS ??= allCenters();
  return goal;
}

// Write a goal back as goal text in piece-list order (all six solved centers are left out, since that's what no center means)
export function goalToText(goal: Goal): string {
  const centers = Object.values(goal.CENTERS ?? {});
  const allSix = centers.length === PIECE_NAMES.CENTERS.length && centers.every((role) => role === "solve");
  return Object.entries(PIECE_NAMES)
    .filter(([orbit]) => !(orbit === "CENTERS" && allSix))
    .flatMap(([orbit, names]) => names.flatMap((name, index) => (goal[orbit]?.[index] ? [name + roleSuffix(goal[orbit][index])] : [])))
    .join(" ");
}

// True when a kept role already asks at least as much as a step's role (solved covers every role, in place covers swap groups, any relative group covers a relative role)
export function covers(kept: Role | undefined, role: Role): boolean {
  return kept === role || kept === "solve" || (kept === "place" && role.startsWith("swap")) || (relativeGroup(role) > 0 && relativeGroup(kept ?? "solve") > 0);
}

// Combine two goals into a new one; `over`'s role wins for a piece in both. Relative groups stay apart: `base`'s are renumbered past `over`'s
// (a pair joined anywhere earlier and one joined now each keep their own group, rather than having to sit together)
export function mergeGoals(base: Goal, over: Goal): Goal {
  // Highest relative group number in `over` (0 = none)
  let shift = 0;
  for (const roles of Object.values(over)) for (const role of Object.values(roles)) shift = Math.max(shift, relativeGroup(role));
  const merged: Goal = {};
  // Base roles first (its relative groups moved up past over's), then over's on top
  for (const [orbit, roles] of Object.entries(base)) {
    const copy: Record<number, Role> = (merged[orbit] = { ...roles });
    if (shift) for (const [piece, role] of Object.entries(roles)) if (relativeGroup(role)) copy[Number(piece)] = `relative${relativeGroup(role) + shift}`;
  }
  for (const [orbit, roles] of Object.entries(over)) Object.assign((merged[orbit] ??= {}), roles);
  return merged;
}

// The goal without its :x pieces (outside untouched steps, a spot that may change is the same as a piece the goal doesn't list)
export function dropFree(goal: Goal): Goal {
  // Nothing to drop: the goal as it is (callers only read it)
  if (!Object.values(goal).some((roles) => Object.values(roles).includes("free"))) return goal;
  const kept: Goal = {};
  for (const [orbit, roles] of Object.entries(goal)) {
    kept[orbit] = Object.fromEntries(Object.entries(roles).filter(([, role]) => role !== "free"));
  }
  return kept;
}

// Hide what the goal doesn't check: each orient / swap group (and the ignored pieces) shares one id, place / swap / ignored pieces may be turned any way
// (relative pieces stay as they are, like solved ones: goalTargets puts their groups where they may sit)
export function maskPattern(pattern: KPattern, goal: Goal): KPattern {
  // Copy the data so the original pattern isn't changed (array copies: much faster than structuredClone, which a method search does thousands of times)
  const data: KPattern["patternData"] = {};
  for (const [orbitName, { pieces, orientation, orientationMod }] of Object.entries(pattern.patternData)) {
    data[orbitName] = { pieces: [...pieces], orientation: [...orientation], ...(orientationMod ? { orientationMod: [...orientationMod] } : {}) };
  }
  // :x pieces count as ignored
  const listed = dropFree(goal);
  // Go through each piece type: EDGES, CORNERS, CENTERS
  for (const [orbitName, orbit] of Object.entries(data)) {
    // Role of each goal piece of this type (not listed = ignored)
    const roles = listed[orbitName] ?? {};
    // Shared id per group and for ignored pieces: the first piece number with that role,
    // picked from the goal (not from where pieces sit) so start and target agree, and never the same for two groups
    const sharedIds = new Map<string, number>();
    orbit.pieces.forEach((_, id) => {
      const group = roles[id] ?? "ignored";
      if ((group === "ignored" || isGroupRole(group)) && !sharedIds.has(group)) sharedIds.set(group, id);
    });
    // Per-piece orientation rule (0 = matters, 1 = ignored), starting from the puzzle's own rules
    const mods = orbit.orientationMod ?? orbit.pieces.map(() => 0);
    orbit.orientationMod = mods;
    // Rewrite each spot based on the role of the piece sitting there
    orbit.pieces.forEach((piece, i) => {
      const role = roles[piece];
      // Group and ignored pieces become interchangeable with the rest of their group
      if (!role || isGroupRole(role)) orbit.pieces[i] = sharedIds.get(role ?? "ignored")!;
      // Place, swap and ignored pieces may be turned any way
      if (!role || role === "place" || role.startsWith("swap")) {
        orbit.orientation[i] = 0;
        mods[i] = 1;
      }
    });
  }
  // Turn the data back into a pattern
  return new KPattern(pattern.kpuzzle, data);
}
