// Speed model, the writings: the ways the hands can make a sequence of face turns when some are made as the opposite wide turn, or two as one slice turn.
// It only says which writings there are; fingering.ts finds the cheapest one

// Faces a rotation moves, each to the next one's place (x turns like R, y like U, z like F)
const CYCLES: Record<string, string[]> = { x: ["F", "U", "B", "D"], y: ["F", "L", "B", "R"], z: ["U", "R", "D", "L"] };

// Turns the hands make on more than one layer, by axis: the face turns each one makes (a prime = the other way round) and how the cube is held after it.
// Lw is R then x': the left hand turns two layers and the right one stays, so the cube ends up turned; M is R and L' with the middle staying, which is x' too
const WRITTEN: Record<string, { token: string; faces: string[]; rotation: string }[]> = {
  x: [
    { token: "Lw", faces: ["R"], rotation: "x'" },
    { token: "Rw", faces: ["L"], rotation: "x" },
    { token: "M", faces: ["R", "L'"], rotation: "x'" },
  ],
  y: [
    { token: "Dw", faces: ["U"], rotation: "y'" },
    { token: "Uw", faces: ["D"], rotation: "y" },
    { token: "E", faces: ["U", "D'"], rotation: "y'" },
  ],
  z: [
    { token: "Bw", faces: ["F"], rotation: "z'" },
    { token: "Fw", faces: ["B"], rotation: "z" },
    { token: "S", faces: ["F'", "B"], rotation: "z" },
  ],
};

// What follows a turn's letter, by its quarter turns clockwise (1 = plain, 2 = half, 3 = prime)
const SUFFIXES = ["", "", "2", "'"];

// A plain face turn: its face and what follows it ("", "'" or "2")
const FACE_TURN = /^([URFDLB])('|2)?$/;

// A frame: the cube's own face on each side as the hands hold it, as six letters in the order of SIDES ("UDRLFB" = held as the answer names it)
const SIDES = "UDRLFB";

// Frames after a rotation, by frame and rotation (24 frames, so this fills up fast)
const rotated = new Map<string, string>();

// A frame after a rotation (x, y', z2…)
function rotate(frame: string, rotation: string): string {
  const key = frame + rotation;
  let next = rotated.get(key);
  if (next === undefined) {
    // One quarter turn at a time: each face of the cycle goes to the next one's side (the other way round for a prime)
    const cycle = rotation.endsWith("'") ? [...CYCLES[rotation[0]]].reverse() : CYCLES[rotation[0]];
    const sides = [...frame];
    for (let quarter = rotation.endsWith("2") ? 2 : 1; quarter > 0; quarter--) {
      const before = [...sides];
      cycle.forEach((side, index) => (sides[SIDES.indexOf(cycle[(index + 1) % 4])] = before[SIDES.indexOf(side)]));
    }
    next = sides.join("");
    rotated.set(key, next);
  }
  return next;
}

// A turn or rotation given for one quarter turn clockwise, made `quarters` times (1–3): "x'" twice is "x2", three times "x"
function times(turn: string, quarters: number): string {
  const prime = turn.endsWith("'");
  return (prime ? turn.slice(0, -1) : turn) + SUFFIXES[prime ? 4 - quarters : quarters];
}

// One way to go on from a place in an answer: the token the hands make, how many of the answer's turns it covers, and the frame after it
export interface WritingOption {
  token: string;
  covers: number;
  frame: string;
}

// An answer ready to be written: how many turns it has, the frame it starts and ends in, and the ways to go on from each place in each frame
// (only those the rest of the answer can still bring back to that frame; the plain turn first)
export interface WritingPlan {
  length: number;
  home: string;
  optionsAt(at: number, frame: string): WritingOption[];
}

// The ways the hands can write an answer (plain face turns, as its grip names them) with some turns made as wide turns about the wide axes ("x", "y",
// "z") or slice turns about the slice axes (slices = the wide axes when left out), the cube ending held as it started, so each writing is the answer
// itself to the cube: R … R' may be Lw … Lw', and R L' is M with the cube turned as by x'. Null when the plain writing is the only one (or a move isn't
// a plain face turn)
export function writingPlan(moves: string[], axes: string[], slices: string[] = axes): WritingPlan | null {
  const turns = moves.map((move) => FACE_TURN.exec(move));
  // Wide turns (one face each) about the wide axes, slice turns (two faces) about the slice axes
  const forms = ["x", "y", "z"].flatMap((axis) => (WRITTEN[axis] ?? []).filter((form) => (form.faces.length === 1 ? axes : slices).includes(axis)));
  if (!forms.length || turns.includes(null)) return null;
  // Each turn as [the cube's own face, quarter turns clockwise]
  const steps = turns.map((turn) => [turn![1], turn![2] === "2" ? 2 : turn![2] ? 3 : 1] as [string, number]);
  // Every way to go on from a place in a frame: the turn itself, the wide turn that makes it, or a slice turn that makes it and the next one
  const allAt = (at: number, frame: string): WritingOption[] => {
    // The sides the next two turns are on, as the hands hold the cube
    const [side, quarters] = [SIDES[frame.indexOf(steps[at][0])], steps[at][1]];
    const next = at + 1 < steps.length ? SIDES[frame.indexOf(steps[at + 1][0])] : "";
    const options: WritingOption[] = [{ token: side + SUFFIXES[quarters], covers: 1, frame }];
    for (const form of forms) {
      // How often the form is made for its face to turn as this turn does (none when it turns another side)
      const first = form.faces.findIndex((face) => face[0] === side);
      if (first < 0) continue;
      const count = form.faces[first].endsWith("'") ? 4 - quarters : quarters;
      const after = rotate(frame, times(form.rotation, count));
      if (form.faces.length === 1) options.push({ token: times(form.token, count), covers: 1, frame: after });
      else {
        // A slice turn: the next turn has to be the form's other face, turned as the form turns it
        const other = form.faces[1 - first];
        if (other[0] === next && (other.endsWith("'") ? 4 - count : count) === steps[at + 1][1]) options.push({ token: times(form.token, count), covers: 2, frame: after });
      }
    }
    return options;
  };
  // Whether the rest of the answer can still end held as it started from a place in a frame (so no writing is followed that can't), worked out only
  // for the places and frames a writing really passes through, and once each
  const ends = new Map<string, boolean>();
  const canEnd = (at: number, frame: string): boolean => {
    if (at === steps.length) return frame === SIDES;
    const key = `${at}/${frame}`;
    let end = ends.get(key);
    if (end === undefined) ends.set(key, (end = allAt(at, frame).some((option) => canEnd(at + option.covers, option.frame))));
    return end;
  };
  // The ways that can still end right, worked out once per place and frame (the search asks again for each set of layers turned)
  const kept = new Map<string, WritingOption[]>();
  const optionsAt = (at: number, frame: string): WritingOption[] => {
    const key = `${at}/${frame}`;
    let options = kept.get(key);
    if (!options) kept.set(key, (options = allAt(at, frame).filter((option) => canEnd(at + option.covers, option.frame))));
    return options;
  };
  // A writing with a wide or slice turn leaves the starting frame somewhere: none does when no place lets it
  if (!steps.some((_, at) => optionsAt(at, SIDES).length > 1)) return null;
  return { length: steps.length, home: SIDES, optionsAt };
}
