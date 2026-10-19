// Method runs: steps in order, each from where the last one left the cube, with lookahead and repeated steps

// Move sequences
import { Alg } from "cubing/alg";
// Alg sets and the turns that line their cases up
import { algSet } from "../algs/sets";
// Piece names and grips
import { gripRotations } from "../core/cube";
// Move text helpers
import { countMoves, joinMoves, joinSteps, joinStep, NO_STEPS, invertMoves, movesAfter, type JoinedSteps } from "../core/moves";
// Loaded cube definition and held cubes
import { heldPattern } from "../core/puzzle";
// Roles, goal text and goal masks
import { mergeGoals, goalFromText, goalToText, splitAlternatives, dropFree, covers } from "../goal/goal";
// Goals named for another grip
import { rotateGoal } from "../goal/grips";
// Offsets a goal counts up to
import { offsetsFromText } from "../goal/offsets";
// Solvable-with moves
import { solvableFromText } from "../goal/solvable";
// Speed cost of a move sequence after the moves before it
import { speedCostAfter } from "../speed/fingering";
// What finding a step's pieces costs
import { hiddenShare, lookCost, newPieces, pieceCount, flipLook, inspectionLook } from "../speed/look";
// Error messages
import { NOTHING_NEW } from "../messages";
// Goal check
import { reachesGoal } from "../step/check";
// Step solvers
import { solveStep, stepCandidates } from "../step/step";
// Engine data shapes
import type { StepConfig, Goal, TableProgress, StepOptions, StepResult, Method, MethodOptions, MethodResult, MethodStepResult } from "../types";

// Most rounds of a repeated method step (a BLD solve needs about 6–10 per piece type)
export const MAX_REPEATS = 60;

// Most extra moves a step compares while it only judges an earlier step's answers (lookahead): there it's solved once per candidate, and a rough
// cost is enough; when the run gets to the step itself it compares all the extra moves it was given
export const JUDGING_EXTRA_MOVES = 1;

// The faces a step avoids when it can, as a list
export function avoided(step: StepConfig): string[] {
  return (step.avoid ?? "").split(" ").filter(Boolean);
}

