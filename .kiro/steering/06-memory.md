---
inclusion: always
---
# 06 — Project Memory Ledger (Living Document)

Kiro agents: read this file first. Update it via the `lethe-memory-ledger` hook or manually after every completed spec task or vibe session. Keep it **short** — this file is always in context. Move anything older than 3 phases into `docs/archive/memory-<n>.md`.

<!-- lethe: pin=true -->
## Project Snapshot
- **Name:** Lethe — biomimetic memory decay + contradiction exorcism for Kiro steering/memory.
- **Hackathon:** Kiroween 2026 · Track: Frankenstein · Bonuses: Best Kiro Crew App, Bonus Blog, Social Blitz, Best Demo.
- **Deadline:** 2026-12-04 (planning note; verify on Devpost).
- **Current phase:** 0 — Ground Truth & Setup
- **Repo state:** vault being added; Angular-era steering (`product.md`, `tech.md`, `structure.md`) is **superseded and must be deleted**.

<!-- lethe: pin=true -->
## Locked Decisions (ADR Summary)
| # | Decision | Reason |
|---|---|---|
| D1 | Monorepo: Bun workspaces + Turborepo | fast installs, native TS |
| D2 | `lethe-core` pure TS, zero deps, shared by MCP/CLI/web | one engine, deterministic, browser-runnable |
| D3 | Web: Next.js 15 (App Router, React 19) + `@xyflow/react` + `motion` + pure CSS (CSS Modules + tokens) | replaces earlier Angular plan; fastest path to polished spatial UI on Vercel |
| D4 | MCP via `@modelcontextprotocol/sdk` + zod, stdio; exactly 4 tools | clear surface, easy to demo |
| D5 | Decay: `R = exp(-Δc/(S·W))`; `S0=5, β=0.5, S_MAX=120, α=0.25, W∈{1,4}`; spec floor 0.50 | simple, explainable, testable |
| D6 | Tiers: Hot ≥ 0.60; Warm 0.25–0.60; Crypt < 0.25 or defeated | thresholds canonical for demo |
| D7 | Contradiction detection = deterministic ontology of mutually exclusive stances; no LLM in engine | determinism + PBT-provable |
| D8 | Mutations are dry-run by default; `apply: true` required; atomic writes; tombstones byte-exact | safety/reversibility |
| D9 | Reinforcement = ledger events (`task_passed`, `spec_cited`, `manual_pin`) matched by globs/cites; labeled "estimated utility" | honest heuristic |
| D10 | Spec mode for core/MCP; steered Vibe mode for web UI | demonstrates SDD vs vibe contrast in write-up |
| D11 | Steering inclusion: `03-rules`, `06-memory` = always; `02-architecture`, `04-design-system` = fileMatch; `01-prd`, `05-phases` = manual | the vault must not itself cause context dementia (dogfood story) |
| D12 | License MIT; repo public; `.kiro/` never ignored | submission requirements |
| D13 | All code written fresh in this hackathon period; no copied code from prior projects | originality rule |

## Active Spec Invariants (Never Violate)
- INV-1 Protected (pinned or active-spec-linked) engrams are never archived; `R ≥ 0.50`.
- INV-2 `0 < R ≤ 1`; decay is monotonic without reinforcement.
- INV-3 Archive → resurrect is lossless.
- INV-4 Consolidation is idempotent and deterministic.
- INV-5 No contradicting pair coexists in Hot/Warm unless flagged `unresolvable`.
- INV-6 Hot tokens ≤ `K` or `budget_infeasible` reported without deleting protected engrams.
- INV-7 `lethe-core` has no IO, no clock, no randomness, no runtime dependencies.
- INV-8 MCP stdout carries protocol only; logs go to stderr.

## Token Budget Targets
| Item | Target |
|---|---|
| Always-included vault tokens (this file + `03-rules`) | ≤ 6,000 combined |
| Demo sandbox Hot tier before sleep | ~4,800 tok |
| Demo sandbox Hot tier after sleep | ≤ 1,300 tok (≥ 70% saved) |
| Per-prompt budget `K` (config default) | 4,000 tok |
| Web first-load JS | ≤ 250 kB gz |
| Score 500 engrams | < 50 ms |

