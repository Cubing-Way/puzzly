// Answer files: every answer a step's search would list and score for each of its cases, worked out ahead of time (bench/answer-file.ts makes one from
// bench/pairs.ts's run), so a step asked with the options the file was made for is answered from it instead of searched (see file-step.ts). A file says
// what it was made for (the step's pieces and options) and holds per case its answers in each twin grip with their turning costs; what depends on the
// rest of the cube (finding pieces, cancels into the moves before) is worked out at the time.
// Layout: "PZA1", the header's length (u32, little-endian) and the header as JSON, then each case's answers: their count (u32), then each answer as 8
// bytes and its tokens: its hold (its grip rotation from the case's own grip, an index into `holds`), flags (see FLAG_*), how many face turns and how many
// writing tokens it has, the face turns' cost and the writing's (u16 each, hundredths: only for bounds, the exact costs are worked out again), then the
// face turns' tokens and the writing's (indices into `tokens`). A cut file (see AnswerFileCut) follows each case's answers with what it left out of
// each hold (see DroppedHold): the shortest clean and writing-clean answers (u8, 255 = none); how many lengths (u8), each as its turns (u8) and four
// costs (u16, 0xffff = none); how many least costs after 3, 4… turns (u8), each as two i16 (hundredths rounded down); how many first turns (u8), each
// as its token (u8), four least costs after it (i16), two costs (u16) and the tokens that come second (a u8 count, then u8 each)

// The options a file was made with: a step asked with the very same ones (and up to as many extra moves) can be answered from it
export interface AnswerFileOptions {
  generatorMoves: string[];
  rotations: string[];
  offsets: string[];
  solvableWith: string[];
  rank: "speed";
  extraMoves: number;
  avoid: string[];
  wideAxes: string[];
  sliceAxes: string[];
  rotationAxes: string[];
}

// One case as the file has it: its key (see caseKey in file-step.ts), the worker's measured distance of its combo (it orders a step's combos), its
// shortest answer's length and that answer itself (the search's first, after the grip rotation), and where its answers are in the file
export interface AnswerFileCase {
  key: string;
  bound: number;
  shortest: number;
  first: string;
  at: number;
  size: number;
}

// What a file says about itself
export interface AnswerFileHeader {
  pieces: string; // the step's goal text, alternatives split by " | "
  options: AnswerFileOptions;
  holds: string[]; // grip rotations an answer may be held in, from its case's own grip ("" = as the case is held)
  tokens: string[]; // the moves answers are written with
  cases: AnswerFileCase[];
  cut?: AnswerFileCut; // a file with only some of each case's answers
}

// How a file was cut from a full one (bench/answer-cut.ts): per case and hold, it keeps the answers whose cost (the least of their face turns' and
// their writing's, as the file has them) is within `margin` of the `rank`th least, and per first turn an answer may be made with (see DroppedHold)
// those whose least cost after it (or after the next turn too; from any hand position and from home) is within `cancelMargin` of the least of the
// hold's answers made with that turn: a cancel into the moves before can make those fast. Each case says what it left out, so a step is answered from
// a cut file only when nothing left out could have made its list (else it's searched). The full file's answers and size, for the record
export interface AnswerFileCut {
  rank: number;
  margin: number;
  cancelMargin: number;
  answers: number;
  bytes: number;
}

// What a cut file left out of a case, per hold (an index into `holds`), for the check that none of it could make a step's list: the shortest answer
// that's clean in some order of its turns (FLAG_ANY_CLEAN; Infinity = none) as the full file has it, the shortest left out whose writing is clean
// (FLAG_WRITING_CLEAN), per length the least face-turn and writing costs left out of answers that may be clean and of those sure not to be (see
// `dirty` in file-step.ts; Infinity = none); per first turn an answer left out may be made with (a turn of its first run about one axis, or its
// writing's first token), the least cost of what comes after it and after the next turn too, from any hand position (see leastCostAfter) and from home
// (speedCost: what's left of the moves before then is nothing, or ends with the grip rotation), the least costs of those answers and the tokens that
// come second in them (a second turn that cancels too is one of those); and for an answer whose first 3, 4… turns all join the moves before, the least
// what comes after them costs over every answer left out, the same two ways (`deeper[0]` after 3 turns)
export interface DroppedHold<Token = number> {
  anyClean: number;
  writingClean: number;
  lengths: { turns: number; plain: number; written: number; dirtyPlain: number; dirtyWritten: number }[];
  deeper: number[];
  deeperHome: number[];
  firsts: { token: Token; after: number; afterHome: number; afterTwo: number; afterTwoHome: number; plain: number; written: number; second: Token[] }[];
}

// One answer of a case, as the file is made from it: its hold (an index into `holds`), its face turns in the order the step scored fastest (after the
// grip rotation), its cheapest writing with wide and slice turns when that's faster (else null), their costs with the grip rotation (no looks, no cancels;
// the writing's = the face turns' without one), and whether they're clean (none of the faces to avoid, nothing strained): the face turns as ordered,
// some order of them, the writing
export interface PreparedAnswer {
  hold: number;
  moves: string;
  writing: string | null;
  plain: number;
  written: number;
  clean: boolean;
  anyClean: boolean;
  writingClean: boolean;
}

