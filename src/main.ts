// Scrambles
import { randomScrambleForEvent } from "cubing/scramble";
// Optional: parse alg strings into moves
import { Alg } from "cubing/alg";
// Optional, later: puzzle model and solver
import { cube3x3x3 } from "cubing/puzzles";
// Partial-goal solver
import { experimentalSolveTwips } from "cubing/search";
// Lets us build a modified pattern
import { KPattern } from "cubing/kpuzzle";
import { experimentalSolve3x3x3IgnoringCenters } from "cubing/search";

const scramble = (await randomScrambleForEvent("333")).toString();

// Rebuild cubing.js's state from your move history, solve it, and feed the result back to your own engine
const kpuzzle = await cube3x3x3.kpuzzle();

// Piece names in cubing.js's order: the position in each list is the piece number
const PIECE_NAMES: Record<string, string[]> = {
  EDGES: ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"],
  CORNERS: ["UFR", "UBR", "UBL", "UFL", "DFR", "DFL", "DBL", "DBR"],
  CENTERS: ["U", "L", "F", "R", "B", "D"],
};

// Piece type for each name length: 1 letter = center, 2 = edge, 3 = corner
const ORBIT_BY_LENGTH: Record<number, string> = { 1: "CENTERS", 2: "EDGES", 3: "CORNERS" };

// Sort a name's letters so "UR", "RU" and "ur" all mean the same piece
function normalizeName(name: string): string {
  return name.toUpperCase().split("").sort().join("");
}

// Turn names like "DF DR DB DL" into the keep list that maskPattern expects
function keepFromNames(names: string): Record<string, number[]> {
  // Always keep every center so slice moves can't move them
  const keep: Record<string, number[]> = { CENTERS: [0, 1, 2, 3, 4, 5] };
  // Go through each name (separated by spaces or commas)
  for (const name of names.split(/[\s,]+/).filter(Boolean)) {
    // Pick the piece type from the name's length
    const orbit = ORBIT_BY_LENGTH[name.length];
    const list = orbit ? PIECE_NAMES[orbit] : undefined;
    // Find the piece's number in that type's list
    const index = list ? list.findIndex((n) => normalizeName(n) === normalizeName(name)) : -1;
    // Stop with a clear message on a typo
    if (!orbit || index === -1) throw new Error(`Unknown piece: "${name}"`);
    // Add the number, skipping duplicates
    const numbers = (keep[orbit] ??= []);
    if (!numbers.includes(index)) numbers.push(index);
  }
  return keep;
}

// Hide the pieces you don't care about: one shared id for all of them, orientation ignored
function maskPattern(pattern: KPattern, keep: Record<string, number[]>): KPattern {
  // Copy the data so the original pattern isn't changed
  const data = structuredClone(pattern.patternData);
  // Go through each piece type: EDGES, CORNERS, CENTERS
  for (const [orbitName, orbit] of Object.entries(data)) {
    // Pieces to keep for this type (not listed = hide them all)
    const care = keep[orbitName] ?? [];
    // Shared id for hidden pieces: the first id not being kept
    let filler = 0;
    while (care.includes(filler)) filler++;
    // Per-piece orientation rule (0 = matters, 1 = ignored), starting from the puzzle's own rules
    const mods = orbit.orientationMod ?? orbit.pieces.map(() => 0);
    orbit.orientationMod = mods;
    // Hide every piece that isn't in the keep list
    orbit.pieces.forEach((piece, i) => {
      if (!care.includes(piece)) {
        orbit.pieces[i] = filler;
        orbit.orientation[i] = 0;
        mods[i] = 1;
      }
    });
  }
  // Turn the data back into a pattern
  return new KPattern(kpuzzle, data);
}
// Cross = the 4 bottom edges (DF, DR, DB, DL); centers stay as they are
const crossKeep = keepFromNames("DF DR DB DL");

// Start = scrambled cube, target = solved cube, both with the same pieces hidden
const start = maskPattern(kpuzzle.defaultPattern().applyAlg(scramble), crossKeep);
const target = maskPattern(kpuzzle.defaultPattern(), crossKeep);

// Search with face turns only
const crossSolution = await experimentalSolveTwips(kpuzzle, start, { 
  targetPattern: target, 
  generatorMoves: ["U", "R", "F", "D", "L", "B"],
});

console.log(scramble);

console.log(crossSolution.toString());