// An axes text ("x z") as a list
function axesList(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

// The axes a step's answer may make wide turns, slice turns and rotations about, as search options (slices and rotations left out = the wide axes, as
// older method files mean)
export function handTurns(step: StepConfig): Pick<StepOptions, "wideAxes" | "sliceAxes" | "rotationAxes"> {
  const wideAxes = axesList(step.wideAxes ?? "");
  return { wideAxes, sliceAxes: axesList(step.sliceAxes ?? step.wideAxes ?? ""), rotationAxes: axesList(step.rotationAxes ?? step.wideAxes ?? "") };
}

// A result's moves as the hands make them: its wide writing when it has one
export function handsMoves(result: StepResult): string {
  return result.wide ?? result.solution.toString();
}

// A goal's pieces as "orbit piece role" keys, centers left out (they only set the frame)
function pieceKeys(goal: Goal): string[] {
  return Object.entries(dropFree(goal))
    .filter(([orbit]) => orbit !== "CENTERS")
    .flatMap(([orbit, roles]) => Object.entries(roles).map(([piece, role]) => `${orbit} ${piece} ${role}`));
}

// True when earlier pieces (named in the grip a step starts in) cover every piece of a goal, centers left out
function coveredBy(goal: Goal, before: Goal): boolean {
  return Object.entries(dropFree(goal)).every(([orbit, roles]) => orbit === "CENTERS" || Object.entries(roles).every(([piece, role]) => covers(before[orbit]?.[Number(piece)], role)));
}

// How many later steps each place one of step `index`'s alternatives along with pieces of their own: their alternatives, less the pieces all of them
// share, are this step's alternatives (ZB's last pair + EO: a pair slot plus the EO edges). Each of them needs one of those alternatives left for it;
// a later step that only repeats them (CFOP's fourth pair) needs none, as it may find its pieces done already
function laterTakers(steps: StepConfig[], index: number): number {
  // This step's alternatives, each as its sorted piece keys, all of them sorted
  const own = splitAlternatives(steps[index].pieces).map((text) => pieceKeys(goalFromText(text)).sort().join("/"));
  if (own.length < 2) return 0;
  const mine = own.sort().join("|");
  return steps.slice(index + 1).filter((later) => {
    // Its alternatives' pieces, and the ones all of them share
    const alternatives = splitAlternatives(later.pieces).map((text) => pieceKeys(goalFromText(text)));
    const shared = alternatives[0].filter((key) => alternatives.every((alternative) => alternative.includes(key)));
    // What's left of each alternative without the shared pieces, against this step's alternatives
    const rest = alternatives.map((alternative) => alternative.filter((key) => !shared.includes(key)).sort().join("/"));
    return shared.length > 0 && rest.sort().join("|") === mine;
  }).length;
}

// When no more of step `index`'s alternatives are left than later steps need (see laterTakers; e.g. an XCross filled a slot, and ZB's last pair + EO
// needs the last free one), the step is held back: it only asks for the ones earlier steps did, as held (another grip could name a free slot after a done
// one), so it's done with no moves, like CFOP's last pair after an XCross. Its options then, or null when it runs as usual (`before` = earlier pieces
// named in the grip it starts in)
export function heldBack(steps: StepConfig[], index: number, before: Goal): { pieces: string; rotations: string[] } | null {
  const takers = laterTakers(steps, index);
  if (!takers) return null;
  // Its alternatives earlier steps already did
  const alternatives = splitAlternatives(steps[index].pieces);
  const done = alternatives.filter((text) => coveredBy(goalFromText(text), before));
  return done.length && alternatives.length - done.length <= takers ? { pieces: done.join(" | "), rotations: [""] } : null;
}

// Search options for one step of a method, from where earlier steps left the cube (done), with their pieces named in the grip the step starts in (earlier).
// By speed the step pays for finding pieces (see speed/look.ts), and with the step after it (`next`) its answers may leave that step's pieces in sight;
// `previous` = the earlier steps' moves as the hands make them, joined, with where each starts (an answer cancelling into them is scored by what's left of it)
export function methodStepOptions(step: StepConfig, done: string, earlier: Goal, onProgress?: (progress: TableProgress) => void, next?: StepConfig, previous: JoinedSteps = NO_STEPS): StepOptions {
  // Nobody looks at the cube during BLD steps
  const looks = step.rank === "speed" && !step.untouched && !step.buffer && step.style !== "efficiency";
  const nextLooks = next !== undefined && !next.untouched && !next.buffer;
  return {
    generatorMoves: step.moves,
    maxDepth: step.maxDepth ?? undefined,
    rotations: gripRotations(step.grips.bottom, step.grips.anyFront),
    done,
    offsets: offsetsFromText(step.offsets),
    solvableWith: solvableFromText(step.solvableWith ?? ""),
    firstFound: step.firstFound,
    keep: step.keep ? earlier : undefined,
    earlier,
    untouched: step.untouched,
    buffer: step.buffer,
    targetsPerStep: step.targetsPerStep,
    parity: step.parity,
    algs: step.algs || undefined,
    ...(previous.moves ? { previous: previous.moves, previousStarts: previous.starts } : {}),
    ...(looks ? { look: true, ...(nextLooks ? { next: { pieces: next.pieces, rotations: gripRotations(next.grips.bottom, next.grips.anyFront) } } : {}) } : {}),
    onProgress,
  };
}

// Earlier pieces after a step: they follow its grip turn, then the pieces it left for good join them (later roles win; with solvable-with moves,
// pieces those moves would still move stay out, so a later step that keeps earlier pieces doesn't hold them in place)
export function piecesAfter(earlier: Goal, result: Pick<StepResult, "rotation" | "settled">): Goal {
  return mergeGoals(rotateGoal(earlier, result.rotation), goalFromText(result.settled));
}

// The step after step `index`: the same step when it repeats (its next round), else the one after it (none after the last)
export function nextStep(method: Method, index: number): StepConfig | undefined {
  return method.steps[index].repeat ? method.steps[index] : method.steps[index + 1];
}

// What finding a step's pieces costs before its first turn (see speed/look.ts): the pieces its answer adds, named in the grip it starts in, found on the
// cube as `from` leaves it. On a solve's first step (planned in inspection) only what it plans beyond its smallest alternative; nothing for an answer that turns nothing, for a BLD step (nobody looks) or for
// a step ranked for efficiency (turning only). A searched answer written with wide or slice turns pays for moving the centers in its middle too (see
// flipLook), on a first step as well, when a step that looks comes after it
export function stepLook(scramble: string, method: Method, index: number, from: string, before: Goal, result: StepResult): number {
  const step = method.steps[index];
  if (step.untouched || step.buffer || step.style === "efficiency") return 0;
  // An alg from a set is made as solvers learn it, so only a searched answer's writing pays for a flip
  const next = nextStep(method, index);
  const flip = !result.alg && next && !next.untouched && !next.buffer ? flipLook(handsMoves(result), result.solution.toString()) : 0;
  if (!countMoves(result.solution.toString())) return flip;
  // A solve's first step is planned in inspection: it only pays for what it plans beyond its smallest alternative (an XCross's pair)
  if (!from.trim()) return flip + inspectionLook(heldPattern(scramble, from), step.pieces, result.alternative, result.rotation);
  const adds = newPieces(piecesAfter(before, result), rotateGoal(before, result.rotation));
  return flip + (pieceCount(adds) ? lookCost(hiddenShare(heldPattern(scramble, from), rotateGoal(adds, invertMoves(result.rotation)))) : 0);
}

// Run a method's steps in order, each from where the earlier ones left the cube (start = scramble, then options.done).
// A step with lookahead lists its candidate answers and takes the one with the fewest moves over it and its next steps (each of those solved its own way,
// every candidate judged up to the same number of pieces); a step ranked by speed takes its fastest answer, and with lookahead the lowest speed cost over it
// and its next steps, both with what finding each step's pieces costs (see speed/look.ts)
export async function runMethod(scramble: string, method: Method, options: MethodOptions = {}): Promise<MethodResult> {
  const { steps, earlier } = await runMethodRows(scramble, method, options);
  // Steps that cancel into the answer before them are written as one with it, like an XCross and its pair (see joinCancelled)
  return methodTotals(joinCancelled(scramble, method, steps), earlier);
}

// runMethod's rows as each step answered, before steps that cancel are joined (a beam search or method search starts from these, counted step by step),
// and every step's pieces, named in the grip the run ends in
export async function runMethodRows(scramble: string, method: Method, options: MethodOptions = {}): Promise<{ steps: MethodStepResult[]; earlier: Goal }> {
  const steps: MethodStepResult[] = [];
  // Moves after the scramble so far, always passed as done (never folded into the scramble), so only their x, y, z change the grip
  let done = options.done ?? "";
  // Every earlier step's pieces, named in the grip the next step starts in
  let earlier: Goal = {};
  // Every earlier step's moves as the hands make them, joined as the solution joins them (a step's answer may cancel into them), with where each starts
  let previous: JoinedSteps = NO_STEPS;
  // The step after step `index` (see nextStep)
  const nextOf = (index: number): StepConfig | undefined => nextStep(method, index);
  // What finding a step's pieces costs before its first turn (see stepLook)
  const lookFor = (index: number, from: string, before: Goal, result: StepResult): number => stepLook(scramble, method, index, from, before, result);
  // Each step's own answer (its shortest, or by speed its fastest) from a given state, solved once per run (lookahead visits many states, and the run itself may reach one of them again);
  // `previous` = the earlier steps' moves as the hands make them, joined, with where each starts
  const ownAnswers = new Map<string, Promise<StepResult>>();
  const solveOwn = (index: number, from: string, before: Goal, previous: JoinedSteps, judging = false): Promise<StepResult> => {
    // Extra moves it compares: fewer while it judges another step's answers (that answer is kept apart from its full one when they differ)
    const extraMoves = judging ? Math.min(method.steps[index].extraMoves ?? 0, JUDGING_EXTRA_MOVES) : (method.steps[index].extraMoves ?? 0);
    const key = `${index}\n${extraMoves}\n${from}\n${goalToText(before)}\n${previous.moves}\n${previous.starts.join(",")}`;
    let answer = ownAnswers.get(key);
    if (!answer) {
      const step = method.steps[index];
      // Held back when later steps need the rest of its alternatives: only the done ones, as held
      const held = heldBack(method.steps, index, before);
      answer = solveStep(scramble, held?.pieces ?? step.pieces, { ...methodStepOptions(step, from, before, options.onProgress, nextOf(index), previous), ...(held ? { rotations: held.rotations } : {}), rank: step.rank, extraMoves, avoid: avoided(step), ...handTurns(step) });
      ownAnswers.set(key, answer);
    }
    return answer;
  };
  // What the next `count` steps after step `index` take, each its own answer, from where `from` leaves the cube, counted by `cost` (moves, or speed cost,
  // each after the steps' moves before it, `previous` at first; Infinity when one of them finds nothing), with `looks` (by speed) what finding each one's
  // pieces costs, which is also given apart; and the pieces the run holds at the end. It stops early once the run holds `until` pieces, so an answer that
  // did a later step's part (an XCross) is judged up to the same point as the others. A repeated step comes back until a round has nothing left (0 moves,
  // or nothing new), then the step after it; those empty rounds don't count, nor does a step with nothing left to do
  const movesAhead = async (index: number, count: number, from: string, before: Goal, previous: JoinedSteps, cost: (solution: string, from: string, previous: JoinedSteps) => number, looks: boolean, until = Infinity): Promise<{ total: number; look: number; pieces: number }> => {
    let total = 0;
    let look = 0;
    // Step that ran last, and whether it runs again next
    let at = index;
    let again = Boolean(method.steps[index].repeat);
    for (let judged = 0; judged < count; ) {
      // Far enough: as many pieces as the runs it's compared with
      if (pieceCount(before) >= until) break;
      const next = again ? at : at + 1;
      if (next >= method.steps.length) break;
      let result: StepResult;
      try {
        result = await solveOwn(next, from, before, previous, true);
      } catch (error) {
        // A repeated step with nothing new left is finished: go on with the next step
        if (again && (error as Error).message === NOTHING_NEW) {
          again = false;
          continue;
        }
        return { total: Infinity, look, pieces: pieceCount(before) };
      }
      const solution = result.solution.toString();
      const moves = countMoves(solution);
      // Same when its round has nothing to do
      if (again && !moves) {
        again = false;
        continue;
      }
      // Finding its pieces, then turning it
      const found = looks ? lookFor(next, from, before, result) : 0;
      look += found;
      total += found + cost(handsMoves(result), from, previous);
      from = joinMoves(from, solution);
      previous = joinStep(previous, handsMoves(result));
      // A step left with nothing to do (no moves and no new pieces: CFOP's last pairs after a bigger XCross) isn't one of the steps judged, so the
      // lookahead goes on to the step that has something to do (the last pair is judged by its OLL)
      const after = piecesAfter(before, result);
      if (moves || pieceCount(after) > pieceCount(before)) judged++;
      before = after;
      at = next;
      again = Boolean(method.steps[next].repeat) && moves > 0;
    }
    return { total, look, pieces: pieceCount(before) };
  };
  for (const [index, step] of method.steps.entries()) {
    // Rounds of this step: one, or with repeat as many as it finds something to do (each listed as "name 1", "name 2"…)
    for (let round = 1; ; round++) {
      options.onStart?.(index, round);
      const started = performance.now();
      // Later steps (or rounds) that judge this step's answers (none past the last step, nor for a step held back: see heldBack)
      const ahead = heldBack(method.steps, index, earlier) ? 0 : step.repeat ? (step.lookahead ?? 0) : Math.min(step.lookahead ?? 0, method.steps.length - 1 - index);
      let result: StepResult;
      let lookahead: MethodStepResult["lookahead"] = null;
      try {
        if (ahead > 0) {
          // Every candidate answer, judged by its own moves (or speed cost) plus the next steps' own answers (all asked at once: the worker answers them in turn)
          const bySpeed = step.rank === "speed";
          // A speed cost counts a rotation before the first turn as free when nothing was turned before the answer (the cube is picked up that way); both
          // costs are counted after the steps' moves before it, so turns that cancel into those count as the joined solution has them
          const cost: (solution: string, from: string, previous: JoinedSteps) => number = bySpeed
            ? (solution, from, previous) => speedCostAfter(solution, previous.moves, undefined, !from.trim(), previous.starts)
            : (solution, _from, previous) => movesAfter(solution, previous.moves);
          const candidates = await stepCandidates(scramble, step.pieces, { ...methodStepOptions(step, done, earlier, options.onProgress, nextOf(index), previous), extraMoves: step.extraMoves ?? 0, rank: step.rank, avoid: avoided(step), ...handTurns(step), ...(step.candidates ? { maxCandidates: step.candidates } : {}) });
          // With faces to avoid, only the answers of the best tier there is are judged (they come first)
          const best = candidates[0]?.tier;
          if (best !== undefined) candidates.length = candidates.filter((candidate) => candidate.tier === best).length;
          // Pieces each candidate leaves done. One that does more (an XCross next to a cross) is judged over fewer steps: up to as many pieces as the ones
          // that do the least hold after all their steps, so every total ends at the same point and the steps it saves (and their looks) count for it
          const counts = candidates.map((candidate) => pieceCount(piecesAfter(earlier, candidate)));
          const fewest = Math.min(...counts);
          // Judged in this order: the ones doing the least first (the first of them to get through its steps sets how far the others go), then the rest
          const order = candidates.map((_, at) => at).sort((a, b) => Number(counts[a] !== fewest) - Number(counts[b] !== fewest) || a - b);
          // Each candidate's own cost (by speed with finding its own pieces) plus what the next steps take after it. A candidate whose own cost is already
          // no lower than the best total so far can't win, whatever comes after it, so the steps after it aren't solved at all
          const totals = candidates.map(() => Infinity);
          const looked = candidates.map(() => 0);
          let lowest = Infinity;
          let until = Infinity;
          for (const at of order) {
            const candidate = candidates[at];
            const ownLook = bySpeed ? lookFor(index, done, earlier, candidate) : 0;
            const own = cost(handsMoves(candidate), done, previous) + ownLook;
            if (own >= lowest) continue;
            const after = await movesAhead(index, ahead, joinMoves(done, candidate.solution.toString()), piecesAfter(earlier, candidate), joinStep(previous, handsMoves(candidate)), cost, bySpeed, until);
            if (until === Infinity && counts[at] === fewest && Number.isFinite(after.total)) until = after.pieces;
            totals[at] = own + after.total;
            looked[at] = ownLook + after.look;
            lowest = Math.min(lowest, totals[at]);
          }
          // The lowest total wins; on a tie the earlier candidate (the step's own best answer comes first)
          const winner = totals.indexOf(Math.min(...totals));
          result = candidates[winner];
          // The winner's total, to two decimals (speed costs are sums of tenths), and by speed how much of it is finding pieces
          const total = Number.isFinite(totals[winner]) ? Math.round(totals[winner] * 100) / 100 : null;
          lookahead = { candidates: candidates.length, steps: ahead, total, ...(bySpeed ? { rank: "speed" as const, look: Math.round(looked[winner] * 100) / 100 } : {}) };
        } else {
          // Search this step from where the last one ended, keeping the earlier pieces if it asks to
          result = await solveOwn(index, done, earlier, previous);
        }
      } catch (error) {
        // A repeated step with nothing new left is finished
        if (round > 1 && (error as Error).message === NOTHING_NEW) break;
        // Say which step found nothing
        throw new Error(`${step.repeat ? `${step.name} ${round}` : step.name}: ${(error as Error).message}`);
      }
      const ms = performance.now() - started;
      const solution = result.solution.toString();
      // A repeated step whose round has nothing to do is finished (its first round is listed even then)
      if (round > 1 && !countMoves(solution)) break;
      // Earlier pieces follow the step's grip turn, then this step's pieces join them (later roles win)
      earlier = piecesAfter(earlier, result);
      // Record the step, checked on its own goal and offsets (and, when it keeps every other piece untouched, on those pieces too)
      const finished = methodRow(scramble, method, index, round, done, result, ms, lookahead);
      steps.push(finished);
      options.onStep?.(finished, index);
      done = joinMoves(done, solution);
      previous = joinStep(previous, handsMoves(result));
      // One round only, or nothing left to do
      if (!step.repeat || !finished.moves) break;
      if (round >= MAX_REPEATS) throw new Error(`${step.name}: still finding something to do after ${MAX_REPEATS} rounds.`);
    }
  }
  // Every step's row as it answered, and the pieces done
  return { steps, earlier };
}

// One finished step of a method run: its result, named (numbered by round for a repeated step), with the moves before it, its offsets and solvable-with moves,
// and the check that it really reaches its goal (and, when it keeps every other piece untouched, that those stay)
export function methodRow(scramble: string, method: Method, index: number, round: number, done: string, result: StepResult, ms: number, lookahead: MethodStepResult["lookahead"]): MethodStepResult {
  const step = method.steps[index];
  const offsets = offsetsFromText(step.offsets);
  const solvableWith = solvableFromText(step.solvableWith ?? "");
  const solution = result.solution.toString();
  const after = joinMoves(done, solution);
  const untouched = result.changed === undefined ? undefined : { from: joinMoves(done, result.rotation), changed: result.changed };
  return {
    ...result,
    name: step.repeat ? `${step.name} ${round}` : step.name,
    step: index,
    done,
    offsets,
    solvableWith,
    moves: countMoves(solution),
    ms,
    ok: reachesGoal(scramble, after, result.pieces, offsets, solvableWith, untouched),
    lookahead,
  };
}

// Whether a step's answer may be written as one with the answer before it: the step keeps every earlier piece (so the joined answer reaches both goals),
// and neither is a BLD step (those keep every other piece as they find it)
function joinable(step: StepConfig, before: StepConfig): boolean {
  return Boolean(step.keep) && !step.untouched && !step.buffer && !before.untouched && !before.buffer;
}

// Whether two answers cancel where they meet: joined, they make fewer moves than both apart (R' then R is nothing, U then U is U2)
function cancels(before: string, moves: string): boolean {
  return countMoves(joinSteps(before, moves)) < countMoves(before) + countMoves(moves);
}

// Whether a step's answer only lines its case up: one of its alg set's turns of the top alone, with no alg (the case was skipped: a PLL skip's AUF)
function onlyLinesUp(step: StepConfig, row: MethodStepResult): boolean {
  const set = step.algs ? algSet(step.algs) : undefined;
  return Boolean(set && !row.alg && set.adjust.includes(row.solution.toString().trim()));
}

// Two rows as one: the first one's step, start and grip turn with both answers joined (as the hands make them too), and the goal, offset and pieces
// done of the second one, where the joined answer now ends
function joinRows(first: MethodStepResult, second: MethodStepResult): MethodStepResult {
  const solution = joinSteps(first.solution.toString(), second.solution.toString());
  const hands = joinSteps(handsMoves(first), handsMoves(second));
  const row: MethodStepResult = { ...first, solution: new Alg(solution), wide: hands, moves: countMoves(solution), pieces: second.pieces, settled: second.settled, offset: second.offset, offsets: second.offsets, solvableWith: second.solvableWith, searches: first.searches + second.searches };
  // A wide writing only where the hands turn differently from the face turns
  if (hands === solution) delete row.wide;
  // The cases of both, when an alg set answered one of them
  const algs = [first.alg, second.alg].filter(Boolean).join(" + ");
  if (algs) row.alg = algs;
  return row;
}

// A row whose answer went to the row before it: done with no moves (its grip turn went too)
function emptied(row: MethodStepResult): MethodStepResult {
  const empty: MethodStepResult = { ...row, solution: new Alg(""), rotation: "", moves: 0 };
  delete empty.wide;
  delete empty.alg;
  return empty;
}

// A method run's rows with steps that cancel written as one, the way an XCross leaves its pair done: where a step's first turns cancel into the answer
// before it, that answer takes its moves (joined) and its goal, and the step is done with no moves (Pair 4 U' R U R' then OLL R U R' U R U2 R' is
// Pair 4 U' R U2 R' U R U2 R', OLL done). After such a join, an alg step left with only the turn that lines its case up (a PLL skip's AUF) goes with it
// too, as it does after an answer that did later steps by itself (the steps between them were done with no moves). Every row then starts where the one
// before it ends, and the rows that changed are checked again on their goals
export function joinCancelled(scramble: string, method: Method, rows: MethodStepResult[]): MethodStepResult[] {
  const out = rows.map((row) => ({ ...row }));
  // The last row with moves (a later one may join it), and the rows changed so far
  let into = -1;
  const changed = new Set<number>();
  for (const [at, row] of out.entries()) {
    const moves = row.solution.toString();
    // Nothing turned: nothing to join (a grip turn alone can't be joined past)
    if (!countMoves(moves)) {
      if (moves.trim()) into = -1;
      continue;
    }
    // Joined with the last answer when they cancel where they meet, or when this step only lines its case up and the steps between them were skipped
    const before = into >= 0 ? out[into] : null;
    const step = method.steps[row.step];
    if (before && joinable(step, method.steps[before.step]) && (cancels(before.solution.toString(), moves) || cancels(handsMoves(before), handsMoves(row)) || (at > into + 1 && onlyLinesUp(step, row)))) {
      out[into] = joinRows(before, row);
      out[at] = emptied(row);
      changed.add(into).add(at);
      continue;
    }
    // Otherwise this answer is the one a later step may join
    into = at;
  }
  if (!changed.size) return out;
  // Each row starts where the one before it now ends (the same cube; rows between a joined answer and the step it took start later)
  for (let at = 1; at < out.length; at++) {
    const done = joinMoves(out[at - 1].done, out[at - 1].solution.toString());
    if (done !== out[at].done) changed.add(at);
    out[at].done = done;
  }
  // The rows that changed, checked on their goals from where they now start
  for (const at of changed) {
    const row = out[at];
    const untouched = row.changed === undefined ? undefined : { from: joinMoves(row.done, row.rotation), changed: row.changed };
    row.ok = reachesGoal(scramble, joinMoves(row.done, row.solution.toString()), row.pieces, row.offsets, row.solvableWith, untouched);
  }
  return out;
}

// A whole method run from its steps: every solution in order, every step's pieces (named in the grip the run ends in), the offset the last step left in, and the totals.
// Where a step starts by turning the layer the step before it ended on, the two turns are made as one (or not at all), so the whole solution can be
// shorter than its steps added up
export function methodTotals(steps: MethodStepResult[], pieces: Goal): MethodResult {
  const solution = joinSteps(...steps.map((step) => step.solution.toString()));
  // The steps as the hands make them, joined, with where each starts (the same as the solution when no step has a wide writing)
  const hands = steps.reduce((joined, step) => joinStep(joined, handsMoves(step)), NO_STEPS);
  return {
    steps,
    solution,
    ...(steps.some((step) => step.wide) ? { wide: hands.moves } : {}),
    starts: hands.starts,
    pieces: goalToText(pieces),
    offset: steps.at(-1)?.offset ?? "",
    moves: countMoves(solution),
    ms: steps.reduce((sum, step) => sum + step.ms, 0),
    ok: steps.every((step) => step.ok),
  };
}