// An answer's flags
export const FLAG_WRITING = 1;
export const FLAG_CLEAN = 2;
export const FLAG_ANY_CLEAN = 4;
export const FLAG_WRITING_CLEAN = 8;

// A case's answers read from the file: per answer its hold, flags, face turns (how many, where their tokens start), writing (how many tokens, where they
// start) and costs, in typed arrays
export interface CaseAnswers {
  count: number;
  hold: Uint8Array;
  flags: Uint8Array;
  turns: Uint8Array;
  movesAt: Uint32Array;
  writingTokens: Uint8Array;
  writingAt: Uint32Array;
  plain: Float64Array;
  written: Float64Array;
  dropped?: DroppedHold[];
}

// A file read: its header, its cases by key, the bytes of its answers, and the cases read so far
export interface AnswerFile {
  header: AnswerFileHeader;
  cases: Map<string, AnswerFileCase>;
  bytes: Uint8Array;
  read: Map<AnswerFileCase, CaseAnswers>;
}

const MAGIC = "PZA1";
const ANSWER_BYTES = 8;

// A cost in a file: hundredths in a u16, NONE for none
const NONE = 0xffff;
const costBits = (cost: number): number => (cost === Infinity ? NONE : Math.round(cost * 100));
const costOf = (bits: number): number => (bits === NONE ? Infinity : bits / 100);
// A length in a file: a u8, 255 for none
const lengthBits = (turns: number): number => (turns === Infinity ? 255 : turns);
const lengthOf = (bits: number): number => (bits === 255 ? Infinity : bits);

// A file made one case at a time: `add` each case with its answers (as bytes at once, so a big file never holds its answers as objects) and, for a cut
// file, what it left out of the case (its tokens as text), then `finish` gives the file (the header's tokens and where each case is are filled in there)
export function answerFileWriter(made: Pick<AnswerFileHeader, "pieces" | "options" | "holds" | "cut">): {
  add(entry: Omit<AnswerFileCase, "at" | "size">, answers: PreparedAnswer[], dropped?: DroppedHold<string>[]): void;
  finish(): Uint8Array;
} {
  const tokens: string[] = [];
  const tokenOf = new Map<string, number>();
  const ids = (text: string): number[] =>
    text
      .split(" ")
      .filter(Boolean)
      .map((token) => {
        if (!tokenOf.has(token)) {
          tokenOf.set(token, tokens.length);
          tokens.push(token);
        }
        return tokenOf.get(token)!;
      });
  const cases: AnswerFileCase[] = [];
  const bodies: Uint8Array[] = [];
  let size = 0;
  const add = (entry: Omit<AnswerFileCase, "at" | "size">, answers: PreparedAnswer[], dropped?: DroppedHold<string>[]): void => {
    const parts = answers.map((answer) => {
      const moves = ids(answer.moves);
      const writing = answer.writing === null ? [] : ids(answer.writing);
      if (moves.length > 255 || writing.length > 255 || tokens.length > 256) throw new Error("An answer file holds answers of up to 255 tokens, written with up to 256 kinds.");
      const bytes = new Uint8Array(ANSWER_BYTES + moves.length + writing.length);
      const view = new DataView(bytes.buffer);
      const flags = (answer.writing === null ? 0 : FLAG_WRITING) | (answer.clean ? FLAG_CLEAN : 0) | (answer.anyClean ? FLAG_ANY_CLEAN : 0) | (answer.writingClean ? FLAG_WRITING_CLEAN : 0);
      bytes.set([answer.hold, flags, moves.length, writing.length]);
      view.setUint16(4, Math.round(answer.plain * 100), true);
      view.setUint16(6, Math.round(answer.written * 100), true);
      bytes.set([...moves, ...writing], ANSWER_BYTES);
      return bytes;
    });
    // What was left out, per hold: shortest clean and writing-clean answers, per length its least costs, least costs after 3, 4… turns, per first turn
    // its least costs after it (and the next turn) and its costs
    if (made.cut) {
      if (dropped?.length !== made.holds.length) throw new Error("A cut file says what it left out of each hold.");
      const out: number[] = [];
      const u16 = (value: number) => out.push(value & 0xff, value >> 8);
      for (const hold of dropped) {
        out.push(lengthBits(hold.anyClean), lengthBits(hold.writingClean), hold.lengths.length);
        for (const length of hold.lengths) {
          out.push(length.turns);
          for (const cost of [length.plain, length.written, length.dirtyPlain, length.dirtyWritten]) u16(costBits(cost));
        }
        // A least cost after is kept rounded down (it stays a bound), signed
        const least = (cost: number) => u16(Math.min(0x7fff, Math.max(-0x8000, Math.floor(cost * 100))) & 0xffff);
        out.push(hold.deeper.length);
        for (const [at, cost] of hold.deeper.entries()) {
          least(cost);
          least(hold.deeperHome[at]);
        }
        out.push(hold.firsts.length);
        for (const first of hold.firsts) {
          out.push(ids(first.token)[0]);
          for (const cost of [first.after, first.afterHome, first.afterTwo, first.afterTwoHome]) least(cost);
          u16(costBits(first.plain));
          u16(costBits(first.written));
          const second = first.second.map((token) => ids(token)[0]);
          out.push(second.length, ...second);
        }
      }
      if (tokens.length > 256) throw new Error("An answer file's answers are written with up to 256 kinds of tokens.");
      parts.push(Uint8Array.from(out));
    }
    const body = new Uint8Array(4 + parts.reduce((sum, part) => sum + part.length, 0));
    new DataView(body.buffer).setUint32(0, answers.length, true);
    let at = 4;
    for (const part of parts) {
      body.set(part, at);
      at += part.length;
    }
    cases.push({ ...entry, at: size, size: body.length });
    bodies.push(body);
    size += body.length;
  };
  const finish = (): Uint8Array => {
    const header: AnswerFileHeader = { pieces: made.pieces, options: made.options, holds: made.holds, tokens, cases, ...(made.cut ? { cut: made.cut } : {}) };
    const json = new TextEncoder().encode(JSON.stringify(header));
    const out = new Uint8Array(8 + json.length + size);
    out.set(new TextEncoder().encode(MAGIC));
    new DataView(out.buffer).setUint32(4, json.length, true);
    out.set(json, 8);
    let offset = 8 + json.length;
    for (const body of bodies) {
      out.set(body, offset);
      offset += body.length;
    }
    return out;
  };
  return { add, finish };
}

