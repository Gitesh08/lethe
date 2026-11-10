# Implementation Plan: lethe-mcp

## Overview

This plan converts the `lethe-mcp` design into sequential, granular coding tasks. Milestones 1-7 cover core follow-ups, the package scaffold, envelope and schemas, IO primitives, the loader, persistence, and transport-agnostic operations; milestones 8-14 cover the gate, MCP tools and server, CLI, packaging, Kiro artifacts, concurrency, and the final quality gate; milestone 15 is optional human verification inside the Kiro IDE.

The implementation language is **TypeScript** (strict, ESM, ES2022, Node 22+), per `03-rules.md`.

Conventions that apply to every task:

- Tests, property tests, and checkpoints are never optional.
- `bun` is not installed; use `npm`, `npx`, and `node`.
- Exact pins only: `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, `esbuild` 0.28.2 (dev), plus the `vitest`, `fast-check`, and `typescript` versions pinned in `packages/lethe-core/package.json`.
- Timing assertions live in `*.perf.test.ts` files and run in a serial `test:perf` pass after the parallel unit pass.
- Any task that uses an external API (MCP SDK, zod, esbuild, Node `fs`/`child_process`) must verify the API against the installed version; do not assume.
- Tasks that run in the same wave touch disjoint files.
- Every file is at most 200 lines and every function at most 40 lines (`03-rules.md` section 3).

---

## Tasks

- [x] 1. Core follow-ups in `packages/lethe-core`
  - Design "Core Follow-ups" C-1 to C-4. Must keep the public-API snapshot test, the import-boundary test, and all 12 properties green at `FC_NUM_RUNS=1000`.

  - [x] 1.1 Implement `deriveSpecStances` (C-1)
    - Create `src/contradiction/spec-stances.ts` exporting `deriveSpecStances(text, compiled)`: split into chunks of at most 8,000 characters at paragraph boundaries, run the existing `scanEngram` per chunk, keep polarity `+` matches, return a sorted de-duplicated list of stance ids. Verify the `scanEngram` and `CompiledOntology` signatures in the installed source; do not assume.
    - _Requirements: Req 10.3, REQ-DEC-4, REQ-CON-1_

  - [x] 1.2 Unit and property tests for `deriveSpecStances`
    - Unit: the haunted spec text yields the ids in `hauntedSpecs()`; negated mentions yield none; a 40 KB text is not truncated by the 8,192-character scan cap.
    - Property: the result is a subset of the ontology's stance ids, sorted, unique, and invariant under permutation of paragraphs.
    - _Requirements: Req 10.3, REQ-CON-1_

  - [x] 1.3 Export `globMatch` and the ontology-aware composition from `src/index.ts` (C-2, C-3)
    - Export `globMatch` from `decay/glob.ts` and `deriveSpecStances` from the package index. Add optional `ontology?: Ontology` to `PipelineInput` so `runConsolidation` honours a user ontology, defaulting to the current behaviour when absent. Update the public-API snapshot deliberately.
    - _Requirements: Req 5.2, Req 4.3, REQ-CRY-7, REQ-CON-5_

  - [x] 1.4 Tests for the new exports and the ontology option
    - Add an export test for `globMatch` and `deriveSpecStances`; add `runConsolidation` tests with and without an ontology (no ontology equals the previous result byte for byte); update the API snapshot; confirm the import-boundary test still passes.
    - _Requirements: Req 5.2, Req 10.3, INV-7_

  - [x] 1.5 Update `.kiro/steering/02-architecture.md` sections 7 and 8.2 (C-4, docs only)
    - Section 7: `state.json` shape with `at` and the `ledger` cursor. Section 8.2: hooks are `v1` JSON files under `.kiro/hooks/*.json`, and the on-demand sleep is a manual steering file instead of a manual hook. No other section changes.
    - _Requirements: Req 10.6, Req 16.1, Req 15.1_

  - [x] 1.6 Checkpoint: core typecheck and full suite
    - Run `npm run typecheck` and the whole lethe-core suite with `FC_NUM_RUNS=1000`; report the test-file count, test count, and the 12/12 property status.

- [x] 2. Package scaffold and rule-enforcement tests
  - Creates `packages/lethe-mcp`. No source logic yet.

  - [x] 2.1 Create `packages/lethe-mcp/package.json`
    - Name, `type: module`, `bin: { lethe: "dist/lethe.mjs" }`, `@lethe/core` workspace dependency, exact-pinned `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7, dev pins `esbuild` 0.28.2 and core's vitest/fast-check/typescript. Scripts: `build`, `typecheck`, `test`, `test:unit`, `test:perf` (`test` runs unit then perf serially). Verify the peer-dependency ranges against the installed SDK.
    - _Requirements: Req 18.1, Req 21.1, NFR-1_

  - [x] 2.2 Create `tsconfig.json` and vitest configs
    - Copy core's strict flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`), ES2022, ESM. Add `vitest.unit.config.ts` (excludes `*.perf.test.ts`) and `vitest.perf.config.ts` (only `*.perf.test.ts`, single worker).
    - _Requirements: Req 21.1, Rules-1_

  - [x] 2.3 Verify root workspace and turbo wiring; add `.gitattributes`
    - Confirm the root `package.json` workspaces glob and `turbo.json` pipelines pick up `packages/lethe-mcp` for build, typecheck, and test with core built first. Add `.gitattributes` marking `packages/lethe-mcp/dist/lethe.mjs` as `-text linguist-generated=true` so line endings never change. Run `npm install` and report whether the lockfile changed.
    - _Requirements: Req 18.1, Req 18.4, D1_

  - [x] 2.4 Add a placeholder `src/index.ts` and a smoke test
    - Export a version constant only; a test imports `@lethe/core` and the package index to prove the workspace link resolves.
    - _Requirements: Req 21.1_

  - [x] 2.5 Rule-enforcement test: function size and complexity
    - Adapt core's AST test to scan `packages/lethe-mcp/src/**/*.ts`: every function at most 40 lines and cyclomatic complexity at most 10. Reuse the TypeScript compiler API already present in core's tests.
    - _Requirements: Req 22.1, Rules-3_

  - [x] 2.6 Rule-enforcement test: file size, type hygiene, readonly
    - Files at most 200 lines; no `any`, `as any`, non-null `!`, `@ts-ignore`; `@ts-expect-error` only with an explanatory comment; exported interface fields are `readonly`.
    - _Requirements: Req 22.1, Rules-1_

  - [x] 2.7 Rule-enforcement test: import boundary and layering
    - Only `io/workspace-fs.ts` imports `node:fs` for workspace files; `ops/*` do not import `tools/*` or `cli/*`; only `tools/registry.ts` imports the four tool modules; `@lethe/core` imports are by the public entry only (no deep imports).
    - _Requirements: Req 1.7, Req 7.1, Req 22.1_

  - [x] 2.8 Stdout-hygiene test
    - A source scan asserts only `io/stdout.ts` references `process.stdout`, and no `console.log`, `console.info`, or `console.debug` appears in `src`.
    - _Requirements: Req 19.1, INV-8_

  - [x] 2.9 Checkpoint: typecheck and suite
    - Run `npm run typecheck` and `npm test` in `packages/lethe-mcp`; report counts.

- [ ] 3. Envelope, errors, diagnostics, and input schemas
  - Pure modules, no IO.

  - [x] 3.1 Implement `envelope/diagnostics.ts` and `envelope/errors.ts`
    - `Diagnostic` and the `DiagnosticCode` union (including `LEDGER_TORN_TAIL`, `LEDGER_LINE_SKIPPED`, `LEDGER_REWRITTEN`, `FIRST_SEEN_SYNTHESISED`, `COMMIT_BEFORE_CHECKPOINT`, `INTERRUPTED_APPLY_RECOVERED`, `STATE_NOT_UPDATED`); `ToolError`, `mapCoreError()`, `fromUnknown()` that never leaks stack traces. Error codes extend core's stable list.
    - _Requirements: Req 6.1, Req 6.3, Req 10.9, Req 23.5, Rules-4_

  - [x] 3.2 Implement `envelope/envelope.ts`
    - `Envelope`, `ok()`, `fail()`, the summary normaliser (collapse whitespace and newlines to one space; cut at 400 characters with a trailing `…` only when cut), and the JSON text builder used for the text content block.
    - _Requirements: Req 1.3, Req 6.2, REQ-MCP-2_

  - [x] 3.3 Property test for the summary normaliser
    - For all strings (multi-line, unicode, astral, very long), the output has at most 400 characters, no `\n` or `\r`, no leading or trailing whitespace, and ends with `…` only when the input was cut; normalising twice equals normalising once.
    - _Requirements: Req 1.3_

  - [x] 3.4 Implement `tools/schemas-common.ts` and the four exported input schemas
    - `WorkspacePath` (absolute), `IsoInstant` (Z or numeric offset), `Commit` (integer at least 0). The four `.strict()` zod 4 schemas with the field sets and bounds from Requirements 2.1, 3.1, 4.1, and 5.1; export them from `src/index.ts`. Verify `z.toJSONSchema(schema, { io: "input" })` against the installed zod 4.6.7.
    - _Requirements: Req 1.2, Req 1.6, Req 2.1, Req 3.1, Req 4.1, Req 5.1_

  - [x] 3.5 Implement zod-failure mapping to `INVALID_INPUT`
    - Map any `ZodError` to `INVALID_INPUT` with `detail: Array<{ path, message }>` and nothing else.
    - _Requirements: Req 6.6_

  - [x] 3.6 Unit tests for errors, envelope, and schemas
    - Cover: unknown properties rejected for every schema; relative `workspacePath` rejected; `gateRuns` bounds; `query` length 1..500; `skipGate` plus `apply` accepted by the schema (rejected later by the operation); no stack text in any mapped error; `fromUnknown` on non-Error values.
    - _Requirements: Req 1.2, Req 4.1, Req 5.1, Req 6.1, Req 6.6_

  - [~] 3.7 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts.

- [x] 4. IO primitives
  - Each module is tested in isolation; the temp directories come from `os.tmpdir()` and are removed after each test.

  - [x] 4.1 Implement `persist/stable-json.ts`
    - Key-ordered JSON text from an explicit key-order list per file kind: 2-space indent, `\n`, trailing newline, no key reordering beyond the list.
    - _Requirements: Req 8.8, Req 10.12_

  - [x] 4.2 Tests for stable-json
    - Unit: key order and trailing newline. Property: parse then serialise round trip over arbitrary JSON-safe objects, and byte-identical output for deep-equal values built with different insertion orders.
    - _Requirements: Req 8.8, Req 10.12_

  - [x] 4.3 Implement `io/path-guard.ts` (and `io/path-guard-win.ts`)
    - `guardPath(workspace, rel)` and `resolveWorkspace`: NUL, absolute, normalisation escapes, symlink/junction/reparse ancestors via real path, Windows rules (drive-relative, other drives, UNC, `\\?\`, `\\.\`, alternate data streams, trailing dots and spaces), case-insensitive prefix comparison on Windows and macOS, `workspacePath` resolved to a real path once per call.
    - _Requirements: Req 7.1, Req 7.2, Req 7.3, Req 7.4, Req 7.5, Req 7.6_

  - [x] 4.4 Unit tests for path-guard
    - Windows-rule examples (skip on other hosts), `D:\PROJ\Lethe\..` versus `d:\proj\lethe`, symlink and junction escapes created in a temp dir where the OS permits (skip with a recorded reason when link creation is refused).
    - _Requirements: Req 7.2, Req 7.3, Req 7.4, Req 7.5_

  - [x] 4.5 Property test for path-guard (Req 7.7)
    - Generate `rel` from segments drawn from `..`, `.`, names, both separators, and drive-like prefixes; the result is either a path whose real location is inside the Workspace or `PATH_ESCAPE`.
    - _Requirements: Req 7.7_

  - [x] 4.6 Implement `io/workspace-fs.ts` and `io/atomic-write.ts`
    - `workspace-fs.ts` is the only module importing `node:fs` for workspace files; every call passes `guardPath`. `atomicWrite`: temp file in the same directory, write exact content, `fsync`, rename, create parents, remove the temp file on failure and return `IO_FAILED`; include a bounded rename retry for Windows contention. Verify the `node:fs/promises` behaviour on the installed Node version.
    - _Requirements: Req 8.1, Req 8.2, Req 7.1_

  - [x] 4.7 Tests for atomic-write with failure injection
    - Inject failures at write, fsync, and rename; assert the target is unchanged, no temp file remains, and the error is `IO_FAILED`. Assert exact bytes (CRLF, BOM, no trailing newline) survive a write.
    - _Requirements: Req 8.1, Req 8.2_

  - [x] 4.8 Implement `io/backup.ts`
    - Copy pre-images to `.kiro/lethe/backup/<commit>/`, choosing `<commit>-2`, `<commit>-3` when the directory exists; never overwrite; create nothing when no file differs.
    - _Requirements: Req 8.3_

  - [x] 4.9 Tests for backup naming
    - Unit: first backup, collision suffixes, no-op creates no directory, relative layout preserved. Property: for any sequence of N backups at one commit, the directory names are distinct and none is overwritten.
    - _Requirements: Req 8.3_

  - [x] 4.10 Implement `io/lock.ts`
    - Exclusive-create lock file with `{ pid, host, startedAt }`; retry every 50 ms up to a configurable budget (5000 ms default); `LOCKED` with holder detail; stale only when older than 600 s, same host, and pid not running; token-checked release; release on error and on `SIGINT`/`SIGTERM`.
    - _Requirements: Req 9.1, Req 9.2, Req 9.3, Req 9.4_

  - [x] 4.11 Unit tests for the lock
    - Stale detection (dead pid, live pid, foreign host, young lock), retry then `LOCKED`, release only by the holder's token, release in `finally`, signal handler registration and removal.
    - _Requirements: Req 9.2, Req 9.3, Req 9.4_

  - [x] 4.12 Multi-process lock race test
    - Spawn child Node processes that contend for the lock and append to a shared counter file; assert mutual exclusion (no overlapping critical sections, final count equals the number of workers). Mark timing-sensitive parts as `*.perf.test.ts`.
    - _Requirements: Req 9.1, Req 9.5, INV-4_

  - [x] 4.13 Implement `io/git.ts` and `io/child-env.ts`
    - `execFile` wrapper (no shell, timeout, size cap) for `rev-list --count HEAD`, `diff --name-only HEAD`, and `ls-files --others --exclude-standard`; `child-env` returns a scrubbed environment (allow-list; strips tokens and secrets).
    - _Requirements: Req 11.1, Req 12.2, NFR-2_

  - [x] 4.14 Tests for git and child-env
    - Real git in a temp repo (skip if git is absent): count, no commits, not a repo, timeout fallback with an injected slow command, non-integer output; child-env drops variables not on the allow-list and never forwards `*TOKEN*`/`*SECRET*` names.
    - _Requirements: Req 11.1, Req 11.2, Req 12.2_

  - [x] 4.15 Implement and test `io/stdout.ts`
    - Single write function for protocol output and a stderr logger; test that writes go to the right stream and that logs never touch stdout.
    - _Requirements: Req 19.1, Req 19.2, INV-8_

  - [x] 4.16 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite (unit then perf) with `FC_NUM_RUNS=1000`; report counts, and list any tests skipped for OS reasons.

- [x] 5. Loader
  - Turns disk into core inputs. Read-only; no locks.

  - [x] 5.1 Implement `load/steering.ts` (collection and parse)
    - Collect `.kiro/steering/**/*.md` (and specs when requested) in ascending path order, keyed by `/`-separated relative paths, read as UTF-8 without newline translation or BOM stripping; skip files over 1 MiB or invalid UTF-8 with a Diagnostic and mark them never-rewrite; parse with core `parseDocument`.
    - _Requirements: Req 10.1, Req 10.2, REQ-PAR-5_

  - [x] 5.2 Tests for steering collection
    - BOM kept, CRLF kept, 1 MiB boundary (exactly 1 MiB loads, one byte more skips), invalid UTF-8 skipped, ordering, nested folders, non-markdown ignored.
    - _Requirements: Req 10.1, Req 10.2_

  - [x] 5.3 Implement `load/specs.ts` (SpecInvariant derivation)
    - `specName` from the directory, sorted unique `REQ-[A-Z]+-[0-9]+` ids, `stances` from core `deriveSpecStances` over `SHALL` paragraphs with the merged ontology, `active` from `tasks.md` checkboxes unless `config.json` `activeSpecs` decides. No local approximation of stance scanning.
    - _Requirements: Req 10.3, REQ-DEC-4_

  - [x] 5.4 Tests for spec derivation
    - Absent `tasks.md` is active; all tasks complete is inactive; `[-]` counts as open; `activeSpecs` override both ways; the haunted fixture specs yield the expected stances.
    - _Requirements: Req 10.3_

  - [x] 5.5 Implement `load/config-file.ts` and `load/ontology-file.ts`
    - zod-validated `config.json` (reject unknown keys, version 1, `activeSpecs`) merged over `DEFAULT_CONFIG` and checked by `validateConfig`; `ontology.json` merged through `mergeOntology`; both yield `CONFIG_INVALID` naming file and key.
    - _Requirements: Req 10.4, Req 10.5_

  - [x] 5.6 Tests for config and ontology readers
    - Absent files use defaults; wrong version, unknown key, bad type, and invalid regex each produce the right code and message; round trip parse-serialise-parse equals for valid values (Req 10.12).
    - _Requirements: Req 10.4, Req 10.5, Req 10.12_

  - [x] 5.7 Implement `load/state-file.ts`
    - zod schema for `state.json` (`version`, `commit`, `at`, `ledger` cursor, `engrams` map), conversion to `EngramState[]` with the key as `id`; absent means no states and a zero cursor; malformed means `CONFIG_INVALID`. Add the matching serializer in `persist/state-serialize.ts` (keys ascending).
    - _Requirements: Req 10.6, Req 10.7, Req 10.12_

  - [x] 5.8 Tests for state file round trip
    - Property: for any zod-valid state, parse then serialise then parse is equal and serialisation is byte-identical for equal values; unit: absent, malformed, wrong version.
    - _Requirements: Req 10.6, Req 10.12_

  - [x] 5.9 Implement `load/ledger-file.ts`
    - Split on newline-terminated lines, ignore an unterminated final line with `LEDGER_TORN_TAIL`, skip blank, non-JSON, or invalid lines with `LEDGER_LINE_SKIPPED` (1-based line number) while still counting them toward the cursor; verify the cursor by byte offset and SHA-256 of the line (core's pure `sha256`) and report `LEDGER_REWRITTEN` on mismatch or truncation.
    - _Requirements: Req 10.8, Req 10.9, Req 23.7_

  - [x] 5.10 Tests for the ledger reader
    - Torn tail, blank line, garbage line, invalid event, CRLF line endings, multibyte content (byte versus character offsets), cursor match, cursor mismatch, ledger shorter than cursor, and the append-then-read round trip (Req 12.6).
    - _Requirements: Req 10.9, Req 12.6, Req 23.7_

  - [x] 5.11 Implement `load/tombstone-file.ts`
    - Absent means an empty crypt; present is parsed with core `parseTombstones`; malformed yields `CONFIG_INVALID` and is reported as such for apply and dry-run alike. Read only on demand.
    - _Requirements: Req 10.11, Req 8.6_

  - [x] 5.12 Implement `load/commit-counter.ts`
    - Resolution order override, git, state, ledger, zero, with `commitSource`; the "git commit count unavailable" Diagnostic on every fallback; `buildContext` reads only `state.json` commit and the highest ledger commit before the full load; ISO validation yields `INVALID_INPUT`; `now` read once.
    - _Requirements: Req 11.1, Req 11.2, Req 11.3, Req 11.4, Req 11.5_

  - [x] 5.13 Tests for commit-counter resolution
    - Table test over every source and fallback; an override never invokes git (spy on the git module); invalid ISO strings rejected; `COMMIT_BEFORE_CHECKPOINT` raised when the commit is behind `state.json`.
    - _Requirements: Req 11.2, Req 11.3, Req 11.4, Req 23.13_

  - [x] 5.14 Implement `load/workspace.ts` (`loadWorkspace`)
    - Orchestrate the loaders into `{ cfg, ontology, compiled, engrams, parseDiagnostics, specs, states, ledger, tombstones? }`, with `includeSpecs` controlling spec engrams only; deterministic ordering throughout.
    - _Requirements: Req 10.1, Req 2.4_

  - [x] 5.15 Integration test: load the haunted repo
    - Materialise `generateHauntedRepo` into a temp dir and assert `loadWorkspace` yields the fixture's engrams, specs, and ledger; assert two loads are deep-equal.
    - _Requirements: Req 10.1, Req 21.8_

  - [x] 5.16 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts.

- [x] 6. Persistence
  - Pure checkpoint computation first, then the write executor.

  - [x] 6.1 Implement `persist/checkpoint.ts` (`computeCheckpoint`)
    - Pure function: select the Consumable_Prefix of lines after the cursor (blank and skipped lines are consumable; stop at the first line whose `commit` exceeds `nowCommit`); fold it into persisted states using core `score`/`reinforce`; stamp engrams without state; prune archived and unmatched ids (only archived ids when a steering file was skipped); advance the cursor; handle cursor mismatch by re-anchoring without folding. Returns `{ states, cursor, stamped, foldedEvents, pruned, diagnostics }` and no side effects.
    - _Requirements: Req 23.1, Req 23.3, Req 23.7, Req 23.9_

  - [x] 6.2 Property test (a): no double counting
    - For arbitrary ledgers and split points, folding a prefix and then replaying the remainder equals a one-shot replay of the same events over the same initial states.
    - _Requirements: Req 23.2, Req 23.4, INV-4_

  - [x] 6.3 Property test (b): checkpoint idempotence
    - For arbitrary workspaces, running `computeCheckpoint` a second time with the same `nowCommit` and `nowISO` on its own output changes nothing (states, cursor, and diagnostics-free).
    - _Requirements: Req 23.10, Req 23.8, INV-4_

  - [x] 6.4 Property test (c): stamped engrams decay as `exp(-n / (s0 * W))`
    - For arbitrary unprotected engrams stamped at `c0` with no matching event, retention at `c0 + n` equals `exp(-n / s0)` within the documented epsilon (test only), is non-increasing in `n`, and the tier follows the default thresholds (Hot for `n <= 2`, Warm for `3..6`, Crypt for `n >= 7`).
    - _Requirements: Req 23.6, REQ-DEC-1, REQ-DEC-2_

  - [x] 6.5 Property test (d): resurrected engrams are not boosted by old events
    - For arbitrary ledgers containing events older than a resurrection commit, a freshly stamped state is never modified by those events and its retention equals `exp(-n / s0)`.
    - _Requirements: Req 23.1, Req 5.5, INV-3_

  - [x] 6.6 Property test (e): cursor-mismatch handling
    - For arbitrary ledgers and arbitrarily corrupted cursors (wrong hash, byte count beyond the end), a read-only view ignores all events with `LEDGER_REWRITTEN`, and a checkpoint moves the cursor to the end without folding any event.
    - _Requirements: Req 23.7_

  - [x] 6.7 Property test (f): future-commit events
    - For arbitrary ledgers with events whose commit exceeds `nowCommit`, those lines and all later ones stay unconsumed, and a later checkpoint at a sufficient commit consumes each exactly once.
    - _Requirements: Req 23.3, Req 23.4_

  - [x] 6.8 Implement `persist/journal.ts` and `persist/write-plan.ts`
    - Write plan order: `tombstones.json`, steering files in ascending path order, then `state.json`, writing only files whose content differs. Executor: build the plan, return early with no backup and no journal when nothing differs, otherwise back up pre-images, atomically write `pending.json`, write each file, delete the journal on success, roll back every written file and delete created files on failure (`IO_FAILED`, `applied: false`, detail lists files still differing plus `backupPath` if restoration fails).
    - _Requirements: Req 8.3, Req 8.4, Req 8.5, Req 8.7, Req 8.10_

  - [x] 6.9 Failure-injection tests at every write step
    - Parameterised over each position in the write order (including journal write and backup copy): inject a failure, assert full rollback to the original bytes, no journal left, and the right error; inject a failure during rollback and assert the detail lists the differing files.
    - _Requirements: Req 8.5_

  - [x] 6.10 Crash-recovery and refusal tests
    - Simulate a crash by leaving `pending.json` and half-written files; assert the next mutating call restores from the named backup, deletes created files and the journal, and adds `INTERRUPTED_APPLY_RECOVERED`. Assert that a `tombstones.json` that fails `parseTombstones` yields `CONFIG_INVALID` and the file is not rewritten or truncated. Assert a no-op apply creates no backup directory, no journal, and no `tombstones.json` rewrite.
    - _Requirements: Req 8.6, Req 8.7, Req 8.10, Req 8.3_

  - [x] 6.11 Implement `persist/pbt-failures.ts` and `persist/ledger-append.ts`
    - `pbt-failures.ts`: build the file only through core's `pbtFailureEntry` and `appendPbtFailure`, written atomically under the lock. `ledger-append.ts`: open in append mode, write a leading `\n` first when the last byte is not `\n`, then exactly one `write` of the complete line in the fixed key order.
    - _Requirements: Req 14.4, Req 9.6, Req 10.10, Req 10.8_

  - [x] 6.12 Tests for pbt-failures and ledger append
    - Append round trip (event deep-equals after read-back), torn-fragment repair (fragment becomes a skipped line), concurrent appenders from child processes produce whole lines only, pbt-failures output equals core's serializer for the same input.
    - _Requirements: Req 9.6, Req 10.10, Req 12.6, Req 14.4_

  - [x] 6.13 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts and confirm each of the six checkpoint properties (a)-(f) ran at least 1,000 cases.

- [x] 7. Operations (transport-agnostic)
  - `src/ops/*` take a `RunContext` and return envelopes. No MCP or CLI code here. The gate is an injected interface; the real gate arrives in milestone 8.

  - [x] 7.1 Implement `ops/context.ts` and `ops/mutate.ts`
    - `RunContext`, `buildContext`, and `withMutation` (lock, recover journal, load, run body, release in `finally`), plus the `GateRunner` interface in `gate/gate.ts` with a stub runner for tests. Dry-run paths call the same pure planning function on a read-only load.
    - _Requirements: Req 4.6, Req 9.4, Req 11.5, Req 8.10_

  - [x] 7.2 Implement `ops/score.ts`
    - Load, apply the checkpoint view (in-memory states plus only unconsumed events), score with core, compute `tiers`, `hotTokens`, `budget` and `budgetStatus` via `planConsolidation`, report `firstSeen` and `FIRST_SEEN_SYNTHESISED`; spec engrams stamped but never persisted; no write, no lock, no git beyond the commit count.
    - _Requirements: Req 2.2, Req 2.3, Req 2.4, Req 2.5, Req 2.6, Req 23.2, Req 23.5, Req 23.12_

  - [x] 7.3 Tests for `scoreOp`
    - Byte-identical `data` on two calls with fixed `atCommit` and `now` (Req 2.7); "estimated utility" wording; ordering by ascending id; a spy proves no write or lock call; rule added at commit 100 scored at 105 and 110 shows `FIRST_SEEN_SYNTHESISED` rather than silently staying at 1.
    - _Requirements: Req 2.5, Req 2.6, Req 2.7, Req 23.5_

  - [x] 7.4 Implement `ops/detect.ts`
    - Score for the checkpoint view, call `detectContradictions(scored, specs, userOntology)`, map `ONTOLOGY_INVALID_PATTERN` to a tool error with no reports, apply the `steering-vs-specs` scope filter (exactly one id begins with `spec:`), compute `count` and `unresolvable`.
    - _Requirements: Req 3.2, Req 3.3, Req 3.4, Req 3.5_

  - [x] 7.5 Tests for `detectOp`
    - Haunted fixture reports equal core's `detectContradictions` output in order; scope filtering both ways; invalid ontology pattern returns the error and no reports; no filesystem write.
    - _Requirements: Req 3.2, Req 3.3, Req 3.4_

  - [x] 7.6 Implement `ops/sleep.ts` planning and dry-run
    - Shared pure planning (score, detect, resolve, `planConsolidation`, apply to a virtual workspace, result assembly with `skipped`, `checkpoint`, `diagnostics`); `budgetTokens` override for this call only; `skipGate` plus `apply` returns `INVALID_INPUT`; `budget_infeasible` returns `ok: true` with protected engrams intact and names the status in `summary`.
    - _Requirements: Req 4.2, Req 4.3, Req 4.4, Req 4.5, Req 4.7, Req 14.1_

  - [x] 7.7 Implement `ops/sleep.ts` apply path
    - Fixed order: validate, lock, recover, load, plan, gate (injected), backup, write, release. A gate failure returns `PBT_GATE_FAILED` before backup and write, records the failure through `persist/pbt-failures.ts`, and leaves every other file untouched. Compute `applied: true` only after the last write succeeded.
    - _Requirements: Req 4.6, Req 14.2, Req 14.3, Req 14.4, Req 8.4_

  - [x] 7.8 Tests for `sleepOp` ordering and gate behaviour
    - A recording stub asserts the call order lock, recover, load, plan, gate, backup, write, unlock; gate failure produces no backup directory and no writes; dry-run never modifies files except the failure record; `budgetTokens` is not persisted.
    - _Requirements: Req 4.2, Req 4.4, Req 4.5, Req 4.6, Req 14.2_

  - [x] 7.9 Implement `ops/resurrect.ts`
    - Query rules in order: (a) exact tombstone id, (b) glob over tombstone `file` via core's `globMatch` when the query contains `*`, `?`, or `/`, (c) case-insensitive substring over `id` and `body`; the first rule with at least one match decides. Dry-run lists matches; apply is all-or-nothing through the write plan, restores byte-exact via core `resurrect`, and stamps the restored engram fresh.
    - _Requirements: Req 5.2, Req 5.3, Req 5.4, Req 5.5, REQ-CRY-7_

  - [x] 7.10 Tests for `resurrectOp`
    - Rule precedence: the first rule (a) exact id, (b) glob when the query contains `*`, `?` or `/`, (c) substring, that yields at least one match decides. Test a query that matches by id and also by substring (id wins), a glob query that matches nothing falls through to substring, and a plain query uses substring.
    - Also cover: no match returns a typed error, malformed `tombstones.json` returns `CONFIG_INVALID` for dry-run and apply, an injected write failure leaves nothing restored, and CRLF/BOM files restore byte-exact.
    - _Requirements: Req 5.2, Req 8.6, Req 8.9_

  - [x] 7.11 Implement `ops/adopt.ts`
    - Report `{ stamped, foldedEvents, pruned }` without writing; with `--apply` write only `state.json` atomically under the lock with no Backup_Dir.
    - _Requirements: Req 23.11, Req 10.7_

  - [x] 7.12 Tests for `adoptOp`
    - Dry-run writes nothing; apply writes only `state.json`; a second apply with the same commit and now changes no file; no `backup` directory appears.
    - _Requirements: Req 23.10, Req 23.11_

  - [x] 7.13 Implement `ops/record.ts`
    - Build the event (`at` from `nowISO`, `commit` from the counter, `filesTouched`/`cited`), validate `--type` rules (`spec_cited` and `manual_pin` need `cited`), `--files-from-git` as the sorted unique union of `git diff --name-only HEAD` and `git ls-files --others --exclude-standard` capped at 500 with a Diagnostic, path-guard every entry (drop failures with a stderr warning), append without the lock, then run the stamp-plus-checkpoint step under a 1000 ms lock budget; degrade to `STATE_NOT_UPDATED` with exit 0 when the lock or write fails. Summary says "estimated utility" and never claims usefulness.
    - _Requirements: Req 12.1, Req 12.2, Req 12.3, Req 12.4, Req 12.5, Req 12.7_

  - [x] 7.14 Tests for `recordOp`
    - Torn-tail repair before append, 501-file truncation Diagnostic, escaping paths dropped, `STATE_NOT_UPDATED` with the event still appended (lock held by a child process), a `task_passed` event with no files states that it matches no engram, and a first record stamps engrams so later scores decay.
    - _Requirements: Req 10.10, Req 12.2, Req 12.3, Req 12.4, Req 12.7_

  - [x] 7.15 Implement `ops/probe.ts`
    - Capture real hook payloads and environment facts (stdin JSON shape, cwd, argv, relevant env names only) to a file under `.kiro/lethe/` for Requirement 20; read-only except that file; no secrets recorded.
    - _Requirements: Req 19.3, Req 20.1_

  - [x] 7.16 Test for `probeOp`
    - Feed a sample stdin payload and assert the captured shape; assert env values are not stored, only names on an allow-list.
    - _Requirements: Req 19.3, Req 20.1_

  - [x] 7.17 End-to-end idempotence test through the real IO layer
    - Materialise a seeded haunted repo into a temp dir, run `sleepOp` apply twice with the same `--commit` and `--now` and the real gate stub set to pass; assert every file under the workspace is byte-identical after the second run (including `state.json`, `tombstones.json`, `ledger.jsonl`) and no new directory appears under `.kiro/lethe/backup/`.
    - _Requirements: Req 4.8, Req 23.10, Req 21.8, INV-4_

  - [x] 7.18 Haunted-repo golden test
    - Compare the on-disk result of `sleepOp` apply with core's `runConsolidation` on the same fixture (archived ids, merged pairs, demoted ids, token counts, serialised steering text), then `resurrectOp` each archived rule and assert the restored steering files are byte-identical to the originals.
    - _Requirements: Req 21.8, Req 8.9, REQ-CRY-3, INV-3_

  - [x] 7.19 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite (unit then perf) with `FC_NUM_RUNS=1000`; report the counts, the six checkpoint properties, the idempotence test, and the golden test as individual pass lines.

- [x] 8. Gate integration
  - Replaces the stub `GateRunner` from 7.1 with the real property gate and finishes the gate paths of `sleepOp`.

  - [x] 8.1 Implement the default runner in `gate/gate.ts`
    - `defaultGateRunner(cfg, numRuns)` calls `await import("@lethe/core/properties")` inside the function body (never at module top level) and then `runPbtGate(cfg, { numRuns })`, returning core's typed gate result. Verify the `runPbtGate` signature, the result shape, and the `@lethe/core/properties` export map entry in the installed core source; do not assume.
    - _Requirements: Req 14.1, Req 14.6, REQ-PBT-3, REQ-MCP-5_

  - [x] 8.2 Wire `gateRuns`, `skipGate`, and the failure paths into `ops/sleep.ts`
    - `gateRuns` (default 100) is the `numRuns` passed to the runner; the CLI flag `--gate-runs <n>` maps to this option (parsed in 10.1). `pbtGate` is `"passed"`, `"failed"`, or `"skipped"`, with `"skipped"` only when `skipGate` is set and `apply` is `false`. On a failed gate with `apply: true`: return `PBT_GATE_FAILED` with `detail { propertyId, seed, counterexample }` before any backup and before any write other than `pbt-failures.json`. On a failed gate with `apply: false`: return `ok: true`, `pbtGate: "failed"`, `data.gateFailure`, and write nothing but `pbt-failures.json`. In both cases build the record with core's `pbtFailureEntry` and `appendPbtFailure` through `persist/pbt-failures.ts` (milestone 6) under the lock; a malformed existing file is replaced as core's helper specifies.
    - _Requirements: Req 14.1, Req 14.2, Req 14.3, Req 14.4, Req 14.5, REQ-PBT-2, REQ-PBT-3_

  - [x] 8.3 Tests for the gate failure paths
    - Use a failing `GateRunner` double over several seeds: with `apply: true` the steering files and `tombstones.json` are byte-identical to before the call, no backup directory exists, and only `pbt-failures.json` changed; with `apply: false` the result is `ok: true` with `gateFailure`; `skipGate` with `apply` returns `INVALID_INPUT`; `skipGate` without `apply` reports `pbtGate: "skipped"`; a malformed existing `pbt-failures.json` is replaced (example test); `gateRuns` reaches the runner.
    - _Requirements: Req 14.2, Req 14.3, Req 14.4, Req 14.5, Req 14.7, Req 21.7_

  - [x] 8.4 Test that the properties module loads lazily
    - In a fresh module registry, import the package index and run `scoreOp`, `detectOp`, and `sleepOp` dry-run with `skipGate: true`; assert (via a module-load spy on `@lethe/core/properties` and `fast-check`, or the module graph) that neither module was loaded. Then run a dry-run that does gate and assert the module is loaded exactly once and a second gate run does not load it again.
    - _Requirements: Req 14.6, REQ-MCP-5_

  - [x] 8.5 Perf test for first-gate latency in `test/gate.perf.test.ts`
    - Run the real gate once in a cold process (child process) with `numRuns` 100 and report the elapsed milliseconds with `console.error`-free output (use the vitest reporter, not stdout of the product); assert a generous bound (under 20,000 ms) so only a hang fails. The measured number feeds the write-up in 14.8.
    - _Requirements: Req 14.1, Req 22.1, NFR-1_

  - [x] 8.6 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite (unit then perf) with `FC_NUM_RUNS=1000`; report counts, the lazy-load test result, and the measured first-gate latency.

- [x] 9. MCP tools and server
  - Exactly four tools on the low-level SDK `Server`. Verify every SDK import path and signature against the installed `@modelcontextprotocol/sdk` 1.32.2 (and `zod` 4.6.7) before use; do not assume.

  - [x] 9.1 Implement `tools/score.ts` and `tools/detect.ts`
    - Each exports a `ToolDef` with its name, model-facing description (when to call, what it returns, read-only and safe, "estimated utility" wording for score), `mutating: false`, the schema from 3.4, and a `run` that calls the operation.
    - _Requirements: Req 1.4, Req 2.6, Req 3.1, REQ-MCP-2_

  - [x] 9.2 Implement `tools/sleep.ts` and `tools/resurrect.ts`
    - Same shape with `mutating: true`; each description states that the default is a dry-run and that `apply: true` is required to change files; the sleep description also says never to combine `skipGate` with `apply`; the resurrect description says restored rules start with fresh stability.
    - _Requirements: Req 1.4, Req 4.1, Req 5.1, REQ-MCP-3_

  - [x] 9.3 Implement `tools/registry.ts`
    - Export `TOOLS` as a readonly tuple of exactly four `ToolDef`s in a fixed order, compute each `inputSchema` JSON Schema once with `z.toJSONSchema(schema, { io: "input" })`, and expose a lookup by name. This is the only module importing the four tool modules.
    - _Requirements: Req 1.1, Req 1.7, REQ-MCP-1_

  - [x] 9.4 Implement `server.ts` (`createLetheServer`)
    - `new Server({ name: "lethe", version }, { capabilities: { tools: {} } })` with exactly two handlers. `ListToolsRequestSchema` returns name, description, and JSON Schema. `CallToolRequestSchema`: unknown name throws `McpError(ErrorCode.InvalidParams, "Unknown tool: <name>")` before any filesystem access; `safeParse` failure returns an `INVALID_INPUT` failure envelope with `detail` as `{ path, message }` pairs only; then `buildContext` and `run`; any thrown exception is logged to stderr and returned as `INTERNAL_ERROR` with a generic message while the server keeps serving; success and failure both render as `{ content: [one text block], structuredContent: envelope, isError: !ok }` with identical JSON in the text block.
    - _Requirements: Req 1.3, Req 1.5, Req 6.1, Req 6.3, Req 6.4, Req 6.6, REQ-MCP-6_

  - [x] 9.5 Implement `serveStdio` in `server.ts`
    - Connect `StdioServerTransport`, log one startup line to stderr (`lethe serve: node <version>, cwd <cwd>`, used to verify A4), install `SIGINT`/`SIGTERM` handlers that release any held lock, and write nothing to stdout from product code.
    - _Requirements: Req 19.1, Req 9.4, Req 17.5, INV-8_

  - [x] 9.6 Registry test: exactly four tools
    - Assert `TOOLS.length === 4`, the names equal the required set, and that adding a fifth entry in a test-local copy of the registry makes the "exactly four" assertion fail (proves the test bites); a source scan asserts only `registry.ts` imports the tool modules and `server.ts` imports only `registry.ts`.
    - _Requirements: Req 1.1, Req 1.7, REQ-MCP-1_

  - [x] 9.7 Contract tests for every tool
    - With `Client` and `InMemoryTransport.createLinkedPair()`: `tools/list` returns four tools whose schemas carry `additionalProperties: false`; each tool is called with an accepted input (score, detect, sleep dry-run, resurrect dry-run on the haunted fixture) and `structuredContent` deep-equals the parsed text block; both mutating tools change nothing without `apply: true`; an unknown tool name gives JSON-RPC code -32602 with message `Unknown tool: <name>` and the temp workspace tree is unchanged.
    - _Requirements: Req 1.1, Req 1.3, Req 1.5, Req 21.2, REQ-MCP-1, REQ-MCP-3_

  - [x] 9.8 Contract tests for every error code reachable from tools
    - Assert `isError: true`, the Envelope shape, and the `code` for: `INVALID_INPUT` (relative path, unknown property, `skipGate` with `apply`; `detail` is only `{ path, message }` pairs), `CONFIG_INVALID` (malformed `state.json` or `tombstones.json`), `ONTOLOGY_INVALID_PATTERN`, `TOMBSTONE_NOT_FOUND`, `PBT_GATE_FAILED` (gate double), `LOCKED` (lock held by a child process, short wait budget), `IO_FAILED` (injected write failure), `INTERNAL_ERROR` (injected throwing operation: no stack text in the response, stderr has the full error, a following call still succeeds). Assert `PATH_ESCAPE` is reachable from `resurrect` or a spec path that escapes, and that `PARSE_*` surface only as diagnostics with `ok: true`. `BUDGET_INFEASIBLE` is asserted never to appear as an error code (it is `ok: true` with a status).
    - _Requirements: Req 6.1, Req 6.2, Req 6.3, Req 6.4, Req 6.6, Req 21.2, REQ-MCP-6_

  - [x] 9.9 Test the four tool descriptions
    - Assert each description names when to call it and what it returns; both mutating descriptions contain the dry-run default and the phrase that `apply: true` is required; the sleep description forbids `skipGate` with `apply`; the score description contains "estimated utility"; no description exceeds 1,200 characters.
    - _Requirements: Req 1.4, Req 2.6, Rules-12, REQ-MCP-2, REQ-MCP-3_

  - [x] 9.10 Stdout-pollution test (in-process)
    - Spy on `process.stdout.write`, `process.stderr.write`, and the `console` methods while a linked client calls all four tools including error cases; assert product code wrote zero bytes to stdout and that the `INTERNAL_ERROR` log reached stderr. The real-stdio variant runs in 11.6.
    - _Requirements: Req 19.1, Req 19.2, Req 19.3, INV-8_

  - [x] 9.11 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts, the number of tools listed (4), and the list of error codes covered.

- [x] 10. CLI
  - Hand-written argument parser and one runner. `cli.ts` is the only caller of `process.exit`.

  - [x] 10.1 Implement `cli/args.ts`
    - Strict parser (no dependency) producing a discriminated union per subcommand (`check`, `record`, `score`, `sleep`, `resurrect`, `adopt`, `probe`, `serve`) with global options `--workspace`, `--json`, `--now`, `--commit`, `--help`, `--version`; per-command options `--scope`, `--fail-on`, `--block`, `--include-specs`, `--apply`, `--budget`, `--skip-gate`, `--gate-runs`, `--query`, `--type`, `--files`, `--files-from-git`, `--cited`. Unknown subcommand or flag, missing value, malformed number or ISO string, missing required option, and `--skip-gate` with `--apply` produce a usage error carrying a one-line hint.
    - _Requirements: Req 13.1, Req 13.2, Req 13.4, Req 11.3_

  - [x] 10.2 Unit tests for the args parser
    - Table test for each subcommand's accepted forms and each usage-error class (exit 64 mapping is tested in 10.6); `--gate-runs` bounds; `--files a,b` splitting; defaults (`--workspace` is the current directory, `--fail-on any`).
    - _Requirements: Req 13.1, Req 13.4, Req 13.5_

  - [x] 10.3 Implement `cli/render.ts` and `cli/exit-code.ts`
    - `exitCodeFor(command, envelope, flags)` encodes the matrix from Requirement 13.3 and the design table: 0 success; 1 for `check` findings per `--fail-on`, a failed gate, or `resurrect` matching nothing; 2 instead of 1 only with `--block`; 64 usage; 70 `INTERNAL_ERROR`; 74 for `IO_FAILED`, `LOCKED`, `PATH_ESCAPE`, `CONFIG_INVALID`, `PARSE_*`, `ONTOLOGY_INVALID_PATTERN`, and semantic `INVALID_INPUT`. `render` returns `{ stdout, stderr }` text: with `--json` exactly one Envelope plus `\n` on stdout (including usage errors and failures) and nothing else; without `--json`, human text on stdout at exit 0 and on stderr otherwise; hook-facing output capped at 2000 characters with a line naming how many reports were cut; the word "estimated utility" wherever reinforcement is mentioned.
    - _Requirements: Req 13.3, Req 13.5, Req 13.7, Req 13.8, Req 15.5, Req 15.6, Rules-12_

  - [x] 10.4 Implement `cli/run.ts` (`runCli`)
    - `runCli(argv, io, deps)` returns `{ exitCode }` and never calls `process.exit`; it maps `check`, `score`, `sleep`, `resurrect`, `record`, `adopt`, and `probe` to the operations (the `--commit` and `--now` overrides flow into `buildContext`), reads stdin only in `probe`, and converts any thrown exception to exit 70 with a generic message.
    - _Requirements: Req 13.2, Req 13.9, Req 11.3, Req 6.4_

  - [x] 10.5 Implement `cli.ts` (entry point) and the `serve` subcommand
    - The only module that calls `process.exit`; dispatches `serve` to `serveStdio`, returns exit 0 on stdin close and 130 or 143 on `SIGINT`/`SIGTERM`; prints `--help` and `--version` to stdout with exit 0.
    - _Requirements: Req 13.1, Req 13.3, Req 19.1_

  - [x] 10.6 In-process tests with `runCli`
    - Against temp workspaces, cover every subcommand and every row of the exit-code matrix: usage errors (64) including `--skip-gate --apply`, `INTERNAL_ERROR` via an injected throwing dependency (70), `LOCKED`/`IO_FAILED`/`CONFIG_INVALID`/`PATH_ESCAPE` (74), `check` with each `--fail-on` value, with and without `--block` (1 versus 2), gate failure (1), `resurrect` no match (1), `record` with `STATE_NOT_UPDATED` (0). With `--json` assert stdout is exactly one parseable document and stderr carries no protocol text; without `--json` assert text lands on stdout at exit 0 and on stderr otherwise; `--commit` and `--now` make two runs byte-identical; reinforcement text says "estimated utility".
    - _Requirements: Req 13.3, Req 13.4, Req 13.5, Req 13.7, Req 13.8, Req 21.3_

  - [x] 10.7 Spawned-process tests for exit codes and stream routing
    - Add `test/helpers/spawn-cli.ts`, which builds a temporary bundle with the esbuild JS API (replaced by `buildBundle()` in 11.2) and runs `node <bundle> <args>` with a scrubbed environment. A few cases only: `score --json` (one document on stdout, empty stderr), `check` with findings (exit 1, summary on stderr, empty stdout), unknown flag (exit 64, hint on stderr), `sleep --apply` against a failing gate configuration if reachable, and `--version`. Assert no read from stdin (the child is started with stdin closed and finishes).
    - _Requirements: Req 13.7, Req 13.8, Req 13.9, Req 21.3_

  - [x] 10.8 Contract snapshots for `--help` and the exit-code table
    - Snapshot the `--help` output and the exit-code table (subcommand names, option names, codes) so a later Crew adapter can depend on them; update the snapshot deliberately only.
    - _Requirements: Req 13.10_

  - [x] 10.9 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts and the exit-code matrix rows covered (all 17 rows of the design table).

- [x] 11. Packaging
  - One committed ES-module bundle that runs on plain Node 22+. Verify the esbuild option names and the `build()` result shape against the installed esbuild 0.28.2; do not assume.

  - [x] 11.1 Implement `scripts/build.mjs`
    - Export `buildBundle()` using the esbuild JS API with `write: false` and write the bytes itself: entry `src/cli.ts`, `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node22"`, `sourcemap: false`, `legalComments: "none"`, `define` for `process.env.NODE_ENV`, `minify: false`, banner `#!/usr/bin/env node` plus a `createRequire` shim; normalise the output to LF before writing; inline `@lethe/core`, the SDK, `zod`, and `fast-check`. The `build` script runs it.
    - _Requirements: Req 18.1, Req 18.3, Req 18.7, NFR-4_

  - [x] 11.2 Build and commit `dist/lethe.mjs`; update `.gitattributes`; switch the test helper
    - Run `npm run build` and commit `packages/lethe-mcp/dist/lethe.mjs`. Replace the `-text` rule from 2.3 with LF declarations (`* text=auto eol=lf` and `packages/lethe-mcp/dist/lethe.mjs text eol=lf`) per Requirement 18.7. Change `test/helpers/spawn-cli.ts` to call `buildBundle()`. Inspect the bundle: confirm `fast-check` is bundled and its initialisation is reachable only through the lazy `import("@lethe/core/properties")` site (the module is wrapped in a lazy initialiser that is called only from the gate runner), and record the size.
    - _Requirements: Req 18.1, Req 18.4, Req 18.7, Req 14.6_

  - [x] 11.3 Implement `scripts/print-mcp-config.mjs`
    - Print the user-level `~/.kiro/settings/mcp.json` entry for server `lethe` with an absolute path to `dist/lethe.mjs` (resolved from the script location, `/` or native separators as the platform needs), `command: "node"`, `args: [<abs>, "serve"]`, the same two-tool `autoApprove`, and no `env`. This is the fallback if assumption A4 is false.
    - _Requirements: Req 17.5, Req 17.3_

  - [x] 11.4 Bundle tests: drift, hygiene, standalone run, lazy gate
    - Drift: call `buildBundle()` into memory, normalise `\r\n` to `\n` on both sides, compare with the committed file, and print the first differing line on failure. Guard: the committed bundle matches none of `[A-Za-z]:\\`, `/Users/`, `/home/`, `sourceMappingURL`. Standalone: copy the bundle to an empty temp dir and run `--version` with no `node_modules` nearby. `engines.node` is `>=22`, `bin.lethe` is `dist/lethe.mjs`, the first line is the shebang, the file has no CR, and a scan finds no `fetch(`, `http.request`, `node:http`, `node:https`, or `node:net` use by product code (SDK transports are accepted and listed explicitly in the test). Lazy gate: the bundle text keeps the `fast-check` initialiser out of the module top level (assert by locating the single call site inside the gate runner).
    - _Requirements: Req 18.1, Req 18.2, Req 18.3, Req 18.4, Req 18.5, Req 18.6, Req 18.7, REQ-HOK-4_

  - [x] 11.5 Test `print-mcp-config.mjs`
    - Run the script, parse its stdout, assert the shape, an absolute path that exists, the two read-only tools in `autoApprove`, and no `env` or `disabled`.
    - _Requirements: Req 17.2, Req 17.3, Req 17.5_

  - [x] 11.6 Spawned-bundle end-to-end over real stdio
    - Use the SDK `Client` with `StdioClientTransport` against `node dist/lethe.mjs serve` and a temp workspace materialised from the haunted fixture: `initialize`, `tools/list` equals four, `lethe_score_memories`, `lethe_detect_contradictions`, a dry-run `lethe_consolidate_sleep` (nothing changes), `apply: true` (files change, backup exists, `applied: true`), an error call, and an unknown tool (error -32602). Capture raw stdout through a separate spawned run on raw pipes and assert every line parses as JSON-RPC 2.0 and the stderr stream contains the startup line with the cwd.
    - _Requirements: Req 21.4, Req 19.1, Req 19.3, Req 1.5, INV-8_

  - [x] 11.7 Perf tests in `test/bundle.perf.test.ts`
    - (a) Cold start: spawn `serve` on a 100-engram workspace and measure spawn to a completed `initialize` plus `tools/list`; assert under 500 ms using the median of 5 runs after one warm-up. (b) Score: call the score operation in a warm process on a 500-engram workspace, excluding git (use `atCommit`), median of 9 runs; assert under 250 ms end to end. Print the measured medians; thresholds are never loosened.
    - _Requirements: Req 22.1, Req 22.2, NFR-1_

  - [x] 11.8 Checkpoint: typecheck, suite, and bundle
    - Run typecheck, the whole package suite (unit then perf), and `npm run build`; confirm `git diff` shows no change to `dist/lethe.mjs`; report counts, bundle size, and the two measured medians.

- [x] 12. Kiro artifacts committed to the repository
  - Exact contents come from the design section "Hook, Steering, and MCP Artifacts". Only the hook format verified in `requirements.md` is used.

  - [x] 12.1 Create `.kiro/settings/mcp.json`
    - Server `lethe`, `command: "node"`, `args: ["packages/lethe-mcp/dist/lethe.mjs", "serve"]`, `autoApprove` exactly `["lethe_score_memories", "lethe_detect_contradictions"]`; no `env`, `disabled`, or `disabledTools`.
    - _Requirements: Req 17.1, Req 17.2, Req 17.3, Req 17.4, REQ-MCP-1_

  - [x] 12.2 Create the three hook files
    - `.kiro/hooks/lethe-check-on-save.json` (`PostFileSave`, matcher `\.kiro[\\/](steering|specs)[\\/].*\.md$`, command `node packages/lethe-mcp/dist/lethe.mjs check --workspace .`, `timeout` 30); `.kiro/hooks/lethe-record-on-task.json` (`PostTaskExec`, command `node packages/lethe-mcp/dist/lethe.mjs record --workspace . --type task_passed --files-from-git`, `timeout` 30); `.kiro/hooks/lethe-probe.json` (two hooks, `PostFileSave` and `PostTaskExec`, command `... probe --workspace .`, `enabled: false`). No hook passes `--block`.
    - _Requirements: Req 15.1, Req 15.2, Req 15.7, Req 13.6, REQ-HOK-1, REQ-HOK-2_

  - [x] 12.3 Create `.kiro/steering/lethe-sleep.md`
    - Front matter `inclusion: manual`; body per the design: detect, dry-run sleep via the MCP tool, present the report fields, apply only when `pbtGate` is `passed` and the user confirms, never `skipGate` with `apply`, report `backupPath` and how to resurrect. Body at most 600 tokens by core's `ceil(chars / 4)`.
    - _Requirements: Req 16.1, Req 16.2, Req 16.3, REQ-HOK-3_

  - [x] 12.4 Hook file validation test
    - A hand-written zod schema of the verified `v1` format (`version: "v1"`, `hooks` non-empty, each hook with `name`, PascalCase `trigger` from the verified list, optional `matcher` that compiles as a regular expression, `action` as a union of `command` (non-empty `command`) and `agent` (non-empty `prompt`), `timeout` a number at least 0 when present, `enabled` a boolean when present) applied to every `.kiro/hooks/*.json`; assert no `*.kiro.hook` file exists, no hook command contains `--block`, the check matcher matches `.kiro/steering/a.md` and `.kiro\specs\x\design.md` and not `src/a.ts`, and every command targets `packages/lethe-mcp/dist/lethe.mjs`.
    - _Requirements: Req 15.4, Req 13.6, REQ-HOK-1, REQ-HOK-2_

  - [x] 12.5 `mcp.json` shape and registration test
    - Assert the file equals the expected object exactly, `autoApprove` contains only Read_Only_Tool names (never `*` or a mutating tool), no `env`, `disabled`, or `disabledTools`, and that the path in `args[0]` exists relative to the repo root.
    - _Requirements: Req 17.1, Req 17.2, Req 17.3, Req 17.4, REQ-MCP-3_

  - [x] 12.6 Token-count test for `lethe-sleep.md`
    - Assert the `inclusion: manual` front matter and `ceil(chars / 4)` at most 600 (using core's token function), and that the body mentions `lethe_detect_contradictions`, `apply: false`, `apply: true`, `pbtGate`, `skipGate`, `backupPath`, and `lethe_resurrect_engram`.
    - _Requirements: Req 16.1, Req 16.2, Req 16.3, REQ-HOK-3_

  - [x] 12.7 Test that `.gitignore` never ignores `.kiro/`
    - Read the root `.gitignore` and every nested `.gitignore` (skipping `node_modules`); assert no pattern ignores `.kiro`, `.kiro/`, or any `.kiro/` subfolder (including `*`-style patterns that would match them), and that `git check-ignore` on the committed artifact paths reports not ignored when git is available.
    - _Requirements: Req 16.4, Req 16.5, REQ-HOK-4_

  - [x] 12.8 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite with `FC_NUM_RUNS=1000`; report counts and the artifact files covered.

- [x] 13. Concurrency and recovery end to end
  - Uses the committed bundle. No environment-variable or flag backdoor for fault injection may exist in production code.

  - [x] 13.1 Add the test-only faulty filesystem helper
    - `test/helpers/faulty-fs.ts` implements the `WorkspaceFs` interface by wrapping the real one and failing every write, rename, and delete from the Nth mutating call onward (including the rollback attempts, so a crash is simulated and the journal survives). Verify that `RunContext.fsx` is injectable through `buildContext` dependencies as the design states; if a constructor parameter is missing, add it with the real filesystem as the default, rebuild and recommit the bundle, and re-run the drift test.
    - _Requirements: Req 8.5, Req 8.7, Req 21.7_

  - [x] 13.2 Two simultaneous `sleep --apply` processes
    - Spawn two `node dist/lethe.mjs sleep --apply --commit C --now T` processes on one temp haunted workspace (start both before either finishes; repeat 5 times on fresh workspaces); assert the final bytes of every file equal those of a single run on an identical workspace, and exactly one run reports a non-empty `archived` while the other reports an empty one or `LOCKED`.
    - _Requirements: Req 9.5, Req 21.6, INV-4_

  - [x] 13.3 Record during sleep
    - While a `sleep --apply` process runs, spawn many `record` processes (`task_passed` with files); afterwards assert every ledger line is whole and parses, the number of lines equals the number of records, `state.json` parses with a cursor the loader accepts (no `LEDGER_REWRITTEN`), and a final `score` equals the score computed from a one-shot replay of the same ledger (each event counted exactly once).
    - _Requirements: Req 9.6, Req 12.6, Req 23.2, Req 23.4_

  - [x] 13.4 Interrupted-apply recovery
    - Using the faulty filesystem from 13.1, run `sleepOp` apply with the cut-off at each write position (journal, tombstones, each steering file, state); then run a normal operation with the real filesystem and assert it reports `INTERRUPTED_APPLY_RECOVERED` and every file equals either its pre-apply bytes or its post-apply bytes of an uninterrupted run, never a mix, with no `pending.json` left. Repeat for `resurrectOp` apply.
    - _Requirements: Req 8.5, Req 8.7, Req 21.7, INV-3_

  - [x] 13.5 Test that the bundle has no fault-injection backdoor
    - Scan the committed bundle for reads of environment variables with a `LETHE_` prefix or names containing `FAULT`, `INJECT`, or `CRASH`, and for the strings used by `test/helpers/faulty-fs.ts`; assert none are present.
    - _Requirements: Req 22.3, Rules-0.5, NFR-2_

  - [x] 13.6 Checkpoint: typecheck and suite
    - Run typecheck and the whole package suite (unit then perf) with `FC_NUM_RUNS=1000`; report counts and the repeat count of the concurrency test.

- [x] 14. Final quality gate
  - Measured numbers only; nothing is estimated or copied from the design.

  - [x] 14.1 Typecheck both packages
    - Run `npm run typecheck` in `packages/lethe-core` and `packages/lethe-mcp`; zero errors, zero `any`.
    - _Requirements: Req 22.4, Rules-1_

  - [x] 14.2 Run all rule-enforcement tests
    - Run the function-size, file-size, type-hygiene, import-boundary, and stdout-hygiene tests from milestone 2; fix any violation in code, not in the tests.
    - _Requirements: Req 22.4, Req 19.2, Req 22.5_

  - [x] 14.3 Implement `scripts/req-trace.mjs`
    - Scan `packages/lethe-mcp/test/**/*.ts` for `REQ-*`, `NFR-*`, `INV-*`, and `Req N.M` references and print a markdown table mapping each requirement id to the test files citing it, sorted by id and then path, with `/` separators and LF endings so output is deterministic.
    - _Requirements: Req 21.9_

  - [x] 14.4 Traceability test
    - Assert every `REQ-MCP-*`, `REQ-HOK-*`, and `NFR-*` id in `requirements.md` is cited by at least one test file, and that two runs of the script produce identical output.
    - _Requirements: Req 21.9, Rules-11_

  - [x] 14.5 Full suites at 100 and 1000 runs
    - Run `$env:FC_NUM_RUNS="100"; npm test` and `$env:FC_NUM_RUNS="1000"; npm test` in `packages/lethe-mcp`, and the same for `packages/lethe-core`; all green with the seed printed on any failure. For any property failure, shrink it, fix the cause, and keep a regression example test.
    - _Requirements: Req 21.1, REQ-PBT-1_

  - [x] 14.6 Perf pass, bundle rebuild, and drift
    - Run `npm run test:perf`, then `npm run build` and the drift test; the committed `dist/lethe.mjs` is unchanged by the rebuild. Record the measured startup, score, and gate latency medians.
    - _Requirements: Req 22.1, Req 22.2, Req 18.4_

  - [x] 14.7 Paste the traceability table into `docs/kiro-writeup.md`
    - Run `node packages/lethe-mcp/scripts/req-trace.mjs` and place its output under a `lethe-mcp requirement traceability` heading, replacing any earlier table.
    - _Requirements: Req 21.9_

  - [x] 14.8 Add the `lethe-mcp` section to `docs/kiro-writeup.md`
    - Measured numbers only: startup milliseconds, score milliseconds for 500 engrams, bundle size in bytes, first-gate latency, and test counts (files, tests, properties, runs). Include the platform facts that differed from the requirements as found in this build (low-level `Server` instead of `McpServer`, hook format) without claiming unverified Kiro behaviour.
    - _Requirements: Req 20.2, Rules-12_

  - [x] 14.9 Update `.kiro/steering/06-memory.md`
    - Append one changelog line in the template shape for this spec; add a row to "PBT Findings" for every property failure found in this spec (shrunk counterexample, root cause, fix); keep the file short and move nothing pinned.
    - _Requirements: Req 21.1, Rules-11_

  - [x] 14.10 Final checkpoint
    - Confirm 14.1-14.9 are all green; report the totals for files, tests, properties, and the measured numbers written to the write-up.

- [ ] 15. Platform verification in Kiro (optional, human, last)
  - Needs the Kiro IDE and a person. Nothing else in this plan depends on these tasks.

  - [ ]* 15.1 Capture hook payloads with the probe hook
    - Enable `.kiro/hooks/lethe-probe.json` in Kiro and capture stdin payloads for `PostFileSave` from an agent save under `.kiro/steering/`, from a user save of the same file in the editor, and for `PostTaskExec` after one spec task; collect the files under `.kiro/lethe/probe/`.
    - _Requirements: Req 20.1, Req 19.4_

  - [ ]* 15.2 Record findings for A1-A6
    - Write verified answers (or "not reproducible") with the date and a payload field list (no session identifiers) under "Verified Platform Facts" in `06-memory.md`. If a fact differs from the hook design, update the affected requirement text and hook file in the same change and re-run the milestone 12 tests. Then delete `.kiro/lethe/probe/` and set `enabled: false` on the probe hooks.
    - _Requirements: Req 20.2, Req 20.3, Req 20.4_

  - [ ]* 15.3 Confirm the MCP server starts from the workspace `mcp.json`
    - In Kiro, confirm the `lethe` server starts from `.kiro/settings/mcp.json`, read the startup log line for the server's cwd (A4), and record it in `06-memory.md`; if the relative path fails, document the user-level fallback from `print-mcp-config.mjs` in the README.
    - _Requirements: Req 17.5, Req 20.2_

---

## Notes

- Commands (run inside `packages/lethe-mcp` unless stated): `npm run typecheck`, `npm test` (unit then perf), `npm run test:unit`, `npm run test:perf`, and for the long property runs `$env:FC_NUM_RUNS="1000"; npm run test:unit`. `bun` is not installed.
- Exact pins: `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, `esbuild` 0.28.2 (dev), plus `vitest`, `fast-check`, `typescript`, and `@types/node` at the versions in `packages/lethe-core/package.json` (design: vitest 2.1.9, fast-check 3.23.2, typescript 5.9.3, `@types/node` 26.6.6).
- Perf naming rule: any assertion on elapsed time lives in a `*.perf.test.ts` file, which runs only in the serial `test:perf` pass; unit files never assert timing.
- Property-based test sub-tasks across the whole file: 1.2, 3.3, 4.2, 4.5, 4.9, 5.8, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7.
- Only the milestone 15 tasks (15.1, 15.2, 15.3) are optional (`*`); nothing else in the plan depends on them. All other tests and checkpoints are required.
- Task 8.2 plumbs `gateRuns` and 10.1 parses `--gate-runs`; fault injection exists only as a test-constructed `WorkspaceFs`, never as a production switch.
- Checkpoint tasks and parent tasks are not in the dependency graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.3"] },
    { "id": 2, "tasks": ["1.4", "2.4", "2.5", "2.6", "2.7", "2.8"] },
    { "id": 3, "tasks": ["3.1", "3.4"] },
    { "id": 4, "tasks": ["3.2", "3.5", "4.1", "4.3", "4.13", "4.15"] },
    { "id": 5, "tasks": ["3.3", "3.6", "4.2", "4.4", "4.5", "4.6", "4.14"] },
    { "id": 6, "tasks": ["4.7", "4.8", "4.10"] },
    { "id": 7, "tasks": ["4.9", "4.11", "4.12"] },
    { "id": 8, "tasks": ["5.1", "5.5", "5.7", "5.9", "5.11"] },
    { "id": 9, "tasks": ["5.2", "5.3", "5.6", "5.8", "5.10", "5.12"] },
    { "id": 10, "tasks": ["5.4", "5.13", "5.14", "6.1", "6.8", "6.11"] },
    { "id": 11, "tasks": ["5.15", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.9", "6.10", "6.12"] },
    { "id": 12, "tasks": ["7.1"] },
    { "id": 13, "tasks": ["7.2", "7.4", "7.6", "7.9", "7.11", "7.13", "7.15"] },
    { "id": 14, "tasks": ["7.3", "7.5", "7.7", "7.10", "7.12", "7.14", "7.16"] },
    { "id": 15, "tasks": ["7.8", "7.17", "7.18"] },
    { "id": 16, "tasks": ["8.1", "9.1", "10.1", "10.3"] },
    { "id": 17, "tasks": ["8.2", "8.5", "10.2"] },
    { "id": 18, "tasks": ["8.3", "8.4", "9.2", "10.4"] },
    { "id": 19, "tasks": ["9.3", "10.6"] },
    { "id": 20, "tasks": ["9.4", "9.6", "9.9"] },
    { "id": 21, "tasks": ["9.5", "9.7", "9.8", "9.10"] },
    { "id": 22, "tasks": ["10.5"] },
    { "id": 23, "tasks": ["10.7", "10.8"] },
    { "id": 24, "tasks": ["11.1", "11.3"] },
    { "id": 25, "tasks": ["11.2", "11.5"] },
    { "id": 26, "tasks": ["11.4", "11.6", "11.7"] },
    { "id": 27, "tasks": ["12.1", "12.2", "12.3", "13.1", "13.2", "13.3", "13.5"] },
    { "id": 28, "tasks": ["12.4", "12.5", "12.6", "12.7", "13.4"] },
    { "id": 29, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 30, "tasks": ["14.4"] },
    { "id": 31, "tasks": ["14.5"] },
    { "id": 32, "tasks": ["14.6", "14.7"] },
    { "id": 33, "tasks": ["14.8", "14.9"] },
    { "id": 34, "tasks": ["15.1"] },
    { "id": 35, "tasks": ["15.2"] },
    { "id": 36, "tasks": ["15.3"] }
  ]
}
```
