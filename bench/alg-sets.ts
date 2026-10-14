// Alg sets against the cube (bench/out/alg-sets.js): every last-layer state is made, and each set's step is asked to recognise it.
// Says, per set, which algs don't end held as they started, which are filed under the wrong case, which cases share a state, and which states no alg fits
// Usage: node bench/out/alg-sets.js [sets: OLL,PLL by default]
import { cube3x3x3 } from "cubing/puzzles";
import type { KPattern } from "cubing/kpuzzle";
import { loadEngine, algCandidates, ALG_SETS, toFaces, goalFromText, type StepResult } from "../src/engine/index.ts";
import { inverse } from "./faces";

await loadEngine({});
const kpuzzle = await cube3x3x3.kpuzzle();
const [which = "OLL,PLL"] = process.argv.slice(2);

// Goals: the first two layers (kept), and each set's own pieces
const F2L = "DF DR DB DL DFR FR DFL FL DBR BR DBL BL";
const PIECES: Record<string, string> = { OLL: "UF:o UR:o UB:o UL:o UFR:o UBR:o UBL:o UFL:o", PLL: "UF UR UB UL UFR UBR UBL UFL" };
const keep = goalFromText(F2L);
// What a set's step makes of a cube given as the moves that set it up: the algs that fit, fastest first
const recognise = (set: string, setup: string): StepResult[] => algCandidates(setup, PIECES[set], { keep, earlier: keep, algs: set, rank: "speed" });
// A result's alg as the hands make it
const handsOf = (result: StepResult) => result.wide ?? result.solution.toString();
// An alg as the engine writes it (Rw for r)
const engineText = (alg: string) => alg.replace(/\b([rludfb])(?=[2']?(\s|$))/g, (letter) => `${letter.toUpperCase()}w`);

// Every state of the last layer with the first two layers solved, each with moves that set it up: all that a turn of the top, a Sune, an edge flip
// and a T perm reach from the solved cube (62,208: 4! × 4! / 2 places, 3³ corner twists, 2³ edge flips)
const GENERATORS = ["U", "R U R' U R U2 R'", "F R U R' U' F'", "R U R' U' R' F R2 U' R' U' R U R' F'"];
const turns = GENERATORS.map((alg) => kpuzzle.algToTransformation(alg));
const keyOf = (pattern: KPattern) => `${pattern.patternData.EDGES.pieces.slice(0, 4)}/${pattern.patternData.EDGES.orientation.slice(0, 4)}/${pattern.patternData.CORNERS.pieces.slice(0, 4)}/${pattern.patternData.CORNERS.orientation.slice(0, 4)}`;
const states: { pattern: KPattern; setup: string }[] = [{ pattern: kpuzzle.defaultPattern(), setup: "" }];
const seen = new Set([keyOf(states[0].pattern)]);
for (const state of states) {
  turns.forEach((turn, index) => {
    const pattern = state.pattern.applyTransformation(turn);
    const key = keyOf(pattern);
    if (seen.has(key)) return;
    seen.add(key);
    states.push({ pattern, setup: `${state.setup} ${GENERATORS[index]}`.trim() });
  });
}
console.log(`${states.length} last-layer states`);
// How the last layer's pieces are turned (what OLL sees), and whether they're all turned right (what PLL starts from)
const twists = (pattern: KPattern) => `${pattern.patternData.EDGES.orientation.slice(0, 4)}/${pattern.patternData.CORNERS.orientation.slice(0, 4)}`;
const SOLVED_TWISTS = twists(kpuzzle.defaultPattern());

for (const name of which.split(",")) {
  const set = ALG_SETS[name];
  const problems: string[] = [];
  // Each alg ends held as it started, and solves the case it's listed under (the default alg's case)
  for (const item of set.cases) {
    const made = toFaces(engineText(item.algs[0]));
    const fits = made.home ? recognise(name, inverse(made.faces)) : [];
    const cases = [...new Set(fits.map((result) => result.alg))];
    if (made.home && (cases.length !== 1 || cases[0] !== item.name)) problems.push(`${item.name}: its case is also solved by ${cases.filter((other) => other !== item.name).join(", ") || "nothing (not even itself)"}`);
    item.algs.forEach((alg, place) => {
      const own = toFaces(engineText(alg));
      if (!own.home) problems.push(`${item.name}: ${alg} leaves the cube held another way`);
      else if (place && !fits.some((result) => result.alg === item.name && handsOf(result).includes(engineText(alg)))) {
        // Where it belongs instead: the cases that solve the state it sets up
        const others = [...new Set(recognise(name, inverse(own.faces)).map((result) => result.alg))];
        problems.push(`${item.name}: ${alg} doesn't solve its case; it solves ${others.join(", ") || "none of the set"}`);
      }
    });
  }
  // The states the set has to cover: one per way the pieces can be turned for OLL, every state with them turned right for PLL
  const byTwists = new Map<string, string>();
  for (const state of states) {
    const key = name === "OLL" ? twists(state.pattern) : twists(state.pattern) === SOLVED_TWISTS ? keyOf(state.pattern) : "";
    if (key && !byTwists.has(key)) byTwists.set(key, state.setup);
  }
  const covered = new Set<string>();
  const missed: string[] = [];
  let done = 0;
  for (const setup of byTwists.values()) {
    // The solved layer needs nothing, and one that's a turn of the top away only that turn (an answer without a case)
    const fits = recognise(name, setup);
    if (!fits.length && setup) missed.push(setup);
    else if (!fits.length || !fits[0].alg) done++;
    else fits.forEach((result) => covered.add(result.alg!));
  }
  console.log(`\n=== ${name}: ${set.cases.length} cases, ${set.cases.reduce((sum, item) => sum + item.algs.length, 0)} algs`);
  console.log(`${byTwists.size} states to cover: ${byTwists.size - missed.length - done} recognised as ${covered.size} cases, ${done} already done or a turn of the top away, ${missed.length} that no alg fits`);
  const unused = set.cases.filter((item) => !covered.has(item.name)).map((item) => item.name);
  if (unused.length) console.log(`cases never recognised: ${unused.join(", ")}`);
  for (const setup of missed.slice(0, 20)) console.log(`no alg fits the cube after: ${setup}`);
  console.log(problems.length ? problems.join("\n") : "every alg ends held as it started and solves the case it's listed under");
}
process.exit(0);
