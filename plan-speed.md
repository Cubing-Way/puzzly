# puzzly — faster solves (context for new chats)

Start a new chat with: "Read plan-speed.md, then do Part N." Do **one part per chat**, then tick it below and commit.

This plan is about **where and how** the engine runs, so the slow presets (CFOP levels 2–5, pseudo-slotting, ZBLL) get closer to greedy CFOP. The other open plans: `plan.md` (tables for specific goals), `plan-engine.md`, `plan-puzzles.md`.

## Progress

- [x] Part 1 — Parallel work inside one solve
  - [x] 1. Scoring in a worker while the search worker lists (2026-10-20)
  - [x] 2. Scoring helpers sharing the bar (2026-10-20): the same solves, no gain on this 2-core PC, so they only start on devices with more than 4 threads
  - [x] 3. The lookahead's candidates judged at the same time (2026-10-20)
  - [x] 4. The beam search's partial solves at the same time (2026-10-20)
- [x] Part 2 — The speed model in Rust
  - [x] 1. The model ported to the `search/` crate (2026-10-20)
  - [x] 2. One call per list of answers: done with Part 1 item 1, the scoring worker gets each list in one message (calls into Rust stay one per answer: batching them would save under 0.5%, see *Facts*)
  - [x] 3. Run in Part 1's scoring worker (2026-10-20)
