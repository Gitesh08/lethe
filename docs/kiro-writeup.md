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

## lethe-mcp spec run

Legend: **[measured]** = observed in this session's runs; **[observed]** = something that happened during the run; **[unverified]** = not yet checked in the IDE. Nothing here claims Kiro or Crew behaviour beyond what occurred in this session.

### Measured numbers
| Item | Result | Limit |
|---|---|---|
| Cold start (spawn `node dist/lethe.mjs serve` to initialize + tools/list), median of 5 after warm-up | 233.8 / 239.6 / 234.1 ms over 3 suite runs, ~234 ms | 500 ms |
| `score` for 500 engrams via MCP round trip, median of 9 | 69.3 / 71.2 / 69.5 ms, ~69.5 ms | 250 ms |
| In-process core `score()` for 500 engrams | 35.8 ms | 50 ms |
| First PBT gate in a cold process (numRuns 100) | 1119 / 1156 / 1142 ms, ~1142 ms; process start to first gate done ~1200 ms | none |
| Bundle `packages/lethe-mcp/dist/lethe.mjs` | 2,101,020 bytes, single ESM file, LF, shebang | none |
| lethe-mcp unit tests (`FC_NUM_RUNS=1000`) | 109 files, 876 passed, 3 skipped (Windows symlink EPERM) | none |
| lethe-mcp perf tests | 12 files, 19 passed, 1 skipped | none |
| lethe-mcp property tests | 14 `*.pbt.test.ts` files, 39 `runProperty`/`fc.assert` call sites | none |
| lethe-core (same run) | 34 unit files / 423 passed; 4 perf files / 9 passed; 5 pbt files, 43 call sites (P1-P12) | none |

Bundle facts [measured]: fast-check sits behind a lazy `init_properties` with exactly 2 call sites (gate runner and failure recorder), so it loads only when the gate runs. The bundle uses no network APIs and reads one env var set (the allow-listed `childEnv`).

### Platform facts that differed from the requirements
- [observed] `@modelcontextprotocol/sdk` 1.32.2: the high-level `McpServer` turns unknown tool names and input-validation failures into plain-text `isError` results. The requirements wanted structured envelopes and a protocol error for unknown tools, so lethe-mcp uses the low-level `Server` with its own ListTools/CallTool handlers. Unknown tool gives JSON-RPC -32602.
- [observed] Hooks use the v1 JSON format in `.kiro/hooks/*.json` (per the docs fetched during the build; legacy `.kiro.hook` is superseded). v1 has no manual-trigger hooks, so on-demand sleep is a manual steering file, `/lethe-sleep`.
- [unverified] Whether PostFileSave fires on user saves, the PostTaskExec stdin payload shape, and the MCP server working directory (assumption A4; `scripts/print-mcp-config.mjs` is the fallback). Milestone 15, the in-IDE probe run by a human, is pending.

### Concurrency and recovery [measured]
- 2 parallel `sleep --apply` x 5 repeats: final bytes equal a single run. The loser waited for the lock and found nothing to do.
- 12 `record` calls during `sleep` x 3 runs: no event lost or double counted.
- Crash recovery injected at every write position (sleep and resurrect): files end all-pre or all-post, never mixed.
- Golden: `sleep --apply` on the haunted fixture equals core `runConsolidation`: hot tokens 1449 to 1183, 11 archived, 3 merged. Resurrect round trip is byte-exact when sections are restored in ascending original position.

### Findings worth telling
- [observed] PBT found that an engram with id `__proto__` was dropped by the `state.json` round trip. The serializer and parser now use null-prototype maps and raw entries; regression test added.
- [observed] Windows lock contention surfaced transient EPERM and a non-atomic path-guard probe as IO_FAILED / PATH_ESCAPE in about 30% of race runs. Fix: retry transient errors within the wait budget. 0 of 70 runs failed afterwards.
- [observed] The spec checkpoint caught that the `--block` parser scope disagreed with Req 13.3.
- [observed] Dogfood: `lethe check` on our own steering reports 5 contradictions, which look like ontology false positives (naming-case rules, an RxJS mention). Reinforcement figures stay labelled "estimated utility".