## Verified Platform Facts (fill during Phase 0; do not assume)
| Question | Verified answer | Source / date |
|---|---|---|
| IDE hook file format + events | `.kiro/hooks/<name>.json`, `{version:"v1", hooks:[{name,trigger,matcher?,action:{type:command\|agent},timeout?,enabled?}]}`; triggers SessionStart, Stop, UserPromptSubmit, PreTaskExec, PostTaskExec, PreToolUse, PostToolUse, PostFileCreate/Save/Delete; legacy `.kiro.hook` superseded; no new manual-trigger hooks, use manual steering file (`/<name>`) | kiro.dev/docs/hooks/, kiro.dev/docs/hooks/types/, kiro.dev/docs/hooks/actions/, kiro.dev/docs/mcp/configuration/, fetched 2026-11-09 |
| Hook output → agent | Command hooks get context JSON on stdin; exit 0 → stdout added to agent context; exit 2 blocks PreToolUse/UserPromptSubmit/PreTaskExec; other non-zero → error, stderr sent to agent | same as above, fetched 2026-11-09 |
| MCP config path/schema in Kiro IDE | Workspace `.kiro/settings/mcp.json` (overrides user `~/.kiro/settings/mcp.json`); `mcpServers.<name>` {command,args?,env?,disabled?,autoApprove?,disabledTools?}; hot-reload; `${VAR}` only for approved env vars | same as above, fetched 2026-11-09 |
| MCP TypeScript SDK API | `@modelcontextprotocol/sdk` 1.32.2 (npm `latest`, v1.x maintenance line; v2 is separate pkgs `@modelcontextprotocol/server`/`client`, not used). Peer `zod ^3.25 \|\| ^4`. Imports: `.../server/index.js` (`Server`), `.../server/mcp.js` (`McpServer`, `registerTool`), `.../server/stdio.js` (`StdioServerTransport`), `.../types.js` (`CallToolRequestSchema`, `ListToolsRequestSchema`, `McpError`, `ErrorCode`), `.../client/index.js` (`Client`), `.../inMemory.js` (`InMemoryTransport.createLinkedPair()`). DIFFERS from reqs: high-level `McpServer` turns input-validation failures AND unknown tool names into plain-text `isError` results (not envelopes, not protocol errors); lethe-mcp therefore uses low-level `Server` with own ListTools/CallTool handlers. `z.toJSONSchema(schema,{io:"input"})` (zod 4.6.7) yields `additionalProperties:false` for `.strict()`. Probe bundle (esbuild 0.28.2, SDK+zod+lazy fast-check): 1.57 MB, handshake ~115 ms (Node 24, Windows) | npm registry + SDK v1.x README/docs/src (mcp.ts, inMemory.ts), local probe, 2026-11-09 |
| PostFileSave fires on user saves? / PostTaskExec stdin payload / MCP server cwd | UNVERIFIED - capture with `lethe probe` (spec lethe-mcp, Req 20) | |
| Crew hook events | _TBD_ | |
| Crew heartbeat/cron config | _TBD_ | |
| Crew Lessons storage format | _TBD_ | |
| Crew App manifest/registration | _TBD_ | |
| Hackathon credits available | _TBD_ | |
| Submission-period start date | _TBD_ | Official Rules |
| Exact deadline + timezone | _TBD_ | Devpost |

## Environment Notes
- Windows host + WSL2 (Ubuntu). Kiro Crew installed in WSL (`~/.kiro/crew-python`); ensure `~/.local/bin` is on `PATH`.
- Prefer repo in native WSL FS (`~/lethe`) for speed.
- `kirocrew gateway` serves the dashboard at `http://localhost:5476` when running.

## Open Questions
1. Does Kiro expose enough hook context to list files touched per task, or must `git diff --name-only` be used? (affects D9)
2. Can Crew Lessons be read as files, or only via API? (affects Lessons adapter)
3. Is a separate public repo required for the Crew App bonus, or may it be a folder in the main repo with its own URL?
4. Should `lethe sleep --apply` also back up to `.kiro/lethe/backup/`? (default yes; confirm size impact)
5. Ledger cursor hashes only the last consumed line; a same-length edit to an earlier consumed line is undetected (documented in test/checkpoint-e.pbt.test.ts). Accept, or switch to a rolling prefix hash?
6. `COMMIT_BEFORE_CHECKPOINT` (Req 23.13) — Resolved: raised as a diagnostic by the checkpoint view (ops/view.ts).
7. Sequential single-id resurrect is order-sensitive: restoring in arbitrary order can place a section under a fallback `## Resurrected` heading; ascending `position.index` per file restores byte-exact (test/sleep-golden). Should `resurrect` of multiple matches sort by position, and should docs tell users to restore in that order?

