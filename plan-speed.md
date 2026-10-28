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
- [x] Part 3 — Pair answers prepared in advance
  - [x] 1. The pair file for CFOP level 2's pair step, going on past the cap (2026-10-26); level 3's too (also levels 4 and 5, CFCE and ZBLL's pairs, once level 5 dropped its rotations in F2L)
  - [x] 2. The engine answers a matching request from it (2026-10-27)
  - [x] 3–4. What depends on the rest of the cube worked out at the time; other options searched as today (2026-10-27, with item 2: a method's pair step always has looks and moves before it, so no real request could be answered without them)
  - [x] 5. Cut files for the test bench page (2026-10-27): CFOP level 2's 4.3 MB and level 3's 4.8 MB gzipped (1.8% and 1.4% of the answers, and what the rest leave); a step is answered from one only when nothing it left out could have made its list, else searched, so its answers are always the full file's; no faster yet (it answers about a quarter of the lists), so the page ships none
  - [ ] 6. For later: the full files downloaded once and kept (a desktop app, or the page with a one-time download into the browser's storage), see Part 3 item 6
  - [ ] 7. For later: the first step (cross or XCross) prepared in advance too, after measuring where its time goes and how many cases it has, see Part 3 item 7
- [x] Part 4 — A server (optional): on AWS Lambda (2026-10-27), see the README's *Solve server*
  - [x] 1. The engine on a server, with the full pair answer files and its tables kept while the container lives: the same solves, CFOP level 2 2× and level 3 2.4× faster than this PC
  - [ ] 2. The test bench page asking it when an address is set (apps call `remoteEngine` themselves for now)
  - [x] 3. No queue needed: Lambda starts another container for a request that comes while one is busy (up to 10 in this account)
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
- Still to measure (item 2, measured below in *Part 3 items 2–4*): the same solves as the searched step. Kept apart for it: a real step's lists share one node budget and one bar over every free slot, and its bound past the cap moves with looks and cancels. So where a searched step's list was cut, the file may hold answers it never reached, and the lookup may pick better ones. Nothing compared yet.

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

### Part 3 items 2–4 — the engine answers from the file (2026-10-27, `main` at 532016a)

- `bench/answer-file.ts` (`node bench/out/answer-file.js [pair file]`) makes the engine's file from `bench/pairs.ts`'s shards: per case its key, the worker's measured distance of its combo (it orders a step's combos) and the search's shortest answer (both worked out there, as the step finds them), then each answer as 8 bytes and its tokens: its hold, flags (clean as ordered, in some order, its writing), face turns and writing tokens, both costs to hundredths (for bounds only). Level 2's: 2,056 cases, 5,986,632 answers, 137 MB, 7 min; level 3's: 8,125,840 answers, 188 MB, 10.5 min. Every case's shortest answer and every answer's plain cost matched the `.jsonl`.
- `src/engine/step/answer-file.ts` (the format), `src/engine/step/file-step.ts` (`loadAnswerFile`, `fileCandidates`): `stepCandidates` asks the loaded files after the alg sets. A file stands for a step with the same goal, moves, grips, offsets, faces to avoid and hand-turn axes and no more extra moves (of several, the one made with the fewest); never for a solve's first or last step, BLD, undo-offset or first-found steps, places per alternative (the beam search) or a file whose answers rotate the cube in their middle. `pastCut` doesn't matter: the file went on past the cap, so it holds at least what the step lists. A case is known by what the search sees, the combo's goal and its held cube with the goal's hidden pieces masked, so the engine still never knows a step by name. `plannedCombos` (the page-side half of `stepCombos`) builds the combos without the worker, so a solve whose pair steps all come from the file builds no pair table.
- The answers are ranked as the step's scoring ranks them: the combos in the worker's measured order (from the file), the step's shortest answer first, each answer in each twin grip (its rotation's cost swapped), its look, cancels into the moves before (another order of a first run about one axis may win then, and its writing is searched), the flip, its writing, tiers over every free slot, duplicates by how they leave the cube. Only answers whose lower bound (the file's costs, the least look, floors after a cancel) can still make the list are scored, with the very functions the scorer uses.
- Checked before relying on it: a writing search's cost is `speedCost` of its text to the bit, and is the file's (1,497 writings); in another grip it costs the same, and 8 of 5,988 come out as another writing of equal cost (the answers given are written again, ~0.2 ms each).
- Found on the way, each needed for the same answers:
  - Ties go to the answer listed first, and the search lists in a fixed order: the step's moves in order (`U U2 U' R …`), depth first, of two commuting turns the lower first. So among one combo's answers of one length, the lexicographic order of the answer named in its combo's grip. With the file's own order instead, a list of 16 had its 15th and 16th (both 20.30) the other way round.
  - A free slot already filled (after a lookahead candidate that made two pairs) isn't a case: the step's answer is empty, so it lists nothing else, and it's answered with no search (before that, such steps were searched and built their tables, 1.6 s once in a solve).
  - A grip whose only clean answers are writings is a clean grip only when the step's writing search found one under its bar then (the `most` fastest clean answers listed before it). The writing search gives up by floors, so a writing a little over the bar may still be found (19.49 under a bar of 19.37). Such grips (rare: a judging run's few answers, or a grip where every face-turn answer turns F or B) are replayed that way, searching those writings under that bar. Without it, 2 of 140 judged cubes differed; with a replay that didn't search, 1 list of 16.
- Checked with `bench/answer-check.ts` on seeded solves (`random(77)`): each pair step asked as the method asks it (its list of 16 with all its extra moves, a judging run with one answer and one extra move) and every cube its lookahead judges (after each of the 16 candidates, the next step's judging run), searched as today, searched past the cap, and from the file:

| 3 solves | Lists of 16 | Judging runs | Cubes a lookahead judges |
| --- | --- | --- | --- |
| Level 2: the same answers in order, speeds and tiers | 12 of 12 | 12 of 12 | 137 of 140 |
| Level 2: time a step, searched → file | 503 → 66 ms | 21 → 13 ms | 23 → 6 ms |
| Level 3: the same answers | 12 of 12 (as past the cap; 11 as today, one changes past the cap) | 12 of 12 | 143 of 144 |
| Level 3: time a step | 1,250 → 124 ms | 27 → 15 ms | 27 → 8 ms |

- The 4 that differ are all one kind: two answers that leave the cube the same way (`L R' F2 R L' F2` and `U2 L' R U2 R' L`), of which the step keeps one. The pair file kept the one that was faster with no moves before it; after the step's moves the other cancels into them and wins (11.77 against 13.57). The file would need those duplicates too (a pair file run that writes them).
- Whole solves, `bench/out/pair-solves.ts` (gitignored), 3 seeded scrambles, without and with both files, back to back: the same 12 solutions on levels 2–5.

| 3 solves | Searched | From the files | Pair steps | The cross / XCross step |
| --- | --- | --- | --- | --- |
| Level 2 | 27.4, 23.5 s (CPU 30.6, 29.0 s) | 14.0, 13.9 s (CPU 19.0, 18.8 s) | 13.7 → 2.9 s | 13.6 → 11.1 s |
| Level 3 | 37.0, 30.8 s (CPU 50.7, 47.2 s) | 24.9, 26.4 s (CPU 41.2, 42.1 s) | 11.7 → 2.3 s | 25.1 → 22.5 s |
| Level 4 | 49.4 s (CPU 70.5 s) | 27.3 s (CPU 44.5 s) | (in the XCross's lookahead) | 49.4 → 27.3 s |
| Level 5 | 54.2 s (CPU 76.5 s) | 27.8 s (CPU 43.7 s) | (in the XCross's lookahead) | 54.2 → 27.8 s |

- So level 2 ~1.8× (the estimate was ~2.5×), level 3 ~1.3× (~1.5×), levels 4 and 5 ~1.9×: what's left is mostly the cross / XCross step's own list and scoring, which stays searched, and OLL judging in Pair 4's lookahead. A level 2 solve's lookups are ~1 s (4 lists, ~65 judging runs).
- The engine and the Node bench load the files; the test bench page doesn't (137 and 188 MB). A page file would need only the answers that can make a step's list (a margin for looks and cancels), or one case fetched at a time: cut files, see item 5.

### Part 3 item 5 — cut files for the page (2026-10-27, `main` at c91f4f4)

- A case's answers are packed tightly in cost: keeping per hold those within M of its 16th fastest keeps 2.3% of level 2's answers at M = 0, 11.7% at M = 2 and 51.5% at M = 5, and a margin that holds for every request (looks vary by up to `lookCost(1) − lookCost(0)` = 3, a writing's flip by 2, cancels into the moves before by more) keeps about half. So the cut is a rule of thumb, and the engine checks each step it answers from a cut file: when anything left out could have made the list, the step is searched. Its answers are the full file's either way.
- `bench/answer-cut.ts` (with `bench/cut-case.ts`) keeps per case and hold the answers within `margin` of the `rank`th fastest (and optionally, per first turn, those whose rest after a cancel is cheapest), and writes what the rest leave (`DroppedHold` in `answer-file.ts`): the shortest answer clean in some order (from the full file, so the clean grips are the same), the shortest left-out clean writing, per length the least costs of left-out answers that may be clean and of those sure not to be, per first turn a left-out answer may be made with the least cost of its rest after a cancel (and after two turns) and the tokens that come second, and per hold the least rest after 3, 4… turns.
- The check (`fileCandidates`' end) bounds each left-out group as the full file's own pruning would: by cost with the least look, in its tier, under each bar a writing-only grip was checked with; and, where its first turn joins the moves before, by what's left of those moves (`speedFloor` less what they no longer turn) plus a bound on the rest: `leastCostAfter` (new in `fingering.ts`: the fingering search from any hand position, the first turn's rhythm and the open layers at their least; `speedCost(X + U) ≥ speedFloor(X) + leastCostAfter(U)` held on 2,640 pairs, 1.4 below the cost on average, where `speedFloor` of the rest was ~5 below) or, when what's left ends with a y or z rotation or is nothing, the rest's own `speedCost` (the hands are home then; 12,744 pairs). Turns that cancel completely let the next one join too (an answer starting `R U' R'` after a pair inserted with `R U R'`): those chains are followed from the actual moves before (`cancelsInto` now says whether the joining is still open), with the least rest after two turns per first turn and after 3, 4… per hold.
- Found on the way: floors alone (no regrips) were far too loose (keeping 40–80% still left most steps unprovable); without the second-token lists, following every second turn that could join left 42 of 140 lookahead cubes answered instead of 65 (rank 2, margin 0.5); the check's chains were ~6 ms a lookup until they stopped at the first turn that stays.
- Rules tried on the 159 cases 3 seeded level 2 solves ask (`CASES`, then `answer-check.js` with `CUT` and `FILEONLY`), every answer given the same as the full file's:

| Rule (rank, margin, per first turn) | Kept | Size (all cases, gzipped) | Lists of 16 | Judging runs | Lookahead cubes |
| --- | --- | --- | --- | --- | --- |
| 2, 0.5, none | 0.6% | ~3.7 MB | 1 of 12 | 8 of 12 | 65 of 140 |
| 4, 1, none | 1.8% | 4.3 MB (7.4 MB) | 3 of 12 | 8 of 12 | 70 of 140 |
| 4, 1, cheapest rest after a cancel | 6.5% | 7.5 MB (13.0 MB) | 3 of 12 | 9 of 12 | 83 of 140 |

- Why the others are searched (4, 1, none): lookahead cubes 30 a cancel of 3 or more turns (an answer undoing the step before, bounded by the least rest of any left-out answer), 13 under a writing check's bar, 13 a one-turn cancel, 9 a two-turn cancel; lists mostly by cost (their 16th answer is far down).
- The files (`node bench/out/answer-cut.js <full file> 4 1 -Infinity`, 2 cores / 4 threads): level 2's 108,247 of 5,986,632 answers, 7.41 MB, 4.33 MB gzipped, 14 min; level 3's 113,335 of 8,125,840, 8.07 MB, 4.76 MB gzipped, 21 min. Most of it is what was left out (level 2: kept answers 2.1 MB, first-turn entries 2.9 MB and their second tokens 1.6 MB, lengths and deeper costs 0.5 MB, the header 0.4 MB). Every answer given was the full file's: on 8 seeded level 2 solves 7 of 32 lists answered, 22 of 32 judging runs, 167 of 368 lookahead cubes; on 3 level 3 solves 2 of 12, 9 of 12, 80 of 144.
- Whole solves (`bench/out/pair-solves.ts`, 3 seeded scrambles, back to back): the same 6 solutions searched, from the full files and from the cut files, but **no faster** with the cut files: level 2 31.5 s searched, 19.9 s from the full file, 32.9 s from the cut file (again in the other order: cut 31.6 s, searched 30.4 s); level 3 41.7, 38.7 and 42.0 s. A cut file answers the cheap steps (a judging run or lookahead cube searched in ~20–40 ms, looked up in ~10 ms) about half the time, and the expensive ones (a list of 16 searched in 600–900 ms) a quarter of the time; a lookup that ends searched costs its ~10 ms on top of the search.
- So the page has the same answers and nothing to gain yet. To gain, a cut file would have to answer most lists: their 16th answer is far down every hold, and the bounds of what's left out (looks at their least, `leastCostAfter` ~1.4 under a rest's cost, chains of cancels bounded by the whole hold's least rest) are loose next to it. What the files are made of points the way: two thirds of each is the summary of what was left out, so slimmer summaries (fewer first-turn entries, their costs relative to the hold's) would leave room for many more kept answers; a 3+-turn chain bound per first turn, or per few-turn prefix, would answer most of the lookahead cubes searched now.
- The page fetches `answers/answers.json` and each file listed there after `loadEngine` (`loadAnswers` in `src/demo/app.ts`), without waiting for them; a file in `src/demo/page/answers/` is copied by the build and served by Pages. Since the cut files gain nothing, none is shipped (the list is empty); `answer-cut.js` writes them there and lists them again.

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
2. The engine loads the file like an alg set and answers a matching request from it: the step's own run and the lookahead's judging runs. **Done 2026-10-27** (see *Facts*, Part 3 items 2–4).
3. What depends on the rest of the cube (finding the pieces, cancels into the moves before) is still worked out at the time. **Done 2026-10-27**, with item 2.
4. A step with other options than the file was made for (moves, hand-turn axes, extra moves) is searched as today. **Done 2026-10-27**, with item 2.
5. Cut files small enough for the test bench page. **Done 2026-10-27, but no faster** (see *Facts*, Part 3 item 5): they answer about a quarter of the lists, and a lookup that ends up searched adds ~10 ms. So none is shipped: `answers/answers.json` lists none, and `bench/answer-cut.ts` makes them again.
6. **For later:** the full files downloaded once and kept, instead of cut files. The full files are what make solves faster (level 2 31.5 → 19.9 s on 3 seeded scrambles); only their size kept them off the page. Gzipped they're 65 MB (level 2) and 90 MB (level 3), unzipped in 1.4 and 1.9 s; loaded, they take ~325 MB of memory. Either:
   - a desktop app (Electron or similar) that ships them or downloads them on first run, keeps them on disk and passes them to `loadEngine({ answerFiles })` at start (the engine takes them as they are), or
   - the web page with a "download the solver data" button: fetch the `.gz` files once, keep them in the browser's storage (IndexedDB or the Origin Private File System) so later visits load them from disk, and pass them to `loadEngine`. Fine on desktop browsers; on phones ~325 MB in a tab may get it killed, so there the engine would read only the cases a step needs from storage, keeping just the header (~0.4 MB a file) in memory. That needs an engine change: `fileCandidates` reads a case's answers synchronously, and storage reads are async, so the cases a step will ask for (its combos' keys, known before the lookup) would be read first.
   With either, the cut files and their check (`answer-cut.ts`, `DroppedHold`) can go: the full files give the search's answers with nothing to prove.
7. **For later:** the first step (cross or XCross) prepared in advance too. With the pair files it's most of what's left of a solve: level 2's cross / XCross step took 11.1 s of 3 solves' 14.0 s, level 3's 22.5 of 24.9 s (see *Facts*, Part 3 items 2–4). Finding a shortest cross or XCross is quick (its tables are built in under a second); the time goes into listing its answers up to its extra moves, scoring them by speed (with their writings) and the lookahead judging the next step. It's an easier target than the pairs: as a solve's first step nothing comes before it, so nothing cancels into moves before it (what kept the cut files from answering, item 5), and its grip rotation is free.
   - The cross alone: 190,080 positions per bottom color, ~47,500 counting the same position seen from the 4 fronts as one case. Its answers per case might make a file of tens of MB (a guess, not measured).
   - XCross: ~73M positions per slot (the cross × 24 places of the pair's corner × 16 of its edge), too many to keep them all. Only the "easy" ones the methods take (an XCross within a few moves of the shortest cross) would be kept; any other is searched as today.
   - Still worked out at the time, as for the pairs: what depends on the rest of the cube (finding the next step's pieces after an answer, an XCross pair planned in inspection).
   - Same rule as the pair files: the same answers as the search, so the file holds every answer the step would list (a full file, best kept as item 6 says), or a page-sized one only with a check like item 5's.

   Measure first:
   1. Where the first step's time goes, per level: listing, scoring, writing searches, the lookahead's judging of the next step (if the lookahead is most of it, a file of the step's own answers gains little).
   2. How many cross cases and answers per case a file would hold with each level's options (extra moves, wide and slice axes, any front), and its size.
   3. How many XCross positions are "easy" (within what the methods compare) and how many answers each has, so the file's size can be estimated before building it.
   4. Whether the first step's options differ enough between levels (2, 3, 4, 5, ZBLL) that each needs a file of its own, as the pairs needed two.

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
- **Done on AWS Lambda (2026-10-27):** it fits after all. A request may run up to 15 minutes, and a container keeps its tables between requests until it's dropped after some idle time. The full answer files come with the code (155 MB gzipped; a container starts in 2.2 s). At 3,008 MB arm64 (about 1.7 cores, the most this account allows), CFOP level 2's 3 seeded solves took 10.1 s against 20.3 s here, and level 3's 17.5 s against 42.1 s, the same solutions. The account's US$0.10 a month limits it to roughly 200–360 solves a month: each call reserves its whole 120 s before it runs, so one stopped at the limit is still counted (2026-10-28; see the README's *Solve server*). cubisz sends its plain method runs there since 2026-10-28, its "Computer fastest" ones (minutes a run) staying in the page.

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