## lethe-mcp requirement traceability

Generated by `node packages/lethe-mcp/scripts/req-trace.mjs`; do not edit by hand.

| Requirement | Test files |
|---|---|
| Req 1.1 | test/server-contract.unit.test.ts, test/tools-registry-four.unit.test.ts, test/tools-registry.unit.test.ts |
| Req 1.3 | test/server-contract.unit.test.ts, test/server.unit.test.ts, test/summary.pbt.test.ts |
| Req 1.4 | test/tools-descriptions.unit.test.ts, test/tools-score-detect.unit.test.ts, test/tools-sleep-resurrect.unit.test.ts |
| Req 1.5 | test/bundle-stdio.perf.test.ts, test/server-contract.unit.test.ts, test/server.unit.test.ts |
| Req 1.7 | test/layering.unit.test.ts, test/tools-registry-four.unit.test.ts, test/tools-registry.unit.test.ts |
| Req 2.3 | test/ops-score.unit.test.ts |
| Req 2.4 | test/load-workspace.unit.test.ts, test/ops-score.unit.test.ts |
| Req 2.5 | test/ops-score-matrix.unit.test.ts, test/ops-score.unit.test.ts |
| Req 2.6 | test/ops-score-matrix.unit.test.ts, test/tools-descriptions.unit.test.ts, test/tools-score-detect.unit.test.ts |
| Req 2.7 | test/ops-score-matrix.unit.test.ts |
| Req 3.1 | test/tools-score-detect.unit.test.ts |
| Req 3.2 | test/ops-detect-haunted.unit.test.ts, test/ops-detect.unit.test.ts |
| Req 3.3 | test/ops-detect-haunted.unit.test.ts, test/ops-detect.unit.test.ts |
| Req 3.4 | test/ops-detect-haunted.unit.test.ts, test/ops-detect.unit.test.ts |
| Req 3.5 | test/ops-detect.unit.test.ts |
| Req 4.1 | test/tools-sleep-resurrect.unit.test.ts |
| Req 4.2 | test/ops-sleep-order.unit.test.ts, test/ops-sleep.unit.test.ts |
| Req 4.3 | test/ops-sleep.unit.test.ts |
| Req 4.4 | test/ops-sleep-order.unit.test.ts, test/ops-sleep.unit.test.ts |
| Req 4.5 | test/ops-sleep-order.unit.test.ts, test/ops-sleep.unit.test.ts |
| Req 4.6 | test/ops-context.unit.test.ts, test/ops-sleep-apply.unit.test.ts, test/ops-sleep-order.unit.test.ts |
| Req 4.7 | test/ops-sleep.unit.test.ts |
| Req 4.8 | test/sleep-idempotence.unit.test.ts |
| Req 5.1 | test/tools-sleep-resurrect.unit.test.ts |
| Req 5.2 | test/ops-resurrect-matrix.unit.test.ts, test/ops-resurrect.unit.test.ts |
| Req 5.3 | test/ops-resurrect.unit.test.ts |
| Req 5.4 | test/config-ontology.unit.test.ts, test/ops-resurrect.unit.test.ts |
| Req 5.5 | test/checkpoint-d.pbt.test.ts, test/ops-resurrect.unit.test.ts |
| Req 6.1 | test/server-errors.perf.test.ts, test/server-errors.unit.test.ts, test/server.unit.test.ts |
| Req 6.2 | test/server-errors.perf.test.ts, test/server-errors.unit.test.ts |
| Req 6.3 | test/server-errors.unit.test.ts, test/server.unit.test.ts |
| Req 6.4 | test/cli-run.unit.test.ts, test/server-errors.unit.test.ts, test/server.unit.test.ts |
| Req 6.6 | test/server-errors.unit.test.ts, test/server.unit.test.ts |
| Req 7.1 | test/layering.unit.test.ts, test/workspace-fs.unit.test.ts |
| Req 7.2 | test/path-guard.unit.test.ts |
| Req 7.3 | test/path-guard-links.unit.test.ts |
| Req 7.4 | test/path-guard.unit.test.ts |
| Req 7.5 | test/path-guard.unit.test.ts |
| Req 7.7 | test/path-guard.pbt.test.ts |
| Req 8.1 | test/atomic-write.unit.test.ts, test/workspace-fs.unit.test.ts |
| Req 8.2 | test/atomic-write.unit.test.ts, test/workspace-fs.unit.test.ts |
| Req 8.3 | test/backup-naming.unit.test.ts, test/backup.pbt.test.ts, test/backup.unit.test.ts, test/recover.unit.test.ts |
| Req 8.4 | test/ops-sleep-apply.unit.test.ts |
| Req 8.5 | test/faulty-fs.unit.test.ts, test/recovery-e2e.unit.test.ts, test/write-plan-failures.unit.test.ts |
| Req 8.6 | test/ops-resurrect-matrix.unit.test.ts, test/recover.unit.test.ts, test/tombstone-file.unit.test.ts |
| Req 8.7 | test/faulty-fs.unit.test.ts, test/recover.unit.test.ts, test/recovery-e2e.unit.test.ts |
| Req 8.8 | test/stable-json.pbt.test.ts, test/stable-json.unit.test.ts |
| Req 8.9 | test/ops-resurrect-matrix.unit.test.ts, test/sleep-golden.unit.test.ts |
| Req 8.10 | test/journal.unit.test.ts, test/ops-context.unit.test.ts, test/recover.unit.test.ts |
| Req 9.1 | test/lock-race.perf.test.ts, test/lock.unit.test.ts, test/pbt-failures.unit.test.ts |
| Req 9.2 | test/lock-stale.unit.test.ts, test/lock.unit.test.ts |
| Req 9.3 | test/lock-stale.unit.test.ts |
| Req 9.4 | test/lock-stale.unit.test.ts, test/lock.unit.test.ts, test/ops-context.unit.test.ts, test/server-errors.perf.test.ts, test/server-stdio.unit.test.ts |
| Req 9.5 | test/concurrency-sleep.perf.test.ts, test/lock-race.perf.test.ts |
| Req 9.6 | test/concurrency-record-sleep.perf.test.ts, test/ledger-append-fs.unit.test.ts, test/ledger-append-race.perf.test.ts, test/ledger-append.unit.test.ts |
| Req 10.1 | test/load-haunted.integration.test.ts, test/load-workspace.unit.test.ts, test/steering-collect.unit.test.ts, test/steering-load.unit.test.ts |
| Req 10.2 | test/steering-collect.unit.test.ts, test/steering-load.unit.test.ts |
| Req 10.3 | test/specs-derive.unit.test.ts, test/specs-load.unit.test.ts |
| Req 10.4 | test/config-file.unit.test.ts, test/config-ontology.unit.test.ts |
| Req 10.5 | test/config-file.unit.test.ts, test/config-ontology.unit.test.ts |
| Req 10.6 | test/state-file-invalid.unit.test.ts, test/state-file.pbt.test.ts, test/state-file.unit.test.ts |
| Req 10.7 | test/ops-adopt.unit.test.ts, test/state-file.unit.test.ts |
| Req 10.8 | test/ledger-append.unit.test.ts, test/ledger-event.unit.test.ts, test/ledger-file.unit.test.ts |
| Req 10.9 | test/ledger-event.unit.test.ts, test/ledger-file.unit.test.ts, test/ledger-reader.pbt.test.ts, test/ledger-reader.unit.test.ts |
| Req 10.10 | test/ledger-append-fs.unit.test.ts, test/ledger-append-race.perf.test.ts, test/ledger-append.unit.test.ts, test/ops-record-matrix.unit.test.ts |
| Req 10.11 | test/tombstone-file.unit.test.ts |
| Req 10.12 | test/stable-json.pbt.test.ts, test/stable-json.unit.test.ts, test/state-file.pbt.test.ts, test/state-file.unit.test.ts |
| Req 11.1 | test/commit-counter.unit.test.ts |
| Req 11.2 | test/commit-counter-table.unit.test.ts, test/commit-counter.unit.test.ts |
| Req 11.3 | test/cli-args.unit.test.ts, test/cli-run.unit.test.ts, test/commit-counter-table.unit.test.ts, test/commit-counter.unit.test.ts |
| Req 11.4 | test/commit-counter-table.unit.test.ts, test/commit-counter.unit.test.ts |
| Req 11.5 | test/ops-context.unit.test.ts |
| Req 12.1 | test/ops-record.unit.test.ts |
| Req 12.2 | test/ops-record-matrix.unit.test.ts, test/ops-record.unit.test.ts |
| Req 12.3 | test/ops-record-matrix.unit.test.ts, test/ops-record.unit.test.ts |
| Req 12.4 | test/cli-args.unit.test.ts, test/ops-record-matrix.unit.test.ts, test/ops-record.unit.test.ts |
| Req 12.5 | test/ops-record.unit.test.ts |
| Req 12.6 | test/concurrency-record-sleep.perf.test.ts, test/ledger-append-fs.unit.test.ts, test/ledger-reader.pbt.test.ts, test/ledger-reader.unit.test.ts |
| Req 12.7 | test/ops-record-lock.perf.test.ts, test/ops-record-matrix.unit.test.ts, test/ops-record.unit.test.ts |
| Req 13.1 | test/cli-args-table.unit.test.ts, test/cli-args.unit.test.ts, test/process-exit.unit.test.ts |
| Req 13.2 | test/cli-args.unit.test.ts, test/cli-run.unit.test.ts |
| Req 13.3 | test/cli-args.unit.test.ts, test/cli-run-check.unit.test.ts, test/cli-run-matrix.unit.test.ts, test/cli-run-rows.unit.test.ts, test/req-trace.unit.test.ts, test/support/cli-harness.ts |
| Req 13.4 | test/cli-args-table.unit.test.ts, test/cli-args.unit.test.ts, test/cli-run-check.unit.test.ts, test/cli-run-matrix.unit.test.ts, test/req-trace.unit.test.ts, test/support/cli-harness.ts |
| Req 13.5 | test/cli-args-table.unit.test.ts, test/cli-run-check.unit.test.ts, test/cli-run-matrix.unit.test.ts, test/req-trace.unit.test.ts, test/support/cli-harness.ts |
| Req 13.6 | test/cli-run-rows.unit.test.ts, test/kiro-hooks.unit.test.ts |
| Req 13.7 | test/cli-run-check.unit.test.ts, test/cli-run-matrix.unit.test.ts, test/cli-spawn.perf.test.ts, test/helpers/spawn-cli.ts, test/support/cli-harness.ts |
| Req 13.8 | test/cli-run-check.unit.test.ts, test/cli-spawn.perf.test.ts, test/helpers/spawn-cli.ts, test/support/cli-harness.ts |
| Req 13.9 | test/cli-run.unit.test.ts, test/cli-spawn.perf.test.ts, test/helpers/spawn-cli.ts |
| Req 13.10 | test/cli-contract.unit.test.ts |
| Req 14.1 | test/gate.perf.test.ts, test/gate.unit.test.ts, test/ops-sleep.unit.test.ts |
| Req 14.2 | test/gate-failure.pbt.test.ts, test/ops-sleep-apply.unit.test.ts, test/ops-sleep-order.unit.test.ts |
| Req 14.3 | test/gate-failure.pbt.test.ts, test/ops-sleep-apply.unit.test.ts |
| Req 14.4 | test/gate-failure.pbt.test.ts, test/ledger-append-fs.unit.test.ts, test/ops-sleep-apply.unit.test.ts, test/ops-sleep-order.unit.test.ts, test/pbt-failures.unit.test.ts |
| Req 14.5 | test/gate-failure.pbt.test.ts |
| Req 14.6 | test/gate.unit.test.ts, test/lazy-properties.perf.test.ts |
| Req 14.7 | test/gate-failure.pbt.test.ts |
| Req 15.4 | test/kiro-hooks.unit.test.ts |
| Req 16.1 | test/kiro-sleep-steering.unit.test.ts |
| Req 16.2 | test/kiro-sleep-steering.unit.test.ts |
| Req 16.3 | test/kiro-sleep-steering.unit.test.ts |
| Req 16.4 | test/kiro-gitignore.unit.test.ts |
| Req 16.5 | test/kiro-gitignore.unit.test.ts |
| Req 17.1 | test/kiro-mcp-json.unit.test.ts |
| Req 17.2 | test/kiro-mcp-json.unit.test.ts, test/print-mcp-config.unit.test.ts |
| Req 17.3 | test/kiro-mcp-json.unit.test.ts, test/print-mcp-config.unit.test.ts |
| Req 17.4 | test/kiro-mcp-json.unit.test.ts |
| Req 17.5 | test/print-mcp-config.unit.test.ts, test/server-stdio.unit.test.ts |
| Req 18.1 | test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.2 | test/bundle-standalone.perf.test.ts, test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.3 | test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.4 | test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.5 | test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.6 | test/bundle-standalone.perf.test.ts, test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 18.7 | test/bundle.unit.test.ts, test/req-trace.unit.test.ts, test/support/bundle-scan.ts |
| Req 19 | test/cli-stdin.unit.test.ts |
| Req 19.1 | test/bundle-stdio.perf.test.ts, test/process-exit.unit.test.ts, test/server-stdio.unit.test.ts, test/server-stdout.unit.test.ts |
| Req 19.2 | test/server-stdout.unit.test.ts |
| Req 19.3 | test/bundle-stdio.perf.test.ts, test/ops-probe-sample.unit.test.ts, test/ops-probe.unit.test.ts, test/server-stdout.unit.test.ts |
| Req 19.4 | test/ops-probe-sample.unit.test.ts, test/ops-probe.unit.test.ts |
| Req 20.1 | test/ops-probe-sample.unit.test.ts, test/ops-probe.unit.test.ts |
| Req 21.2 | test/server-contract.unit.test.ts, test/server-errors.unit.test.ts |
| Req 21.3 | test/cli-run-check.unit.test.ts, test/cli-run-matrix.unit.test.ts, test/cli-spawn.perf.test.ts, test/helpers/spawn-cli.ts |
| Req 21.4 | test/bundle-stdio.perf.test.ts, test/req-trace.unit.test.ts |
| Req 21.6 | test/concurrency-sleep.perf.test.ts |
| Req 21.7 | test/faulty-fs.unit.test.ts, test/gate-failure.pbt.test.ts, test/recovery-e2e.unit.test.ts |
| Req 21.8 | test/load-haunted.integration.test.ts, test/sleep-golden.unit.test.ts, test/sleep-idempotence.unit.test.ts, test/support/haunted-ws.ts |
| Req 21.9 | test/req-trace.unit.test.ts |
| Req 22.1 | test/bundle.perf.test.ts, test/gate.perf.test.ts, test/layering.unit.test.ts |
| Req 22.2 | test/bundle.perf.test.ts |
| Req 22.3 | test/bundle-backdoor.unit.test.ts |
| Req 23.1 | test/checkpoint-d.pbt.test.ts, test/checkpoint.unit.test.ts |
| Req 23.2 | test/checkpoint-a.pbt.test.ts, test/concurrency-record-sleep.perf.test.ts |
| Req 23.3 | test/checkpoint-f.pbt.test.ts, test/checkpoint.unit.test.ts |
| Req 23.4 | test/checkpoint-a.pbt.test.ts, test/checkpoint-f.pbt.test.ts, test/concurrency-record-sleep.perf.test.ts |
| Req 23.5 | test/ops-score-matrix.unit.test.ts, test/ops-score.unit.test.ts |
| Req 23.6 | test/checkpoint-c.pbt.test.ts |
| Req 23.7 | test/checkpoint-e.pbt.test.ts, test/checkpoint.unit.test.ts, test/ledger-file.unit.test.ts, test/ledger-reader.pbt.test.ts, test/ledger-reader.unit.test.ts |
| Req 23.8 | test/checkpoint-b.pbt.test.ts |
| Req 23.9 | test/checkpoint.unit.test.ts |
| Req 23.10 | test/checkpoint-b.pbt.test.ts, test/ops-adopt-matrix.unit.test.ts, test/sleep-idempotence.unit.test.ts |
| Req 23.11 | test/ops-adopt-matrix.unit.test.ts, test/ops-adopt.unit.test.ts |
| Req 23.12 | test/ops-score.unit.test.ts |
| Req 23.13 | test/commit-counter-table.unit.test.ts, test/ops-score.unit.test.ts |
| REQ-AA-9 | test/specs-derive.unit.test.ts |
| REQ-AA-10 | test/specs-derive.unit.test.ts |
| REQ-AAA-1 | test/specs-load.unit.test.ts |
| REQ-CON-3 | test/specs-derive.unit.test.ts |
| REQ-CRY-3 | test/sleep-golden.unit.test.ts |
| REQ-CRY-7 | test/ops-resurrect.unit.test.ts |
| REQ-DEC-1 | test/checkpoint-c.pbt.test.ts, test/specs-derive.unit.test.ts |
| REQ-DEC-2 | test/checkpoint-c.pbt.test.ts |
| REQ-DEC-4 | test/specs-derive.unit.test.ts, test/specs-load.unit.test.ts |
| REQ-HOK-1 | test/kiro-hooks.unit.test.ts |
| REQ-HOK-2 | test/kiro-hooks.unit.test.ts |
| REQ-HOK-3 | test/kiro-sleep-steering.unit.test.ts |
| REQ-HOK-4 | test/bundle.unit.test.ts, test/kiro-gitignore.unit.test.ts |
| REQ-MCP-1 | test/req-trace.unit.test.ts, test/server-contract.unit.test.ts, test/specs-derive.unit.test.ts, test/tools-registry-four.unit.test.ts, test/tools-registry.unit.test.ts |
| REQ-MCP-2 | test/req-trace.unit.test.ts, test/tools-descriptions.unit.test.ts, test/tools-score-detect.unit.test.ts |
| REQ-MCP-3 | test/kiro-mcp-json.unit.test.ts, test/req-trace.unit.test.ts, test/server-contract.unit.test.ts, test/tools-descriptions.unit.test.ts, test/tools-sleep-resurrect.unit.test.ts |
| REQ-MCP-4 | test/path-guard-links.unit.test.ts, test/path-guard.pbt.test.ts, test/path-guard.unit.test.ts, test/req-trace.unit.test.ts |
| REQ-MCP-5 | test/gate.unit.test.ts, test/lazy-properties.perf.test.ts, test/req-trace.unit.test.ts |
| REQ-MCP-6 | test/req-trace.unit.test.ts, test/server-errors.perf.test.ts, test/server-errors.unit.test.ts, test/server.unit.test.ts |
| REQ-PAR-5 | test/steering-collect.unit.test.ts, test/steering-load.unit.test.ts |
| REQ-PBT-3 | test/gate.unit.test.ts |
| REQ-SBX-1 | test/specs-derive.unit.test.ts |
| REQ-SBX-2 | test/specs-derive.unit.test.ts |
| REQ-X-1 | test/load-workspace.unit.test.ts, test/ops-detect.unit.test.ts, test/ops-score.unit.test.ts |
| REQ-ZZ-2 | test/specs-derive.unit.test.ts |
| REQ-ZZZ-9 | test/specs-load.unit.test.ts |
| NFR-1 | test/bundle.perf.test.ts, test/gate.perf.test.ts |
| NFR-2 | test/bundle-backdoor.unit.test.ts, test/req-trace.unit.test.ts |
| NFR-3 | test/atomic-write.unit.test.ts, test/req-trace.unit.test.ts, test/stable-json.pbt.test.ts, test/state-file.pbt.test.ts |
| NFR-4 | test/bundle-standalone.perf.test.ts |
| INV-3 | test/checkpoint-d.pbt.test.ts, test/recovery-e2e.unit.test.ts, test/sleep-golden.unit.test.ts |
| INV-4 | test/checkpoint-a.pbt.test.ts, test/checkpoint-b.pbt.test.ts, test/concurrency-sleep.perf.test.ts, test/lock-race.perf.test.ts, test/sleep-idempotence.unit.test.ts |
| INV-8 | test/bundle-stdio.perf.test.ts, test/req-trace.unit.test.ts, test/server-stdio.unit.test.ts, test/server-stdout.unit.test.ts, test/stdout-hygiene.unit.test.ts, test/stdout.unit.test.ts |
