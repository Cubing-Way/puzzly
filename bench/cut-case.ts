// One case of an answer file cut down (see answer-cut.ts and AnswerFileCut in src/engine/step/answer-file.ts): which of its answers are kept, and what
// the rest leave per hold (DroppedHold), for the step's check that none of them could have made its list
import { caseAnswers, tokensText, FLAG_WRITING, FLAG_CLEAN, FLAG_ANY_CLEAN, FLAG_WRITING_CLEAN, type AnswerFile, type AnswerFileCase, type DroppedHold, type PreparedAnswer } from "../src/engine/step/answer-file.ts";
import { moveOrders } from "../src/engine/step/scoring.ts";
import { leastCostAfter, speedCost, speedFloor, tokenFloors } from "../src/engine/speed/fingering.ts";

// The least a turn adds to any of these costs (its floor less what keeping the rhythm saves it)
const LEAST_TURN = Math.min(...Object.values(tokenFloors()));

// How a file is cut (see AnswerFileCut)
export interface CutRule {
  rank: number;
  margin: number;
  cancelMargin: number;
}

const AXIS: Record<string, string> = { R: "x", L: "x", M: "x", U: "y", D: "y", E: "y", F: "z", B: "z", S: "z" };
const axis = (token: string) => AXIS[token[0].toUpperCase()];

// leastCostAfter remembered per move text: its floor first (quick), the search only when a bar needs it (started over when it gets big)
let memo = new Map<string, { floor: number; exact?: number }>();
function known(text: string): { floor: number; exact?: number } {
  let had = memo.get(text);
  if (!had) {
    if (memo.size > 4_000_000) memo = new Map();
    memo.set(text, (had = { floor: leastCostAfter(text, undefined, -Infinity) }));
  }
  return had;
}
export function least(text: string, bar = Infinity): number {
  const had = known(text);
  if (had.exact !== undefined) return had.exact;
  if (had.floor > bar) return had.floor;
  return (had.exact = leastCostAfter(text));
}

// The same from home: speedCost after its floor (both in Rust once loaded)
let homeMemo = new Map<string, { floor: number; exact?: number }>();
function knownHome(text: string): { floor: number; exact?: number } {
  let had = homeMemo.get(text);
  if (!had) {
    if (homeMemo.size > 4_000_000) homeMemo = new Map();
    homeMemo.set(text, (had = { floor: speedFloor(text) }));
  }
  return had;
}
export function fromHome(text: string, bar = Infinity): number {
  const had = knownHome(text);
  if (had.exact !== undefined) return had.exact;
  if (had.floor > bar) return had.floor;
  return (had.exact = speedCost(text));
}

// Each way a cancel may leave the rest of an answer to the hands: after its first turn or its first two, from any hand position or from home
type Measure = { two: boolean; home: boolean };
const MEASURES: Measure[] = [
  { two: false, home: false },
  { two: false, home: true },
  { two: true, home: false },
  { two: true, home: true },
];
const valueOf = (measure: Measure) => (measure.home ? fromHome : least);
const floorOf = (measure: Measure, text: string) => (measure.home ? knownHome(text) : known(text)).floor;

// A first turn an answer may be made with (see DroppedHold): what may come after it, and after the next turn too, in each order a cancel may have its
// turns in (a first run about one axis in any order; see cancelledFloor) and in its writing
export interface First {
  key: string;
  token: string;
  after: string[];
  afterTwo: string[];
  second: Set<string>;
}

// One answer of the full file: as the writer takes it, its cost (face turns' or writing's, the least), whether it's sure to turn a face to avoid in every
// way it's made (see `dirty` in file-step.ts), its first turns, and each way a cancel may have its turns in (its orders and its writing)
export interface FullAnswer {
  prepared: PreparedAnswer;
  turns: number;
  cost: number;
  dirty: boolean;
  firsts: First[];
  ways: string[][];
}

// A case's answers as the cut sees them
export function prepareCase(file: AnswerFile, entry: AnswerFileCase): FullAnswer[] {
  const read = caseAnswers(file, entry);
  const avoid = file.header.options.avoid;
  const answers: FullAnswer[] = [];
  for (let index = 0; index < read.count; index++) {
    const flags = read.flags[index];
    const moves = tokensText(file, read.movesAt[index], read.turns[index]);
    const writing = flags & FLAG_WRITING ? tokensText(file, read.writingAt[index], read.writingTokens[index]) : null;
    const firsts = new Map<string, First>();
    const ways: string[][] = [];
    const first = (text: string) => {
      const tokens = text.split(" ");
      ways.push(tokens);
      const key = tokens[0];
      const had = firsts.get(key) ?? { key, token: key, after: [], afterTwo: [], second: new Set<string>() };
      if (tokens.length > 1) had.second.add(tokens[1]);
      had.after.push(tokens.slice(1).join(" "));
      had.afterTwo.push(tokens.slice(2).join(" "));
      firsts.set(key, had);
    };
    const list = moves.split(" ");
    for (const order of list.length > 1 && axis(list[0]) === axis(list[1]) ? moveOrders(moves) : [moves]) first(order);
    if (writing !== null) first(writing);
    const plain = read.plain[index];
    const written = read.written[index];
    answers.push({
      prepared: { hold: read.hold[index], moves, writing, plain, written, clean: !!(flags & FLAG_CLEAN), anyClean: !!(flags & FLAG_ANY_CLEAN), writingClean: !!(flags & FLAG_WRITING_CLEAN) },
      turns: read.turns[index],
      cost: Math.min(plain, writing === null ? Infinity : written),
      dirty: avoid.length > 0 && !(flags & FLAG_CLEAN) && !(writing !== null && flags & FLAG_WRITING_CLEAN),
      firsts: [...firsts.values()],
      ways,
    });
  }
  return answers;
}