// A file's header and cases from its bytes (a case's answers are read when it's first needed, see caseAnswers)
export function readAnswerFile(data: Uint8Array | ArrayBuffer): AnswerFile {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error("Not an answer file.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header: AnswerFileHeader = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  return { header, cases: new Map(header.cases.map((entry) => [entry.key, entry])), bytes: bytes.subarray(8 + length), read: new Map() };
}

// A case's answers, read once
export function caseAnswers(file: AnswerFile, entry: AnswerFileCase): CaseAnswers {
  let answers = file.read.get(entry);
  if (answers) return answers;
  const { bytes } = file;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(entry.at, true);
  answers = {
    count,
    hold: new Uint8Array(count),
    flags: new Uint8Array(count),
    turns: new Uint8Array(count),
    movesAt: new Uint32Array(count),
    writingTokens: new Uint8Array(count),
    writingAt: new Uint32Array(count),
    plain: new Float64Array(count),
    written: new Float64Array(count),
  };
  let at = entry.at + 4;
  for (let index = 0; index < count; index++) {
    answers.hold[index] = bytes[at];
    answers.flags[index] = bytes[at + 1];
    answers.turns[index] = bytes[at + 2];
    answers.writingTokens[index] = bytes[at + 3];
    answers.plain[index] = view.getUint16(at + 4, true) / 100;
    answers.written[index] = view.getUint16(at + 6, true) / 100;
    answers.movesAt[index] = at + ANSWER_BYTES;
    answers.writingAt[index] = at + ANSWER_BYTES + bytes[at + 2];
    at += ANSWER_BYTES + bytes[at + 2] + bytes[at + 3];
  }
  // A cut file says what it left out of the case (see the writer)
  if (file.header.cut) {
    answers.dropped = file.header.holds.map((): DroppedHold => {
      const u16 = () => {
        const value = view.getUint16(at, true);
        at += 2;
        return value;
      };
      const anyClean = lengthOf(bytes[at]);
      const writingClean = lengthOf(bytes[at + 1]);
      const lengths: DroppedHold["lengths"] = [];
      at += 3;
      for (let left = bytes[at - 1]; left > 0; left--) {
        const turns = bytes[at++];
        lengths.push({ turns, plain: costOf(u16()), written: costOf(u16()), dirtyPlain: costOf(u16()), dirtyWritten: costOf(u16()) });
      }
      const least = () => ((u16() << 16) >> 16) / 100;
      const deeper: number[] = [];
      const deeperHome: number[] = [];
      for (let left = bytes[at++]; left > 0; left--) {
        deeper.push(least());
        deeperHome.push(least());
      }
      const firsts: DroppedHold["firsts"] = [];
      for (let left = bytes[at++]; left > 0; left--) {
        const token = bytes[at++];
        const [after, afterHome, afterTwo, afterTwoHome] = [least(), least(), least(), least()];
        const [plain, written] = [costOf(u16()), costOf(u16())];
        const second = Array.from(bytes.subarray(at + 1, at + 1 + bytes[at]));
        at += 1 + second.length;
        firsts.push({ token, after, afterHome, afterTwo, afterTwoHome, plain, written, second });
      }
      return { anyClean, writingClean, lengths, deeper, deeperHome, firsts };
    });
  }
  file.read.set(entry, answers);
  return answers;
}

// Some of a file's tokens as move text
export function tokensText(file: AnswerFile, at: number, count: number): string {
  let text = "";
  for (let index = 0; index < count; index++) text += (index ? " " : "") + file.header.tokens[file.bytes[at + index]];
  return text;
}
