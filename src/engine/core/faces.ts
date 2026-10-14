// Move text as the plain face turns it makes on a cube whose centers stay put: wide turns, slices and rotations folded into how the cube is held,
// so an alg written with them can be applied, checked and compared like any face-turn answer

// What a turn on more than one layer does, per quarter turn clockwise: the face turned (as held) and the rotation that goes with it
const PARTS: Record<string, [string, string][]> = {
  r: [["L", "x"]],
  l: [["R", "x'"]],
  u: [["D", "y"]],
  d: [["U", "y'"]],
  f: [["B", "z"]],
  b: [["F", "z'"]],
  M: [["R", "x'"], ["L'", ""]],
  E: [["U", "y'"], ["D'", ""]],
  S: [["F'", "z"], ["B", ""]],
};
// Faces a rotation moves, each to the next one's place (x turns like R, y like U, z like F)
const CYCLES: Record<string, string[]> = { x: ["F", "U", "B", "D"], y: ["F", "L", "B", "R"], z: ["U", "R", "D", "L"] };
// Each face's axis (opposite faces share one, and their turns can swap places)
const AXIS: Record<string, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
// A face turn as [face, quarter turns clockwise (1–3)]
type FaceTurn = [string, number];

// One move read: its family (wide turns as a small letter) and its quarter turns clockwise (0–3)
function read(move: string): [string, number] {
  const match = /^([UDLRFBMESxyz]|[UDLRFB]w|[udlrfb])(\d*)('?)$/.exec(move);
  if (!match) throw new Error(`Bad move ${move}`);
  const family = match[1].length === 2 ? match[1][0].toLowerCase() : match[1];
  return [family, ((((match[2] ? Number(match[2]) : 1) * (match[3] ? -1 : 1)) % 4) + 4) % 4];
}

// A frame (held side → the cube's own face there) after one quarter turn of a rotation
function rotate(frame: Record<string, string>, axis: string, prime: boolean): Record<string, string> {
  const cycle = prime ? [...CYCLES[axis]].reverse() : CYCLES[axis];
  const next = { ...frame };
  cycle.forEach((face, index) => (next[cycle[(index + 1) % 4]] = frame[face]));
  return next;
}

// Face turns tidied: turns of one face joined (also across a turn of the opposite face), and opposite faces in a fixed order
function tidy(turns: FaceTurn[]): FaceTurn[] {
  const out: FaceTurn[] = [];
  for (const [face, quarters] of turns) {
    // The last turn of this face, if only turns of the opposite face came after it
    let at = out.length - 1;
    while (at >= 0 && AXIS[out[at][0]] === AXIS[face] && out[at][0] !== face) at--;
    if (at >= 0 && out[at][0] === face) {
      out[at][1] = (out[at][1] + quarters) % 4;
      if (!out[at][1]) out.splice(at, 1);
    } else out.push([face, quarters]);
  }
  // Two opposite faces in a row, by letter
  for (let i = 0; i + 1 < out.length; i++) if (AXIS[out[i][0]] === AXIS[out[i + 1][0]] && out[i][0] > out[i + 1][0]) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  return out;
}

// Face turns as text
function text(turns: FaceTurn[]): string {
  return turns.map(([face, quarters]) => face + ["", "", "2", "'"][quarters]).join(" ");
}

// An alg as the face turns it makes on the cube itself, tidied, and whether the cube ends held as it started
export function toFaces(alg: string): { faces: string; home: boolean } {
  let frame: Record<string, string> = { U: "U", D: "D", R: "R", L: "L", F: "F", B: "B" };
  const turns: FaceTurn[] = [];
  for (const move of alg.split(/\s+/).filter(Boolean)) {
    const [family, quarters] = read(move);
    // The cube turned in the hands, once per quarter turn of the move
    const spin = (rotation: string) => {
      if (rotation) for (let quarter = 0; quarter < quarters; quarter++) frame = rotate(frame, rotation[0], rotation.endsWith("'"));
    };
    if ("xyz".includes(family)) spin(family);
    else if (PARTS[family]) {
      // A wide or slice turn: its faces as held before it, then its rotation
      const before = frame;
      for (const [face, rotation] of PARTS[family]) {
        turns.push([before[face[0]], face.endsWith("'") ? (4 - quarters) % 4 : quarters]);
        spin(rotation);
      }
    } else turns.push([frame[family], quarters]);
  }
  return { faces: text(tidy(turns)), home: Object.entries(frame).every(([held, own]) => held === own) };
}

// Face-turn text tidied the same way (to compare a listed answer with a known alg's turns)
export function canon(moves: string): string {
  return text(tidy(moves.split(/\s+/).filter(Boolean).map((move) => read(move))));
}

// The face turns that undo face-turn text
export function inverse(moves: string): string {
  const turns = moves.split(/\s+/).filter(Boolean).map((move) => read(move));
  return text(turns.reverse().map(([face, quarters]): FaceTurn => [face, (4 - quarters) % 4]));
}
