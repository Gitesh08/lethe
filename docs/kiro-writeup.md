# Kiro write-up (running log)

## lethe-core spec run (running log)

Legend: **[measured]** = observed in this session's runs; **[observed]** = something that happened during the run. Nothing here claims behaviour of Kiro or Crew beyond what occurred in this session.

### What worked
- [observed] The spec flow (requirements -> detailer pass -> design -> tasks) produced a coherent 83-task plan with property-based test tasks interleaved with implementation tasks.

### What needed rewriting or correction during execution
- [observed] Test vector typo: the SHA-256 of `abc` in the tasks text was wrong.
- [observed] `score()` returned a plain array while a requirement asked for a Result; added `scoreChecked`.
- [observed] `TombstoneRecord` lacked the heading line, so byte-exact resurrection was impossible; added a required `raw` field.
- [observed] Requirement 4.7 ("empty demote array") was unsatisfiable because demotion is derived, not persisted; rewritten as a stable demote list.
- [observed] Property modules in `src` imported fast-check and test arbitraries; moved arbitraries into `src/properties/arbitraries`, exposed a separate `./properties` entry, made fast-check an optional peer.
- [observed] Bullet-mode ids are positional, so only the last bullet round-trips; kept as a documented limitation.
- [observed] The PRD figure "~4,800 hot tokens before sleep" is really file tokens. Fixture: 4,778 file tokens, ~1,449 hot at +150 commits, 1,183 hot after sleep = 75.2% saved.
- [observed] Timing assertions were flaky under parallel CPU load (score() 500 engrams failed in 3 of 5 full parallel runs while taking ~25 ms alone). Fix was isolation, not relaxed limits: `*.perf.test.ts` files run serially in a single fork after the parallel unit pass; thresholds unchanged.

### PBT findings (shrunk counterexamples)
- **P3** (reinforcement never lowers R at the same instant). Counterexample: state with stability 69.14566028517173, lastReinforcedCommit 4167, plus an out-of-order event at commit 0, at 1991-05-06T19:24:18.122Z. R fell 1 -> 3.02e-14 (seed -2088453525). Cause: `reinforce()` kept the later commit but overwrote the timestamp with the older event's. Fix: keep the later ISO timestamp; regression test added.
- **P11** (detect output canonical, one report per (axis, a.id, b.id)). Counterexample: two active specs both named `spec-0` with stances `test:jest` / `test:mocha`, plus an engram "Use Vitest." produced a duplicate report (seed -454708062). Cause: same-named specs shared one synthetic side id. Fix: merge same-named active specs into one side; regression test added.

### Metrics
- [measured] 12/12 properties implemented and green; run counts verified through `fc.check` details at `FC_NUM_RUNS=1000`.
- [measured] `score()` on 500 engrams, 500 events: median ~24-26 ms when run alone in the serial perf pass, against the 50 ms limit.
- [measured] Other perf medians (serial pass): detectContradictions(500) ~25 ms, findDuplicates(500) ~31-35 ms, runConsolidation(500, 2 files) ~218-241 ms.
- [measured] 412+ tests in the suite.