## PBT Findings (the best write-up material — log every one)
| Date | Property | Shrunk counterexample | Root cause | Fix commit |
|---|---|---|---|---|
| 2026-11-09 | P3 (reinforcement never lowers R at the same instant) | state {stability 69.14566028517173, lastReinforcedCommit 4167, lastReinforcedAt 2026-09-14T22:53:08.348Z} + out-of-order event {commit 0, at 1991-05-06T19:24:18.122Z}, W=1, now = state's own commit/time: R fell 1 -> 3.02e-14 (seed -2088453525) | `reinforce()` kept the later commit but set `lastReinforcedAt = ev.at` unconditionally, so an older event moved the time reference backwards and inflated deltaC | `reinforce()` now keeps the later ISO timestamp (`laterIso`); regression test in `test/decay.unit.test.ts`; commit pending |
| 2026-11-09 | P11 (detect output canonical, order-independent, one report per (axis,a.id,b.id)) | two active specs sharing specName "spec-0" with stances ["test:jest"] and ["test:mocha"] vs one engram "Use Vitest." -> duplicate report for the same triple (seed -454708062) | `buildSpecSides` emitted one synthetic side per spec; same-named specs share the synthetic id `spec:<name>`, so the pair was reported twice | `buildSpecSides` merges same-named active specs into one side; regression test in `test/detect.unit.test.ts`; commit pending |
| 2026-11-20 | lethe-mcp state.json round trip (parse after serialize is identity) | one engram with id `__proto__` (stability 0.001, commit 0) -> state dropped on write, then on read (seed -1595000460) | `serializeState` assigned `engrams[id]` on a plain object (`__proto__` set the prototype, key vanished); `parseStateText` read zod `z.record` output, which also drops an own `__proto__` key | serializer uses a null-prototype map; parser iterates the raw JSON entries and re-validates each; regression test in `test/state-file.pbt.test.ts`; commit pending |

## Kiro Usage Insights (for the write-up)
- IDE vs CLI vs Crew differences: _TBD_
- Spec mode: requirements -> detailer pass -> design -> tasks gave a coherent 83-task plan with PBT tasks interleaved. Needed correction in execution: SHA-256('abc') vector typo in tasks text; `score()` vs Result requirement (added `scoreChecked`); TombstoneRecord lacked the heading line, so byte-exact resurrect needed a required `raw`; req 4.7 "empty demote array" was unsatisfiable (demotion is derived, rewritten as stable demote list); properties in src imported fast-check + test arbitraries (moved to `src/properties/arbitraries`, separate `./properties` entry, optional peer); bullet-mode ids are positional, so only the last bullet round-trips (documented limitation); PRD "~4,800 hot tokens before sleep" is really file tokens (fixture: 4,778 file, ~1,449 hot at +150 commits, 1,183 hot after sleep = 75.2% saved).
- Test infra: timing assertions live in `test/*.perf.test.ts`, run serially after the parallel unit pass (`npm test` = `test:unit` then `test:perf`).
- Windows lock flake (not PBT): under 8-process contention `acquireLock` surfaced transient EPERM (open/read of a lock mid-delete) as IO_FAILED, and the path guard's non-atomic exists()->realpath() surfaced a vanished lock as PATH_ESCAPE (~30% of runs). Now both are retried within the wait budget (`io/lock-transient.ts`); persistent ones end as IO_FAILED/PATH_ESCAPE, not LOCKED. 0/70 failures after (test/lock-race.perf, test/lock-transient.unit).
- Vibe mode with steering: prompts that worked: _TBD_
- Dogfood: `lethe check` on this repo reports 5 contradictions in our own steering (03-rules naming kebab/camel vs PascalCase; 01-prd RxJS mention vs signals) — mostly ontology false positives; on-save hook ships enabled (user decision).
- Hooks: workflows automated and time saved: _TBD_
- Steering strategy that mattered most: _TBD_
- Spec checkpoints caught a parser/spec mismatch (`--block` scope) that unit tests had codified; the exit-code contract snapshot made it visible.
- MCP: what it enabled: _TBD_