- [ ] Part 3 — Pair answers prepared in advance
  - [x] 1. The pair file for CFOP level 2's pair step, going on past the cap (2026-10-26); level 3's too (also levels 4 and 5, CFCE and ZBLL's pairs, once level 5 dropped its rotations in F2L)
  - [ ] 2. The engine answers a matching request from it
  - [ ] 3–4. What depends on the rest of the cube worked out at the time; other options searched as today
- [ ] Part 4 — A server (optional)
- [ ] Part 5 — Several scrambles at once (optional, for later)

**Order:** 1 → 2: Part 1 moves the scoring into workers, Part 2 then makes it Rust inside those workers. Part 3 doesn't depend on the others. Part 4 only if a faster machine is wanted. Part 5 is optional and for later: it only helps runs of many scrambles (benchmarks), not a single solve.
**Free:** Parts 1–3 and 5 cost nothing. Part 4 needs a machine, and the free ones are only a bit faster than this PC (see Part 4).
**How hard:** 1 medium · 2 medium-hard · 3 medium, plus a run of ~1–2.5 h per set of step options · 4 small, plus hosting · 5 none to small.

## Goal

Lookahead and XCross presets in a few seconds a solve on this PC, with the same solves as today. Estimate for Parts 1–3 together: roughly **3–4× faster** (level 3 from ~18 s to ~5 s).

| Part | Free? | Faster on this PC (estimates, not measured) | Same solves? |
| --- | --- | --- | --- |
| 1 — Parallel inside one solve | Yes | ~1.5–2× (more on PCs with more cores, 5–10× on a 16-core server) | Yes |
| 2 — Speed model in Rust | Yes | ~1.5–2× a solve (the scoring itself 2–5×) | Yes |
| 3 — Pair answers in advance | Yes | Level 2 ~2.5×, level 3 ~1.5× | Yes, when built with the same scoring |
| 4 — Server (optional) | Oracle free tier, or paid | ~1.5× on Oracle's free machine, ~3× on a modern one | Yes |
| 5 — Several scrambles at once (optional, for later) | Yes | ~2× more solves per minute; each solve takes as long as before | Yes |

Rules for every part:
- Same solves as before (the solution text) on CFOP levels 2 and 3, 3 seeded scrambles (`random(77)`), unless the part says otherwise.
- Before / after times on the same scrambles, run back to back: other programs on this PC can make times ~5× higher, so compare CPU time (`process.cpuUsage()`) too.
- **The engine still never knows a step by name.** Whatever a part picks (a table, a worker) comes from the request (pieces, moves, kept pieces), never from a step's or a method's name.
- Say how long the part will take before starting, test what the part asks, then stop.
- When a part is done: tick it, add what was found to *Facts*, update the README.

## Facts (measured 2026-10-20, `main` at 6f1aab5)

3 seeded scrambles (`random(77)`), Node, one thread, with a CPU profile:

- One solve: level 1 ~4 s, level 2 ~9–10 s, level 3 ~17–20 s.
- Where the time goes:

| | Search (Rust / WebAssembly) | Scoring answers (speed model, JavaScript) | of which wide / slice writings | of which look costs |
| --- | --- | --- | --- | --- |
| Level 1 | 39% | 43% | none | 24% |
| Level 2 | 16% | 66% | 31% | 13% |
| Level 3 | 27% | 59% | 28% | 12% |

- So the slow part is scoring how fast each listed answer is to turn, not the search. Level 1 is fast because it has no wide or slice axes (no writings to search) and no lookahead.
- Most of the scoring is the lookahead step's own list of 16 answers, not judging what comes after them: on level 2, 16.4 s against 5.1 s over the 3 solves. One such step lists ~12,800 answers and scores ~36,000 (each answer in each grip that asks for the same pieces).
- Everything runs one thing at a time, on one thread: the scoring on the page's thread, the search in one worker (helpers only for long searches), and the lookahead judges its candidates one after another. That's why more cores don't help today.
- Hottest code: `advance` in `src/engine/speed/fingering.ts` (16–18% of the time alone); cubing.js applying moves to cubes 12–14%.
- A repeated run gives the same solve (since 2026-10-17), so results could be kept by scramble + method.
- This PC: i5-3210M (2012), 2 cores / 4 threads, 6 GB.
- Scripts (gitignored, on this PC): `bench/out/speed-profile.ts` (time per step, worker time by request kind), `bench/out/speed-opt.ts` with a patched engine copy in `bench/out/opt/engine`.
- Also measured, not part of this plan: three small changes in `src/engine/step/step.ts` (the look cost worked out only when an answer can still win, answers scored best first, judging runs without wide / slice writings) gave −15% CPU time with the same solves.

### Part 2 item 1 — the speed model in Rust (2026-10-20)

- `search/src/speed.rs` (+ `speed/model.rs`, `speed/fingering.rs`, `speed/writings.rs`): `SpeedModel`, built from the hand map's JSON, with `cost`, `floor`, `writingFloor`, `cheapestWriting`. Every sum is made in the same order as in TypeScript, so the costs match to the last bit; `fingering` (who makes each move) stays in TypeScript.
- The page loads it: `loadEngine({ wasm })` (the same bytes as the search worker's, one shared chunk), and `fingering.ts` calls Rust once it's loaded, TypeScript otherwise. `src/engine/worker/wasm.ts` loads the Rust code once per thread (in Node the bench runs the worker in the same process: two loads at once would leave two instances).
- Checked: 0 differences from the TypeScript model over ~500k calls in the 3 seeded scrambles × levels 2 and 3, ~280k in `known-algs.js f2l,oll`, and ~40k on every known alg (costs, floors and writings with their text); the same solves.
- Per call: `speedCost` 7.1 → 1.7 µs a move (4.1×), `cheapestWriting` with x y z 4.1 → 1.2 ms an alg (3.3×); the first straight port was only ~2.2×, until the inner loop stopped dividing (state → wrists and class once per state, regrip and grip costs ahead of time).
- Whole solves, 3 scrambles, two runs each back to back: level 2 28.3 → 18.6 s (CPU 28.0 → 18.6 s, 1.5×), level 3 43.3 → 29.3 s (CPU 37.5 → 26.5 s, 1.4×). Still in TypeScript: the look costs (cubing.js), `strained`, moves in other grips, cancels.
- The wasm grew 491 → 569 KB.
- Each answer is still one call per function. Measured after: one call into Rust costs ~0.18 µs by itself (a 9-move answer's cost 12 µs), so the ~500k calls of the 6 solves are ~0.1 s of ~45 s: item 2 alone would save under 0.5%, so it's folded into Part 1 item 1 (a scoring worker gets a whole list anyway). Item 3 needs Part 1's workers.

### Part 1 item 1 — scoring in a worker (2026-10-20)

- Before it, with the Rust model, a profile per step (3 scrambles, seconds): listing (the search worker) is 0.7 s of ~20 s on level 2 and 9.2 s of ~37 s on level 3 (8.4 s of it the first step's XCross listing); the rest is mostly the pairs' lookahead scoring and judging, and building tables.
- `src/engine/step/scoring.ts`: the by-speed scoring moved out of `step.ts` as it was (`makeScorer`: `add` each listed answer in order, `rank` at the end). `src/engine/worker/scoring-client.ts` sends a step's combos once (patterns as their data, twins as places in one list), then each list reply's answers as they come, while the search worker lists the next ones; `finish` brings the ranked answers back. `src/engine/worker/scoring-worker.ts` (`runScoringWorker`) loads the cube definition and the Rust model and runs the same scorer. Answers are scored in the same order as before, so the bars and the results are the same.
- `loadEngine({ scoringWorker })` turns it on (the test bench has `scoring-worker.js`; `bench/record.ts` and `known-algs.ts` a Node thread, `nodeScoringWorker`). Without it the page scores as before, once every answer is listed.
- Checked: the same solves and speeds on levels 2 and 3 (3 scrambles), on the page and in the worker; `known-algs.js f2l,oll` picks the same; the test bench runs level 3 with no console errors.
- Times, 3 scrambles, two runs each back to back (wall time; CPU now counts both threads and stays as it was, ~19 s and ~27 s): level 2 18.6 → 15.7 s (−16%), level 3 29.5 → 19.8 s (−33%, 1.5×). Scoring on the page (no worker) is as before (18.5 s, 29.3 s).
- Since Part 2 item 1: level 2 28.3 → 15.7 s (1.8×), level 3 43.3 → 19.8 s (2.2×).

### Part 1 item 2 — scoring helpers (2026-10-20)

- Splitting a step's answers between independent workers could change the solves: with *avoid F B* (every CFOP preset's pairs) an answer's tier depends on which other answers were scored (a clean answer in the same hold), and which get scored depends on the bar as it was then. So the scoring worker still scores every answer in order, and helpers only work out the expensive parts ahead: in that worker the looks were 22% of its time and the wide / slice writings 28% (scoring 69%).
- `src/engine/worker/scoring-helper.ts` (`runScoringHelper`): the scoring worker hands a free helper the next chunk (64 answers) with its fastest answers so far (its bar then), the helper scores the chunk the same way (its bar moving as the worker's will) and sends back each look and writing, by what it was worked out from. The scoring worker uses a look whenever its combo and moves match, and a writing when its grip and moves match and its own limit would have searched the same way: the Rust (and TypeScript) writing search now also gives the highest lower bound among the places it went on from and the lowest among those it gave up on. Same answer by construction; the TypeScript and Rust searches give the same bounds on every known alg (1,230 searches).
- Reuse: looks 100%; writings 1–12% when chunks went out as soon as they were listed (the bar was still open then), ~52% handed out one at a time when a helper is free, ~77% with the bounds.
- Checked: the same solves and speeds with 0, 1, 2 and 3 helpers (levels 2 and 3, 3 scrambles), the same `known-algs.js f2l,oll` picks.
- Times on this PC (2 cores, 4 threads), 3 scrambles, back to back: 0 helpers level 2 15.5–16.1 s, level 3 19.4–20.4 s; 2 helpers 16.1–16.2 s and 21.4–21.5 s (CPU ~70% more). No gain: since item 1 the search (or the page) and the scoring worker keep both cores busy, so helpers only share them out, and they repeat the control flow the scoring worker keeps (~27% of a chunk). A chunk the helpers worked out costs the scoring worker ~16 ms against ~25 ms alone, so on more cores the big lists should get ~1.5× faster (not measured here).
- So helpers start only on devices reporting more than 4 threads (`SCORING_HELPER_THREADS`): one per 2 threads more, at most 2. Bench: `SCORING_HELPERS=n`.
- The same limit holds for items 3 and 4 on this PC: they need idle cores. Here, doing less work pays more (Part 3; or the looks, which are cubing.js parsing and applying moves).

### Part 1 items 3–4 — lookahead candidates and beam partial solves at the same time (2026-10-20)

- Item 3 (`runMethodRows` in `method/run.ts`): the candidates are judged one after another only until the first of those doing the least gets through its steps (it sets `until`, how far the others go), then all the others at the same time. Their totals then count in order as before (one whose own cost is no lower than the best total so far is still left out, a tie goes to the same one), so the winner is the same; the price is judging a few candidates that would have been skipped.
- Item 4 (`beamSearchMethod` in `method/beam.ts`): a step's partial solves ask for their answers all at once, then they're taken in order as before. A `stop` asked meanwhile counts from the next step on.
- Both rely on the search and scoring workers answering each request the same whatever else is asked (they take them in turn; table plans don't depend on what ran before since 2026-10-17).
- Checked: the same solves and speeds on levels 2 and 3 (3 scrambles; with the scoring worker and with scoring on the page); beam searches give the same best solves, costs and partial solves (CFOP level 1 at width 4 on 3 scrambles, level 2 at width 2 on 2).
- Times on this PC, back to back, with the scoring worker: item 3 level 2 18.5 → 15.6 s (−16%), level 3 ~19.8 s either way; item 4 level 1 at width 4 19.2 → 18.8 s, level 2 at width 2 17.9 s either way. On 2 cores there's little idle time left to fill; more cores would show more (not measured here).
- Part 1 in all, from Part 2 item 1's state, wall time on 3 scrambles: level 2 ~18.6 → 15.6 s, level 3 ~29.5 → 19.8 s.

### Part 3 — how long the pair file takes to build (measured 2026-10-22, `main` at 9af6355)

- Timed with `bench/out/pair-time.ts` (gitignored, bundled next to `scoring.js`): 96 cases, 3 for each target slot × set of other slots filled (4 × 8), seed 5, each a cube with the cross and those slots solved and the pair anywhere else. Each case is level 2's pair step on that one pair: all four fronts (its twins), 3 extra moves, avoid F B, wide and slice turns on x z; no looks, no cancels into the moves before. Two ways: scored against a bar of 16 places (as the lookahead step's own run), and every listed answer scored (no bar).
- Cases: with k other slots filled, the corner on 8−k places × 3 twists and the edge on 8−k places × 2 flips, less the solved one: 383, 293, 215, 149 per target slot and set, 2,056 per slot, 8,224 in all. A case in one slot is a case in another seen from another front, and the step already scores every answer in all four fronts, so one slot's 2,056 cases hold them all.

| | Bar of 16 | Every answer |
| --- | --- | --- |
| Per case, weighted mean (median, slowest) | 0.52 s (0.28, 3.8) | 1.0 s (0.42, 4.2) |
| All 8,224 cases | 1.2 h (CPU 1.5 h) | 2.3 h (CPU 2.6 h) |
| One slot's 2,056 cases | 18 min | 35 min |
| Answers in the file | ~130k | ~8.9M |

- By slots filled (every answer): none 2.0 s and ~2,450 answers a case, one 0.9 s and ~1,070, two 0.5 s and ~480, three 1.0 s and ~220. Tables for a new set of kept pieces: ~0.7 s, once.
- All 128 runs (warm-ups included) reach their goal.
- So "overnight" was too much: ~1–2.5 h for one set of step options. Each set is a file of its own: levels 3–4 (4 extra moves: more answers, not measured), level 1 (no wide or slice turns), level 5 (rotations on x z), pseudo-slotting (offsets).
- The file's size matters more than the time: every answer is ~8.9M (at a rough 30 bytes each, a few hundred MB as text; ~65 MB for one slot). Only the 16 fastest by turning cost aren't enough for the same solves, since looks and cancels re-rank answers at the time; a bar with a margin over the 16th (as much as looks and cancels can change) sits in between.

### Part 3 item 1 — the pair file (2026-10-26, `main` at b088cd9)

- `bench/pairs.ts` (`bench/out/pairs.js [shard] [method] [step]`): one slot's 2,056 cases (the front-right pair; 383, 293 × 3, 215 × 3 and 149 with 0–3 other slots filled), each a cube with the cross and those slots solved and the pair's corner and edge where the case puts them (the other pieces anywhere: the goal hides them). Each runs CFOP level 2's `Pair 1` (its moves, grips, 3 extra moves, avoid F B, wide and slice turns on x z, read from the example method) with `pastCut` on and every listed answer scored (no bar), no looks and no cancels into the moves before. `done` is a U turn after the scramble undone, so the grip rotation counts as on any later step.
- Only the target slot is asked for: the step's four alternatives with every other slot named as done before (`earlier`) but not kept, so each alternative keeps only the grip with the target at the front right. That is exactly how the step sees one free slot: searched in its first alternative's grip, scored in the three others as twins. The same case in another slot is listed in the same grip, so the same turn order and the same cuts.
- Results get their score: `StepResult.speed` (by speed: the answer's score as it was ranked), so the file has each answer's turning cost. The Node scoring thread (`bench/node-helper.ts`) now waits for a `limit`'s reply as for a `finish`; before, a list going on past its cap could leave Node free to exit.
- Output: `bench/out/pairs/cfop-level-2-pair-1-{0,1}of2.jsonl` (gitignored), a line of options then a line per case: where the pieces are, the scramble, time, shortest, and every answer as `[solution, wide writing or null, speed, tier]`, fastest first. Tiers are the case's own (with other slots' answers at the time, a hold may get a clean answer from another slot), so the lookup works them out again from the writing (`turnsFaces`, `strained`).
- The run: two shards at once (every other case each) on 2 cores / 4 threads, 37 min (2,187 and 2,217 s; CPU 76 min in all); one shard alone ran ~2.3 s a case in a 21-case pilot, so ~80 min. 5,986,632 answers, 347 MB (~170 KB a case).

| Slots filled | Cases | Time a case | Answers a case | Shortest | Best speed |
| --- | --- | --- | --- | --- | --- |
| 0 | 383 | 2.65 s | 4,125 | 6.10 | 8.45 |
| 1 | 879 | 2.29 s | 3,324 | 6.11 | 8.25 |
| 2 | 645 | 1.78 s | 2,091 | 6.20 | 8.07 |
| 3 | 149 | 1.51 s | 910 | 6.66 | 7.89 |

- Slowest cases 6–8 s: each shard's first case (7.2 and 8.1 s, the Rust code loaded and the first tables built), one at 7.6 s wall but 5.0 s CPU (the PC busy), and the corner twisted in its own slot with the edge home and every other slot filled (6.0–6.2 s, shortest 9 moves). Every case got answers, and the first 16 and every 64th answer after them were checked to reach the goal. The pilot and the run gave the first case the same answer count (4,784) and the same best answer (7.80).
- Against the same step without going on past the cap (`PAST_CUT=0`), on every 8th case (257, two processes at once): 124 of them (48%) listed more answers past the cap (2,563 → 2,950 a case; 42 of 48 with no other slot filled, 2 of 18 with three), but only 3 picks changed. One got faster: the corner twisted in its slot with the edge home, 12.90 → 10.70 (`R U' M' U' Rw' U2 Rw U Rw'` for a 10-move `R U Rw U2 R2 U' R U' Rw' R'`). Two got slower, 9.40 → 12.45 and 10.50 → 11.50, through avoid F B: past the cap the step found a clean answer held as is (13.4 and 16.6), so the faster ones held that way, which turn F, dropped to the lower tier and the pick went to a `y` grip with no clean answer. On average the pick went 8.32 → 8.33 and the top 16 10.68 → 10.67; a case took 2.21 → 2.16 s (every answer is scored either way, so the few extra lists cost little next to it).
- So on level 2's pair step (3 extra moves) going on past the cap hardly changes the answers, and where it does, the tier rule can make the pick slower. The answers it was made for (the triple sexy at 4 extra moves, the anti-sexy at 5) are levels 3–4's.
- Searched pair steps against the file, with a lookup prototype (`bench/out/pair-lookup.ts`, gitignored): the 28 pair steps of 8 seeded CFOP level 2 solves (`random(77)`), each searched and looked up. The lookup finds each free slot's case in the grip that has it at the front right, names its answers for the step's grips (the grip rotation's cost swapped: a rotation leaves the hands at home, so the rest costs the same), keeps those up to the step's shortest + 3, works the tiers out over every slot, ranks and gives the first 16. A case's answers are made ready when the file is read (length, clean or not: the grip rotation changes neither).

| Pair step (28, 16 answers given) | Time a step |
| --- | --- |
| Searched as level 2 runs it (looks, not past the cap) | 339 ms (CPU 358 ms) |
| Searched with the file's options (no looks, no cancels, past the cap) | 297 ms (CPU 313 ms) |
| Looked up in the file (same options) | 1.3 ms (the first few 4–9 ms, warming up) |

- Answers, against the search with the file's options: the same pick in 27 of 28 (the other two answers tie at 7.20 and come in the other order), the same 16 answers in order in 24, the same 16 speeds in 27; every looked-up speed is the model's own on the answer as named in the step's grip. The one that differs (solve 6, Pair 2): the file has a clean answer held as is that the step's shared node budget never reached, so three answers held so that turn F or B (9.25, 9.45, 9.80) drop to the lower tier and the lookup's 16 go on with slower clean ones; same pick.
- Load: parsing a case 1.4 ms, making it ready 20 ms (store that in the file instead); the 63 cases these steps needed read in 2.5 s from the 347 MB of text, so the page needs a compact file.
- Not in the lookup yet: looks (at least the 42 ms between the two searches, since today's also skips going past the cap; worked out at the time for the answers that can still make the 16), cancels into the moves before, and the lookahead's judging runs (pair steps comparing one extra move: the file's answers cut shorter). The 28 steps' own calls were 9.5 s today (1.2 s of the ~6 s each solve took here), 36 ms looked up.
- Still to measure (item 2): the same solves as the searched step. Kept apart for it: a real step's lists share one node budget and one bar over every free slot, and its bound past the cap moves with looks and cancels. So where a searched step's list was cut, the file may hold answers it never reached, and the lookup may pick better ones. Nothing compared yet.

**Level 3's file** (`node bench/out/pairs.js 0/2 2`, `1/2 2`; 2026-10-26). Its pair step lists 4 extra moves instead of 3, the rest as level 2's. The same step, option for option, is the pair step of levels 3 and 4, CFCE's four and ZBLL's `Pair 1`–`3`, so this one file serves all of them.

- The run: two shards at once, 79 min (4,723 and 4,678 s; CPU 159 min in all), 2.1× level 2's. 8,125,840 answers, 477 MB (~230 KB a case).

| Slots filled | Cases | Time a case | Answers a case | Shortest | Best speed |
| --- | --- | --- | --- | --- | --- |
| 0 | 383 | 3.74 s | 4,574 | 6.10 | 8.44 |
| 1 | 879 | 4.67 s | 4,332 | 6.11 | 8.29 |
| 2 | 645 | 4.76 s | 3,527 | 6.20 | 8.11 |
| 3 | 149 | 5.37 s | 1,953 | 6.66 | 7.88 |

- Unlike level 2's, a case takes longer the more slots are filled (level 2: 2.65 → 1.51 s), and its answers drop less (level 2: 4,125 → 910). Slowest 9–12 s: the corner twisted in its own slot with the edge home and every other slot filled (12.2 s), and other cases with two or three slots filled.
- Against level 2's file, case by case: the same first answer's speed in 1,909 of 2,056. 66 got faster (by 1.13 on average, at most 5.40; 23 of them with an answer longer than level 2 lists). 81 got slower (by 1.64 on average, at most 6.10), every one through avoid F B: level 2's pick turns F or B, and with one move more the same hold has a clean answer, so it drops to the lower tier. On average 8.20 → 8.23. So within a pair step alone, the fourth extra move takes as much as it gives. Solves with it weren't compared here.

**Level 5 needs no file of its own** (2026-10-26). Its pair step was level 3's with cube rotations on x and z allowed inside an answer (`rotationAxes`: one face turn made as the opposite wide turn with a rotation to make up for it, or an x tilt), ranked for turning only (`style: "efficiency"`, so no looks at all; the file has none anyway). The first 10 cases (no other slot filled) took 30–42 s each and listed 47,500–62,300 answers (level 3: ~4,700), about 85% of them with a cube rotation besides the grip's leading y. The best 3 were level 3's in the 4 cases looked at, but an answer with an x or z made the top 16 in 5 of the first 8 cases (from 5th place). At ~4 MB a case and ~70 bytes an answer, the whole file was heading for ~10 h on two shards and ~6–8 GB.
- So level 5 was changed instead: x and z rotations in F2L make answers no solver would make. Its cross and pairs now make no rotation in the middle of an answer, as levels 1–4 (wide and slice turns that cancel out stay); its last-layer steps keep x and z. Its cross and pairs are now level 4's in the efficiency style, so its pair steps are level 3's file's, and the build was stopped (133 cases done, deleted).
- Level 5 before and after, `node bench/out/rookie.js 1 3` (seeds 1–3, no rookie mistakes either way): 38.4, 27.3, 32.6 s → 22.3, 18.0, 19.8 s a solve (32.8 → 20.0 s, −39%); speed 52.55, 56.60, 52.80 → 57.35, 50.60, 52.80 (54.0 → 53.6); 45, 46, 43 → 49, 48, 43 moves. Seed 1's three-pair XCross was written with single wide turns (`z y2 U2 Rw2 U' Fw U' F2 Rw U2 Lw D' F'`, then a 7-move last pair); the one it takes now (`x2 R U' R' U' B Rw2 D U' R U2 F' R`) leaves a 10-move last pair. Seed 2 made its last two pairs in one 14-move answer with an x tilt and single wide turns (`x' Rw R' U' R U' Lw' U' Lw U2 M' U' Lw L2`); now it makes them one at a time (`R' U' R`, then `L U M U' Lw' U2 Lw U Lw'`).

### The same tables on every device (2026-10-22)

- Found with a user's color-neutral CFOP method: Cross with 14 alternatives (cross to quad XCross), all 24 grips, offsets D D2 D', moves with M E S, lookahead 6 over 64 candidates, 4 extra moves, wide / slice / rotation axes x y z; then pairs, OLL and PLL. It took 900 s on the page the first time, 74 s once the tables were stored, and gave another solve on another computer.
- Cause: split goals got 40M sub-tables where the browser reports 8 GB or more (`navigator.deviceMemory`), 10M elsewhere. A list stops at its node budget (`LIST_NODES`, 1M), and bigger tables use fewer nodes per answer, so the same step listed other answers and could pick another one. A plain search's answer doesn't depend on the tables (IDA* finds the first answer in turn order whatever its bound), only lists do; one core or four gave the same solve.
- Measured in Node, one seeded scramble (`random(77)`), `CORES=4`, Run method: no device memory 56–65 s, 42 moves, the Cross step listing 58k answers; `deviceMemory` 8: 1015 s (~920 s of it building 40M tables before the first list), 40 moves, 84k answers in the same ~1M nodes. Search fastest (beam, width 4) without device memory: 88 s (56 s of it the plain run).
- Now every device plans split goals on 10M sub-tables (`BIG_TABLE_STATES` = `MAX_TABLE_STATES` in `limits.ts`) with a 256 MB cache, and `navigator.deviceMemory` isn't read. After it: `deviceMemory` 8 in Node gives the 42-move solve in 60 s, and the page in a browser reporting 16 GB gives the same 42 moves in 48 s (34 tables built). Devices without 8 GB, and Firefox, Safari and Node, are unchanged.
- The price: 8 GB devices lose the 40M plans' 3–4× fewer search nodes on F2L-type goals (see `plan-engine.md`, Part 8f) and the longer lists they allowed (on this scramble a 2-move-shorter solve). `bench/replay.ts` still measures them with `BIG=40000000`; the bench's `DEVICE_GB` is gone. Tables those devices stored stay in IndexedDB unused until the site's data is cleared.

## Part 1 — Parallel work inside one solve

**Why:** one core works while the other waits.

**Do (one item per chat, each compared with the code before it):**
1. Scoring off the page's thread: a step's listed answers are scored in a worker (today `stepCandidates` scores on the page and gives it a turn every 25 ms). **Done 2026-10-20** (see *Facts*, Part 1 item 1).
2. Several scoring workers: a step's answers split between them, sharing the bar (the score an answer has to beat). **Done 2026-10-20** as scoring helpers (see *Facts*, Part 1 item 2).
3. The lookahead's candidates judged at the same time instead of one after another (today a candidate whose own cost can't win is skipped; at the same time a little of that skipping is lost). **Done 2026-10-20** (see *Facts*, Part 1 items 3–4).
4. The beam search's partial solves at the same time. **Done 2026-10-20** (see *Facts*, Part 1 items 3–4).

**Test:** the same solves; times with 1, 2 and 4 workers.

**Gain:** ~1.5–2× on this PC (2 cores); more on PCs with more cores; 5–10× on a 16-core server (Part 4).

**Size:** medium.

## Part 2 — The speed model in Rust

**Why:** the scoring is ~60% of the time and it's JavaScript; the search crate is already Rust built to WebAssembly.

**Do:**
1. Port `src/engine/speed/fingering.ts` (`speedCost`, `speedFloor`, `writingFloor`, `cheapestWriting`; ~700 lines) to the `search/` crate. **Done 2026-10-20** (see *Facts*, Part 2 item 1).
2. Call it once per list of answers, not once per answer (each call between JavaScript and WebAssembly costs a little).
3. Run it in Part 1's scoring workers.

**Test:** the same costs to two decimals as the TypeScript model, on every answer scored over the 3 scrambles and on `bench/known-algs.ts`; the same solves.

**Gain:** the scoring ~2–5× faster, a whole solve ~1.5–2×.

**Size:** medium-hard.

## Part 3 — Pair answers prepared in advance

**Why:** a pair step's answer depends only on where its corner and edge are and which slots are still free: a few thousand cases per slot. Solved once ahead of time, the step becomes a lookup, like OLL and PLL from their alg sets (a few hundredths of a second today). Same idea as `plan.md` Parts 2–3 (case tables), for pairs.

**Do:**
1. A tool that solves every pair case with the same listing and scoring as the step (its answers up to its extra moves, each with its turning cost), run once and written to a file: ~1–2.5 h on this PC for level 2's options, 20–35 min when only one slot's cases are built (the others are the same cases from another front). The file holds ~130k answers with only each case's 16 fastest, ~8.9M with every answer (a few hundred MB as text); the 16 fastest alone won't give the same solves, since looks and cancels re-rank answers at the time (see *Facts*, Part 3). **Done 2026-10-26** for level 2 with `pastCut`, then level 3's (see *Facts*, Part 3 item 1).
2. The engine loads the file like an alg set and answers a matching request from it: the step's own run and the lookahead's judging runs.
3. What depends on the rest of the cube (finding the pieces, cancels into the moves before) is still worked out at the time.
4. A step with other options than the file was made for (moves, hand-turn axes, extra moves) is searched as today.

**Test:** the same solves as the searched steps; times on levels 2 and 3.

**Gain:** level 2 ~2.5×, level 3 ~1.5× (its slow part is the XCross step, which stays searched).

**Size:** medium, plus a run of ~1–2.5 h on this PC per set of step options (level 2's measured; levels 3–4 have 4 extra moves, so more).

## Part 4 — A server (optional)

**Why:** a faster machine runs the same code faster, and this PC is from 2012.

**Do:**
1. A small Node server around `runMethod` (the engine already runs in Node, see `bench/setup.ts`), with its tables kept on disk. Not the bigger 40M tables: since 2026-10-22 every device uses 10M ones, so the server gives the same solves as the page (see *Facts*).
2. The demo asks the server when a server address is set, and solves in the page otherwise (GitHub Pages stays as it is).
3. A queue: one solve keeps a core busy for seconds.

**Where:**
- Oracle Cloud "Always Free" (4 Arm cores, 24 GB; sign-up with a card, and space isn't always available): ~1.5×.
- A modern PC, or a paid server with dedicated cores: ~3×, more with Part 1.
- Other free hosts (Render, Fly, Hugging Face Spaces…) share weak CPUs: no faster than this PC.
- Serverless functions (Cloudflare Workers, Vercel) don't fit: time limits, and the tables are lost between calls.

**Test:** the same solves as in the page; time per solve.

**Size:** small, plus hosting.

## Part 5 — Several scrambles at once (optional, for later)

**Why:** benchmarks and evaluations solve many scrambles, and each process uses one core. Here each core solves its own scramble, so a single solve takes as long as before: it only helps runs of many scrambles, not the demo. Part 1 is the one that makes a single solve faster.

**Do:**
1. A bench runner that splits a list of scrambles over N Node processes (N = cores), each with its own engine, and collects the results in scramble order.
2. Optional: a GitHub Actions workflow for long benchmark runs (free for a public repo, 4 cores, each faster than this PC's).

**Test:** the same solves as with one process; solves per minute with N = 1, 2 and 4.

**Gain:** ~2× more solves per minute on this PC; each solve takes as long as before.

**Size:** none to small (no engine change).
