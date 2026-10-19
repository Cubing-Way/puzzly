// ZBLL sheet (bench/out/zbll-sheet.js): the ZBLL cases of a published alg database turned into src/engine/algs/zbll.ts, each alg checked on the cube.
// The database is @moishy/algsets (MIT, its algs from SpeedCubeDB): its zbll file is read as text, never run. Get it with
// `npm pack @moishy/algsets@0.3.3` and unpack it (tar xzf), then: node bench/out/zbll-sheet.js <package/esm/src/zbll/index.js> [output]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Alg } from "cubing/alg";
import { cube3x3x3 } from "cubing/puzzles";
import { KPattern } from "cubing/kpuzzle";
import { toFaces, speedCost } from "../src/engine/index.ts";
import { PLL_CASES } from "../src/engine/algs/pll.ts";

const [input, output = "src/engine/algs/zbll.ts"] = process.argv.slice(2);
if (!input) throw new Error("Usage: node bench/out/zbll-sheet.js <@moishy/algsets package/esm/src/zbll/index.js> [output]");
const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

// An alg as the engine writes it (Rw for r)
const engineText = (alg: string) => alg.replace(/\b([rludfb])(?=[2']?(\s|$))/g, (letter) => `${letter.toUpperCase()}w`);
// Turns of the top layer, which line a case up before and after its alg
const AUF = ["", "U", "U'", "U2"];
// The last layer's pieces as a key: edges then corners, where each sits and how it's turned (the first four of each orbit are the top layer's)
const keyOf = (pattern: KPattern) => {
  const { EDGES, CORNERS } = pattern.patternData;
  return `${EDGES.pieces.slice(0, 4)}/${EDGES.orientation.slice(0, 4)}/${CORNERS.pieces.slice(0, 4)}/${CORNERS.orientation.slice(0, 4)}`;
};
// The first two layers solved and the top edges turned right: a state ZBLL starts from
const isZbllState = (pattern: KPattern) => {
  const { EDGES, CORNERS } = pattern.patternData;
  const f2l = EDGES.pieces.every((piece, spot) => spot < 4 || (piece === spot && !EDGES.orientation[spot])) && CORNERS.pieces.every((piece, spot) => spot < 4 || (piece === spot && !CORNERS.orientation[spot]));
  return f2l && EDGES.orientation.slice(0, 4).every((twist) => !twist);
};
// A case up to the turns of the top before and after its alg: the smallest key of the 16 lined-up copies of a state
const caseKeyOf = (state: KPattern) => {
  const turned = state.experimentalToTransformation()!;
  return AUF.flatMap((before) => AUF.map((after) => keyOf(solved.applyAlg(before).applyTransformation(turned).applyAlg(after)))).sort()[0];
};
// The state an alg solves: the solved cube run through its face turns backwards
const stateOf = (faces: string) => solved.applyAlg(new Alg(faces).invert());

// An alg tidied the way the sheets in this folder write it: no brackets, R2 for R2', r for Rw, no turn of the top at either end (the set lines cases up
// itself), and a rotation the alg leaves the cube turned by undone at its end (y … y'); null when it can't be held as it started
function tidyAlg(text: string): string | null {
  let moves = text.replace(/[()[\]]/g, " ").trim().split(/\s+/).filter(Boolean).map((move) => {
    const match = /^([A-Za-z])(w?)(\d*)('?)$/.exec(move);
    if (!match) throw new Error(`Bad move ${move} in ${text}`);
    const letter = match[2] ? match[1].toLowerCase() : match[1];
    return match[3] === "2" ? `${letter}2` : `${letter}${match[3]}${match[4]}`;
  });
  // A turn of the top (or a y, which keeps the top on top) at either end of the alg, before its first other move or after its last
  const isAuf = (move: string) => /^U[2']?$/.test(move);
  const isTopKeeper = (move: string) => isAuf(move) || /^y[2']?$/.test(move);
  const lead = moves.findIndex((move) => !isTopKeeper(move));
  const tail = moves.length - 1 - [...moves].reverse().findIndex((move) => !isTopKeeper(move));
  moves = [...moves.slice(0, lead).filter((move) => !isAuf(move)), ...moves.slice(lead, tail + 1), ...moves.slice(tail + 1).filter((move) => !isAuf(move))];
  const alg = moves.join(" ");
  if (toFaces(alg).home) return alg;
  // The rotation that brings the cube back (one or two quarter-turn families)
  const ROTATIONS = ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"];
  for (const first of ROTATIONS) if (toFaces(`${alg} ${first}`).home) return `${alg} ${first}`;
  for (const first of ROTATIONS) for (const second of ROTATIONS) if (toFaces(`${alg} ${first} ${second}`).home) return `${alg} ${first} ${second}`;
  return null;
}

// Every ZBLL state: each arrangement of the top's edges and corners with the same parity, and each way of twisting the corners (7,776)
const permutations = (items: number[]): number[][] => (items.length <= 1 ? [items] : items.flatMap((item, at) => permutations(items.filter((_, other) => other !== at)).map((rest) => [item, ...rest])));
const parity = (order: number[]) => order.reduce((odd, _, at) => odd ^ order.slice(at + 1).filter((later) => later < order[at]).length % 2, 0);
const allCases = new Map<string, KPattern>();
let stateCount = 0;
for (const edges of permutations([0, 1, 2, 3]))
  for (const corners of permutations([0, 1, 2, 3])) {
    if (parity(edges) !== parity(corners)) continue;
    for (let twists = 0; twists < 27; twists++) {
      const twist = [twists % 3, Math.floor(twists / 3) % 3, Math.floor(twists / 9)];
      const data = structuredClone(solved.patternData);
      data.EDGES.pieces.splice(0, 4, ...edges);
      data.CORNERS.pieces.splice(0, 4, ...corners);
      data.CORNERS.orientation.splice(0, 4, ...twist, (6 - twist[0] - twist[1] - twist[2]) % 3);
      const state = new KPattern(kpuzzle, data);
      stateCount++;
      const key = caseKeyOf(state);
      if (!allCases.has(key)) allCases.set(key, state);
    }
  }
const solvedKey = caseKeyOf(solved);
console.log(`${stateCount} ZBLL states, ${allCases.size} cases up to turns of the top (the solved one included)`);

// The database's cases: id, name, subset and algs, read from the file's text
const source = readFileSync(input, "utf8");
const CASE = /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*subset:\s*"([^"]+)",\s*algs:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
const read = [...source.matchAll(CASE)].map((match) => ({ id: match[1], name: match[2], subset: match[3], algs: [...match[4].matchAll(/alg:\s*"([^"]+)"/g)].map((alg) => alg[1]) }));
console.log(`${read.length} cases and ${read.reduce((sum, item) => sum + item.algs.length, 0)} algs read from ${input}`);

// Each case's algs tidied and checked: those that can't be held as they started, or that aren't ZBLL algs, are dropped
const SUBSET_NAMES: Record<string, string> = { t: "T", u: "U", l: "L", h: "H", pi: "Pi", s: "S", as: "AS" };
const problems: string[] = [];
let dropped = 0;
const checked = read.map((item) => {
  const subset = SUBSET_NAMES[item.subset] ?? item.subset.toUpperCase();
  const algs = item.algs.flatMap((raw) => {
    const alg = tidyAlg(raw);
    const state = alg === null ? null : stateOf(toFaces(engineText(alg)).faces);
    if (alg && state && isZbllState(state)) return [{ alg, key: caseKeyOf(state) }];
    problems.push(`${item.name}: ${raw} ${alg ? "isn't a ZBLL alg (it moves the first two layers or flips top edges)" : "can't end held as it started"}, dropped`);
    dropped++;
    return [];
  });
  return { name: `${subset} ${/(\d+)$/.exec(item.id)?.[1] ?? item.id}`, subset, algs };
});
// The cases kept, by case key: a case is the state its first alg solves (two cases of the same state are merged)
const byKey = new Map<string, { name: string; subset: string; algs: string[] }>();
for (const item of checked) {
  if (!item.algs.length) problems.push(`${item.name}: no alg checks out, case left out`);
  else if (byKey.has(item.algs[0].key)) problems.push(`${item.name}: the same case as ${byKey.get(item.algs[0].key)!.name}, merged into it`);
  else byKey.set(item.algs[0].key, { name: item.name, subset: item.subset, algs: [] });
}
// Each alg goes to the case it solves, which may not be the one it was filed under
for (const item of checked)
  for (const { alg, key } of item.algs) {
    if (key !== item.algs[0].key) problems.push(`${item.name}: ${alg} solves ${byKey.get(key)?.name ?? "a case of its own"}, moved there`);
    if (!byKey.has(key)) byKey.set(key, { name: `${item.name}b`, subset: item.subset, algs: [] });
    const entry = byKey.get(key)!;
    if (!entry.algs.includes(alg)) entry.algs.push(alg);
  }

// The PLL cases (corners already turned right), from pll.ts: the set adds them, so the sheet must not hold them
const pllKeys = new Map(PLL_CASES.map((item) => [caseKeyOf(stateOf(toFaces(engineText(item.algs[0])).faces)), item.name]));
for (const [key, entry] of byKey)
  if (pllKeys.has(key) || key === solvedKey) {
    problems.push(`${entry.name}: is ${pllKeys.get(key) ?? "the solved layer"}, left out`);
    byKey.delete(key);
  }
const missing = [...allCases.keys()].filter((key) => key !== solvedKey && !byKey.has(key) && !pllKeys.has(key));
console.log(`${byKey.size} ZBLL cases kept, + ${pllKeys.size} PLL cases from pll.ts; ${missing.length} cases no alg solves; ${dropped} algs dropped`);
for (const problem of problems) console.log(problem);
if (missing.length) {
  for (const key of missing.slice(0, 20)) console.log(`no alg for the case ${key}`);
  process.exit(1);
}

// Each case's algs fastest first, by the engine's speed model (as the hands make them)
const cost = (alg: string) => speedCost(engineText(alg));
const ORDER = ["T", "U", "L", "H", "Pi", "S", "AS"];
const cases = [...byKey.values()]
  .map((entry) => ({ ...entry, algs: [...entry.algs].sort((a, b) => cost(a) - cost(b)) }))
  .sort((a, b) => ORDER.indexOf(a.subset) - ORDER.indexOf(b.subset) || parseInt(a.name.split(" ")[1]) - parseInt(b.name.split(" ")[1]));

// The corners' pattern each subset starts from, as a comment over its cases
const SUBSETS: Record<string, string> = {
  T: "T: the corners of the T OLL (two turned right side by side, the other two facing left and right)",
  U: "U: the corners of the U OLL (two turned right side by side, the other two facing the same way)",
  L: "L: the corners of the L OLL (two turned right across a diagonal)",
  H: "H: the corners of the H OLL (none turned right, facing two opposite sides in pairs)",
  Pi: "Pi: the corners of the Pi OLL (none turned right, two facing one side, the others two sides)",
  S: "S: the corners of the Sune (one turned right, the others clockwise)",
  AS: "AS: the corners of the Antisune (one turned right, the others counterclockwise)",
};
// The package's license, three folders up from its zbll file
const LICENSE = readFileSync(resolve(dirname(input), "../../../LICENSE"), "utf8").trim();
const lines = [
  `// The ${cases.length} cases of ZBLL (the whole last layer in one alg, its edges already turned right), each with its algs fastest first by the engine's`,
  "// speed model: the one the engine makes on a tie. Named by the corners' pattern and the number the source gives it. The PLL cases (corners already right)",
  "// are pll.ts's, added by the ZBLL set itself (sets.ts). Every alg ends with the cube held as it started, with no turn of the top at either end.",
  "// Made by `node bench/out/zbll-sheet.js` from @moishy/algsets 0.3.3 (its algs from SpeedCubeDB, license below); `node bench/out/alg-sets.js ZBLL` checks it",
  "",
  "// One case of an alg set: its name and its algs, the default first",
  'import type { AlgCase } from "./sets";',
  "",
  "// A case by its corners' pattern and number",
  "const zb = (name: string, ...algs: string[]): AlgCase => ({ name: `ZBLL ${name}`, algs });",
  "",
  "export const ZBLL_CASES: AlgCase[] = [",
];
let subset = "";
for (const item of cases) {
  if (item.subset !== subset) lines.push(`  // ${SUBSETS[(subset = item.subset)] ?? subset}`);
  lines.push(`  zb(${[item.name, ...item.algs].map((text) => JSON.stringify(text)).join(", ")}),`);
}
lines.push("];", "", "// The source's license (@moishy/algsets):", ...LICENSE.split(/\r?\n/).map((line) => `// ${line}`.trimEnd()), "");
writeFileSync(output, lines.join("\n"));
console.log(`Wrote ${output}: ${cases.length} cases, ${cases.reduce((sum, item) => sum + item.algs.length, 0)} algs`);
process.exit(0);