## Changelog (newest first; one line per entry; max ~25 lines here)
Template — hooks append in this exact shape:
```
- 2026-MM-DD · phase N · [spec|vibe|manual] · <what changed> · Refs: REQ-… · commit <sha7>
```
Entries:
- 2026-11-11 · phase 1 · spec · lethe-mcp spec complete (milestones 1–14): 4-tool MCP server + CLI + single-file bundle; mcp 876 unit/19 perf, core 423 unit/9 perf at 1000 runs; cold start 234 ms, score(500) 69.5 ms MCP / 35.8 ms core, first gate ~1.1 s · Refs: Req 1–23, REQ-MCP-1..6, REQ-HOK-1..4 · commit —
- 2026-11-11 · phase 1 · spec · lethe-mcp milestones 12–13 (Kiro artifacts: mcp.json, 3 v1 hooks, /lethe-sleep steering; concurrency: 2× sleep, record-during-sleep, crash recovery at every write position, no-backdoor scan) green; 869 unit/3 skipped, 19 perf/1 skipped · Refs: Req 8, 9, 15–17, 21, 22 · commit —
- 2026-11-11 · phase 1 · spec · lethe-mcp milestone 11 (single-file bundle dist/lethe.mjs 2100846 B, drift/hygiene/lazy-gate tests, stdio e2e, print-mcp-config) green; 825 unit/3 skipped, 15 perf/1 skipped; cold start 229.0 ms, score(500) 71.8 ms · Refs: Req 18, 21.4, 22 · commit —
- 2026-11-10 · phase 1 · spec · lethe-mcp milestone 10 (CLI: args parser, runner, render/exit codes, entry, spawned tests, contract snapshots) green; 809 unit/3 skipped, 10 perf/1 skipped · Refs: Req 13 · commit —
- 2026-11-10 · phase 1 · spec · lethe-mcp milestone 9 (MCP server: 4 tools on low-level SDK Server, serveStdio, contract + error-code tests, stdout hygiene) green; 781 unit/3 skipped, 6 perf · Refs: Req 1, 6, 19, REQ-MCP-1..6 · commit —
- 2026-11-10 · phase 1 · spec · lethe-mcp milestone 8 (real PBT gate, lazy properties import, gate failure paths) green; 696 unit/3 skipped, 5 perf; first gate ~730-1590 ms cold (two runs) · Refs: Req 14, REQ-PBT-3, REQ-MCP-5 · commit —
- 2026-11-20 · phase 1 · spec · lethe-mcp milestone 7 (ops: score, detect, sleep dry-run+apply, resurrect, adopt, record, probe) green; 520 unit/3 skipped, 3 perf; golden: sleep == core runConsolidation (hot 1449→1183, 11 archived, 3 merged), resurrect round-trip byte-exact · Refs: Req 2–5, 12, 14, 19, 23 · commit —
- 2026-11-10 · phase 1 · spec · lethe-mcp milestones 5–6 (loader, checkpoint state model, journaled write plan, crash recovery, ledger append) green; 425 unit pass/3 skipped (symlink EPERM on Windows), 2 perf pass; checkpoint props (a)–(f) at 1000 runs · Refs: Req 8, 10, 11, 23 · commit —
- 2026-11-10 · phase 1 · spec · lethe-mcp milestones 1–4 (scaffold, envelope/schemas, IO primitives: path-guard, atomic-write, backup, lock, git) green; 184 unit pass/3 skipped (symlink EPERM on Windows), 1 perf pass · Refs: Req 1–9, 11, 19 · commit —
- 2026-11-09 · phase 1 · spec · lethe-core engine complete: parser, decay, contradiction, consolidation, crypt, 12/12 PBTs green (>=1,000 runs), gate, haunted-repo fixture · Refs: REQ-PAR-1..6, REQ-DEC-1..7, REQ-CON-1..6, REQ-CRY-1..7, REQ-PBT-1..4 · commit —
- 2026-11-03 · phase 0 · manual · Context Vault (01–06) authored; stack switched Angular → Next.js · Refs: D3, D11 · commit —

## Ledger Update Protocol (for the `lethe-memory-ledger` hook)
1. After a spec task completes with tests green: append one changelog line; update "Current phase" if a phase gate passed.
2. If a decision changes: edit the ADR table row, never append contradictory rows (this file is subject to Lethe's own contradiction rules).
3. If a PBT failure was found or fixed: add a row to PBT Findings.
4. Do not paste code or long logs here; link to files/commits.
5. Never edit sections marked `pin=true` heading text; edit their contents only.