// One measure of what comes after a first turn of an answer (the least over its orders), exactly up to a bar
const firstOf = (answer: FullAnswer, key: string) => answer.firsts.find((first) => first.key === key)!;
const textsOf = (answer: FullAnswer, key: string, measure: Measure) => (measure.two ? firstOf(answer, key).afterTwo : firstOf(answer, key).after);
const measureOf = (answer: FullAnswer, key: string, measure: Measure, bar = Infinity) => Math.min(...textsOf(answer, key, measure).map((text) => valueOf(measure)(text, bar)));
// The least of it over some answers, exactly: by their floors, each worked out only while its floor is under the least so far
const leastOver = (answers: FullAnswer[], key: string, measure: Measure): number => leastOfTexts(answers.flatMap((answer) => textsOf(answer, key, measure)), measure);
function leastOfTexts(texts: string[], measure: Measure): number {
  // Shortest first: n turns cost at least n of the cheapest turn's floor, so the longer ones are mostly never worked out
  const unique = [...new Set(texts)].map((text) => ({ text, turns: text ? text.split(" ").length : 0 })).sort((a, b) => a.turns - b.turns);
  let lowest = Infinity;
  for (const { text, turns } of unique) {
    if (LEAST_TURN > 0 && turns * LEAST_TURN >= lowest) break;
    if (floorOf(measure, text) >= lowest) continue;
    lowest = Math.min(lowest, valueOf(measure)(text, lowest));
  }
  return lowest;
}

// Per hold (`holds` of them): the answers kept, by cost and by each first turn, and what the rest leave
export function cutCase(answers: FullAnswer[], holds: number, rule: CutRule): { keep: Set<FullAnswer>; dropped: DroppedHold<string>[] } {
  const keep = new Set<FullAnswer>();
  const dropped = Array.from({ length: holds }, (_, hold): DroppedHold<string> => {
    const own = answers.filter((answer) => answer.prepared.hold === hold).sort((a, b) => a.cost - b.cost);
    const summary: DroppedHold<string> = { anyClean: Infinity, writingClean: Infinity, deeper: [], deeperHome: [], lengths: [], firsts: [] };
    for (const answer of own) if (answer.prepared.anyClean) summary.anyClean = Math.min(summary.anyClean, answer.turns);
    if (!own.length) return summary;
    // By cost
    const line = own[Math.min(rule.rank, own.length) - 1].cost + rule.margin;
    for (const answer of own) if (answer.cost <= line) keep.add(answer);
    // By each first turn: the least after it (and after the next turn, from any hand position and from home) over the hold's answers made with it, and
    // those within the margin of it
    for (const key of new Set(own.flatMap((answer) => answer.firsts.map((first) => first.key)))) {
      const made = own.filter((answer) => answer.firsts.some((first) => first.key === key));
      for (const measure of MEASURES) {
        const bar = leastOver(made, key, measure) + rule.cancelMargin;
        for (const answer of made) if (!keep.has(answer) && measureOf(answer, key, measure, bar) <= bar) keep.add(answer);
      }
    }
    // What the rest leave: per length its least costs, per first turn its least costs after, the shortest clean writing
    const rest = own.filter((answer) => !keep.has(answer));
    const lengths = new Map<number, DroppedHold["lengths"][number]>();
    for (const answer of rest) {
      const { plain, writing, writingClean } = answer.prepared;
      const written = writing === null ? Infinity : answer.prepared.written;
      if (writing !== null && writingClean) summary.writingClean = Math.min(summary.writingClean, answer.turns);
      const length = lengths.get(answer.turns) ?? { turns: answer.turns, plain: Infinity, written: Infinity, dirtyPlain: Infinity, dirtyWritten: Infinity };
      lengths.set(answer.turns, length);
      if (answer.dirty) {
        length.dirtyPlain = Math.min(length.dirtyPlain, plain);
        length.dirtyWritten = Math.min(length.dirtyWritten, written);
      } else {
        length.plain = Math.min(length.plain, plain);
        length.written = Math.min(length.written, written);
      }
    }
    summary.lengths = [...lengths.values()].sort((a, b) => a.turns - b.turns);
    // After 3, 4… turns that all join the moves before: the least the rest costs, over every way of every answer left out that long
    for (let turns = 3; ; turns++) {
      const texts = rest.flatMap((answer) => answer.ways.filter((way) => way.length >= turns).map((way) => way.slice(turns).join(" ")));
      if (!texts.length) break;
      summary.deeper.push(leastOfTexts(texts, MEASURES[0]));
      summary.deeperHome.push(leastOfTexts(texts, MEASURES[1]));
    }
    for (const key of new Set(rest.flatMap((answer) => answer.firsts.map((first) => first.key)))) {
      const made = rest.filter((answer) => answer.firsts.some((first) => first.key === key));
      summary.firsts.push({
        token: key,
        after: leastOver(made, key, MEASURES[0]),
        afterHome: leastOver(made, key, MEASURES[1]),
        afterTwo: leastOver(made, key, MEASURES[2]),
        afterTwoHome: leastOver(made, key, MEASURES[3]),
        plain: Math.min(...made.map((answer) => answer.prepared.plain)),
        written: Math.min(...made.map((answer) => (answer.prepared.writing === null ? Infinity : answer.prepared.written))),
        second: [...new Set(made.flatMap((answer) => [...firstOf(answer, key).second]))],
      });
    }
    return summary;
  });
  return { keep, dropped };
}
