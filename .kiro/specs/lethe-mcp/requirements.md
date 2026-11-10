# Requirements Document

## Introduction

`lethe-mcp` is the imperative shell around the pure `@lethe/core` engine. It is the only Lethe package that touches the filesystem, git, the clock, and process streams. It delivers four things:

1. An MCP stdio server exposing exactly four tools (`lethe_score_memories`, `lethe_detect_contradictions`, `lethe_consolidate_sleep`, `lethe_resurrect_engram`).
2. The `lethe` CLI (`check`, `record`, `score`, `sleep`, `resurrect`, `probe`, plus `serve` to start the MCP server) that Kiro hooks and, later, a Kiro Crew adapter call.
3. The IO layer: workspace loader, persistence of `.kiro/lethe/*` and `.kiro/crypt/tombstones.json`, git commit counter, path guard, advisory lock, atomic writes, and pre-apply backups.
4. Committed Kiro integration artifacts: `.kiro/settings/mcp.json`, `.kiro/hooks/*.json` (hook schema `v1`), and the manually included steering file `.kiro/steering/lethe-sleep.md`.

Determinism, dry-run semantics, byte-exact tombstones, idempotent consolidation, and the 12 properties are guaranteed by `@lethe/core` (see `.kiro/specs/lethe-core/requirements.md`) and are referenced here, not re-specified. This spec only adds guarantees that exist because of IO: confinement, atomicity, recoverability, concurrency, protocol hygiene, and packaging.

### Verified platform facts this spec relies on

Source: kiro.dev/docs/hooks/, /hooks/types/, /hooks/actions/, /mcp/configuration/ (fetched 2026-11-09).

- MCP servers are registered in workspace `.kiro/settings/mcp.json` or user `~/.kiro/settings/mcp.json`; the workspace file overrides the user file. Schema: `{ "mcpServers": { "<name>": { "command", "args"?, "env"?, "disabled"?, "autoApprove"? (supports "*"), "disabledTools"? } } }`. Configs hot-reload on save. `${VAR}` expansion in `env` works only for variables the user approved in Kiro settings, so correctness never depends on it. On Windows, stdio servers are launched via commands on `PATH`.
- Hooks use the `v1` JSON schema in `.kiro/hooks/<name>.json`: `{ "version": "v1", "hooks": [ { "name", "description"?, "trigger", "matcher"?, "action": {"type":"command","command"} | {"type":"agent","prompt"}, "timeout"? (seconds, default 60, 0 disables), "enabled"?, "confirm"? } ] }`. Triggers: `SessionStart`, `Stop`, `UserPromptSubmit`, `PreTaskExec`, `PostTaskExec`, `PreToolUse`, `PostToolUse`, `PostFileCreate`, `PostFileSave`, `PostFileDelete` (plus compaction triggers). Command actions run in the project root and receive session context as JSON on stdin; `{{filePath}}` is available for file triggers. Exit code 0 adds stdout to the agent context; exit code 2 blocks the event on `PreToolUse`, `UserPromptSubmit`, and `PreTaskExec`; any other non-zero exit is an error and stderr is sent to the agent.
- The legacy `.kiro.hook` format is superseded. New manual-trigger hooks cannot be created in `v1`; the supported on-demand mechanism is a manually included steering file in `.kiro/steering/`, which runs as a `/<filename>` slash command. MCP tools appear to hooks as `mcp_<server>_<tool>`.
- **Documentation debt:** `.kiro/steering/02-architecture.md` section 8.2 still describes `*.kiro.hook` files and a manual-trigger hook. It must be updated to the `v1` format and the steering-file mechanism (follow-up edit, outside this spec's file set).

### Unverified assumptions (not facts)

These are stated as assumptions with an explicit verification requirement (Requirement 20). No acceptance criterion depends on them being true.

- **A1** `PostFileSave` may fire only for saves made by the agent, not by the user in the editor. Docs say "saved/modified by the agent".
- **A2** The stdin JSON for `PostTaskExec` and `PostFileSave` has fields beyond `hook_event_name`, `cwd`, `session_id`, `tool_name`, `tool_input`; the exact fields are unknown.
- **A3** A command hook may or may not be able to see the list of files touched by a task. `git diff --name-only` is the fallback and the shipped default.
- **A4** The working directory of an MCP stdio server launched from a workspace `mcp.json` is the workspace root. Unknown.
- **A5** `PostTaskExec` fires for tasks that completed with passing tests. Unknown; reinforcement stays a labelled heuristic.
- **A6** The format of file paths matched by hook `matcher` for file triggers (separator style on Windows) is unknown.

---

## Glossary

- **Lethe_MCP**: The `packages/lethe-mcp` package: MCP server, CLI, and IO layer.
- **MCP_Server**: The stdio Model Context Protocol server started by `lethe serve`.
- **CLI**: The `lethe` command-line interface implemented by the `lethe` bundle.
- **Bundle**: The single self-contained ES module `packages/lethe-mcp/dist/lethe.mjs` runnable with plain `node` (Node 22+).
- **Tool**: One of the four MCP tools: `lethe_score_memories`, `lethe_detect_contradictions`, `lethe_consolidate_sleep`, `lethe_resurrect_engram`.
- **Read_Only_Tool**: `lethe_score_memories` or `lethe_detect_contradictions`.
- **Mutating_Tool**: `lethe_consolidate_sleep` or `lethe_resurrect_engram`.
- **Envelope**: The JSON object `{ ok, summary, data }` on success or `{ ok: false, summary, error: { code, message, detail? } }` on failure.
- **Workspace**: The directory given as `workspacePath` (tools) or `--workspace` (CLI), resolved to an absolute real path.
- **Workspace_Loader**: The IO component that reads steering, specs, `.kiro/lethe/*`, and the crypt into core inputs.
- **Path_Guard**: The function `guardPath(workspace, rel)` that confines every filesystem path to the Workspace.
- **Atomic_Writer**: The component that writes a file by temp file in the same directory, `fsync`, then rename.
- **Backup_Dir**: `.kiro/lethe/backup/<commit>/`, the pre-image copy of every file an apply is about to change.
- **Lock_File**: `.kiro/lethe/lock`, the advisory lock serialising mutating operations on one Workspace.
- **Ledger**: `.kiro/lethe/ledger.jsonl`, the append-only reinforcement event log.
- **Commit_Counter**: The integer commit count used as `nowCommit`. Sources: `override`, `git`, `state`, `ledger`, `zero`.
- **Gate**: The PBT gate, `runPbtGate` from `@lethe/core/properties`.
- **Hook_File**: A `v1` JSON file in `.kiro/hooks/`.
- **Probe**: The `lethe probe` subcommand that captures a hook's stdin payload to disk for platform verification.
- **Diagnostic**: A non-fatal finding `{ file?, code, message }` returned in `data.diagnostics` (for example a markdown file that failed to parse).
- **Estimated_Utility**: The mandatory label for reinforcement-derived information in human-readable output.
- **Crew_Adapter**: A future Kiro Crew integration that calls the CLI. Out of scope.
- **Checkpoint**: The act of folding unconsumed Ledger events into the persisted `EngramState`s, stamping engrams that have no state, and recording the new Cursor (Requirement 23.1). Every `state.json` write is a Checkpoint.
- **Cursor**: The `ledger` object in `state.json`, `{ lines, bytes, lastLineSha256 }`, naming the Ledger prefix already folded into the persisted states.
- **Consumable_Prefix**: The longest run of unconsumed Ledger lines, from the first, whose events all have `commit` not above the call's `nowCommit`.
- **Stamp**: A fresh `EngramState` (stability `s0`, last reinforced now) written for an engram that had no persisted state; it marks the engram's first-seen moment.
- **Journal**: `.kiro/lethe/pending.json`, written before an apply's first file write and deleted after its last, used to recover an interrupted apply.

---

## Requirements

### Requirement 1: MCP Server and Tool Registry

**User Story:** As a Kiro agent, I want a small, predictable MCP surface over stdio, so that I can score, check, consolidate, and resurrect steering memory without learning a large API.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose exactly four tools named `lethe_score_memories`, `lethe_detect_contradictions`, `lethe_consolidate_sleep`, and `lethe_resurrect_engram`, so that an MCP `tools/list` request returns a list of length 4 whose names are exactly that set. <!-- REQ-MCP-1 -->

2. THE MCP_Server SHALL validate every tool input with a zod schema, reject unknown properties, and export each schema from the package so tests can import it. <!-- REQ-MCP-2 -->

3. WHEN a tool call succeeds, THE MCP_Server SHALL return an Envelope with `ok: true`, a `summary` string of at most 400 characters on a single line, and `data` holding the tool's structured result, delivered as MCP `structuredContent` and as one text content block containing the same JSON. <!-- REQ-MCP-2 -->

4. THE MCP_Server SHALL write tool descriptions for the model: each states when to call the tool, what it returns, and, for Mutating_Tools, that the default is a dry-run and that `apply: true` is required to change files. <!-- REQ-MCP-2 -->

5. WHERE a client invokes a tool name other than the four defined, THE MCP_Server SHALL answer with a JSON-RPC error of code -32602 (invalid params) whose message is `Unknown tool: <name>`, and SHALL NOT execute any filesystem operation. <!-- REQ-MCP-1 -->

6. THE MCP_Server SHALL accept `workspacePath` as a required absolute path in every tool input. IF the value is not absolute or does not name an existing directory, THEN THE MCP_Server SHALL return error code `INVALID_INPUT`. <!-- REQ-MCP-2, REQ-MCP-4 -->

7. THE MCP_Server SHALL import no Tool-registration code from any module other than the four tool modules, and the package test suite SHALL fail if a fifth tool is registered. <!-- REQ-MCP-1 -->

---

### Requirement 2: Tool `lethe_score_memories`

**User Story:** As a Kiro agent, I want the current retention, tier, and token budget of every engram, so that I can see what memory is Hot, Warm, or fading.

#### Acceptance Criteria

1. THE Tool SHALL accept `{ workspacePath: string (absolute), atCommit?: integer >= 0, now?: string (ISO 8601 with Z or numeric offset), includeSpecs?: boolean (default false) }`. <!-- REQ-MCP-2 -->

2. WHEN `atCommit` is omitted, THE Tool SHALL use the Commit_Counter from Requirement 11; WHEN `now` is omitted, THE Tool SHALL use the system clock read once at call start. <!-- REQ-MCP-2, REQ-DEC-6 -->

3. WHEN called, THE Tool SHALL return `data` = `{ engrams: ScoredEngramView[], tiers: { hot: number, warm: number, crypt: number }, hotTokens: number, budget: number, budgetStatus: "ok" | "budget_infeasible", commit: number, commitSource: "override" | "git" | "state" | "ledger" | "zero", now: string, diagnostics: Diagnostic[] }`, where `engrams` is ordered by ascending `node.id`, `tiers` counts satisfy `hot + warm + crypt == engrams.length`, and `hotTokens` is the sum of `node.tokens` over Hot engrams. `ScoredEngramView` is core's `ScoredEngram` with `node.body` and `node.span` omitted (response size) and a field `firstSeen: "persisted" | "synthesised"` added (Requirement 23.5). <!-- REQ-MCP-2, REQ-CRY-2 -->

4. WHERE `includeSpecs` is `false`, THE Tool SHALL score engrams from `.kiro/steering/**/*.md` only; WHERE `includeSpecs` is `true`, THE Tool SHALL additionally score engrams from `.kiro/specs/**/*.md`. In both cases active specs SHALL still be supplied to core as `SpecInvariant` inputs. <!-- REQ-MCP-2 -->

5. THE Tool SHALL perform no filesystem write, no lock acquisition, and no `git` command other than the commit-count command of Requirement 11. <!-- REQ-MCP-3, NFR-2 -->

6. WHEN the Tool output includes a `reinforcements` count or the summary mentions reinforcement, THE Tool SHALL label that information "estimated utility" in `summary` and in the tool description. <!-- Rules-12 -->

7. FOR ALL Workspaces and fixed `atCommit` and `now`, two consecutive calls SHALL return byte-identical `data` JSON (cross-reference: core determinism, P9). <!-- NFR-3 -->

---

### Requirement 3: Tool `lethe_detect_contradictions`

**User Story:** As a Kiro agent, I want to know which steering rules contradict each other or an active spec, so that I can resolve the conflict before it confuses a prompt.

#### Acceptance Criteria

1. THE Tool SHALL accept `{ workspacePath: string (absolute), scope?: "steering-vs-specs" | "all" (default "all"), atCommit?: integer >= 0, now?: string (ISO 8601) }`. <!-- REQ-MCP-2 -->

2. WHEN called, THE Tool SHALL return `data` = `{ reports: ContradictionReport[], count: number, unresolvable: number, diagnostics: Diagnostic[] }`, where `reports` is exactly core's `detectContradictions` output after scope filtering, in core's order. <!-- REQ-MCP-2, REQ-CON-2 -->

3. WHERE `scope` is `"steering-vs-specs"`, THE Tool SHALL keep only reports in which exactly one side's id begins with `spec:`; WHERE `scope` is `"all"`, THE Tool SHALL keep every report. <!-- REQ-MCP-2 -->

4. THE Tool SHALL load the user ontology from `.kiro/lethe/ontology.json` when present and pass it to core; IF core returns `ONTOLOGY_INVALID_PATTERN`, THEN THE Tool SHALL return that code as a tool error and no reports. <!-- REQ-CON-5 -->

5. THE Tool SHALL perform no filesystem write. <!-- NFR-2 -->

---

### Requirement 4: Tool `lethe_consolidate_sleep`

**User Story:** As a Kiro agent, I want to run memory consolidation as a safe dry-run and apply it only when the property gate passes, so that stale and defeated rules are buried without risking protected rules.

#### Acceptance Criteria

1. THE Tool SHALL accept `{ workspacePath: string (absolute), apply?: boolean (default false), budgetTokens?: integer >= 1, skipGate?: boolean (default false), gateRuns?: integer 1..10000 (default 100), atCommit?: integer >= 0, now?: string (ISO 8601) }`. <!-- REQ-MCP-2, REQ-MCP-3 -->

2. WHEN `apply` is `false` or omitted, THE Tool SHALL return the would-be result and SHALL NOT modify any file other than appending a failure record per Requirement 14.4. <!-- REQ-MCP-3, REQ-CRY-6 -->

3. THE Tool SHALL return `data` = core's `SleepConsolidationResult` (`archived`, `merged`, `demoted`, `tokensBefore`, `tokensAfter`, `budget`, `budgetStatus`, `pbtGate`, `applied`) plus `{ commit, commitSource, now, skipped: { id, reason }[], checkpoint: { stamped: string[], foldedEvents: number, pruned: string[] }, backupPath?: string, diagnostics: Diagnostic[] }`. `applied` SHALL be `true` only after every file write of Requirement 8 succeeded. <!-- REQ-MCP-2 -->

4. WHERE `budgetTokens` is provided, THE Tool SHALL use it in place of `config.json`'s `budgetTokens` for this call only and SHALL NOT persist it. <!-- REQ-CRY-2 -->

5. IF `skipGate` is `true` and `apply` is `true`, THEN THE Tool SHALL return `INVALID_INPUT` and SHALL NOT run consolidation. <!-- REQ-PBT-3 -->

6. WHEN `apply` is `true`, THE Tool SHALL execute in this order: (1) validate input; (2) acquire the Lock_File; (3) load the Workspace after the lock is held; (4) plan; (5) run the Gate; (6) back up per Requirement 8; (7) write files per Requirement 8; (8) release the lock. IF step 5 fails, THEN THE Tool SHALL return `PBT_GATE_FAILED` and SHALL NOT perform steps 6 and 7. <!-- REQ-MCP-3, REQ-PBT-3 -->

7. WHEN `budgetStatus` is `"budget_infeasible"`, THE Tool SHALL return `ok: true` with that status and an unchanged set of protected engrams, and SHALL name the status in `summary`. <!-- REQ-CRY-2, INV-6 -->

8. WHEN a second apply is made at the same Commit_Counter and `now` after a successful apply, THE Tool SHALL report empty `archived` and `merged`, SHALL leave every file under `.kiro/` and every steering file byte-identical (including `state.json`), and SHALL create no Backup_Dir (cross-reference: core idempotence, P8). <!-- REQ-CRY-4, INV-4 -->

---

### Requirement 5: Tool `lethe_resurrect_engram`

**User Story:** As a Kiro agent, I want to find and restore a buried rule, so that nothing archived is ever lost.

#### Acceptance Criteria

1. THE Tool SHALL accept `{ workspacePath: string (absolute), query: string (1..500 chars), apply?: boolean (default false), atCommit?: integer >= 0, now?: string (ISO 8601) }`. <!-- REQ-MCP-2, REQ-MCP-3 -->

2. THE Tool SHALL interpret `query` in this order: (a) exact equality with a tombstone `id`; (b) if (a) matched nothing and `query` contains `*`, `?`, or `/`, a glob over tombstone `file`; (c) if neither (a) nor (b) yielded a match (including a glob query that matched nothing), a case-insensitive substring match over tombstone `id` and `body`. The first rule that yields at least one match decides the result. <!-- REQ-CRY-7 -->

3. THE Tool SHALL return `data` = `{ matches: TombstoneRecord[], restored?: { id: string, file: string, placement: "neighbor" | "index" | "fallback" | "new-file" }[], commit, now, backupPath?, diagnostics }`, with `matches` in core's tombstone order and `restored` present only after a successful apply. <!-- REQ-MCP-2 -->

4. IF no tombstone matches, THEN THE Tool SHALL return error code `TOMBSTONE_NOT_FOUND`. <!-- REQ-CRY-7 -->

5. WHEN `apply` is `true` and at least one tombstone matches, THE Tool SHALL restore every match in `matches` order through core's `resurrect`, all or nothing: IF any restore fails, THEN no file SHALL be written and the core error code SHALL be returned. IF more than 50 tombstones match, THEN THE Tool SHALL return `INVALID_INPUT` with the match count in `detail`. <!-- REQ-MCP-3, INV-3 -->

6. WHEN a restore succeeds, THE Tool SHALL persist the fresh `EngramState` returned by core into `.kiro/lethe/state.json` and remove exactly the restored tombstone records from `tombstones.json`, under the lock and with the backup and write ordering of Requirement 8. <!-- REQ-CRY-7 -->

7. WHEN `apply` is `false`, THE Tool SHALL write nothing and SHALL NOT acquire the lock. <!-- REQ-MCP-3 -->

---

### Requirement 6: Error Model

**User Story:** As a Kiro agent, I want every failure to arrive as a structured error with a stable code, so that I can react programmatically and never see internal stack traces.

#### Acceptance Criteria

1. WHEN a tool call fails, THE MCP_Server SHALL return an MCP tool result with `isError: true` and an Envelope `{ ok: false, summary, error: { code, message, detail? } }`, where `code` is a member of the table below. <!-- REQ-MCP-6 -->

   | Code | Origin | Meaning |
   |---|---|---|
   | `PARSE_INVALID_FRONTMATTER`, `PARSE_DUPLICATE_ID`, `CONFIG_INVALID`, `ONTOLOGY_INVALID_PATTERN`, `BUDGET_INFEASIBLE`, `TOMBSTONE_NOT_FOUND`, `PATH_ESCAPE`, `PBT_GATE_FAILED` | `@lethe/core` `ErrorCode` | reused with core's meaning; `PATH_ESCAPE` is raised by the Path_Guard |
   | `INVALID_INPUT` | new, MCP layer | zod validation failure or semantically invalid combination (for example `skipGate` with `apply`); needed because core has no input-shape errors |
   | `LOCKED` | new, MCP layer | the Lock_File is held by a live owner after the wait budget; needed so callers can retry rather than treat contention as corruption |
   | `IO_FAILED` | new, MCP layer | a filesystem operation failed (permissions, disk full, rename failure); `detail` carries the OS error code (such as `EACCES`) and the workspace-relative path |
   | `INTERNAL_ERROR` | new, MCP layer | an unexpected exception; message is generic, details go to stderr only |

2. IF a markdown file in the Workspace fails to parse (`PARSE_*`), THEN THE Workspace_Loader SHALL skip that file, add a Diagnostic naming the file and code, and continue; Read_Only_Tools SHALL still return `ok: true`. <!-- REQ-MCP-6 -->

3. THE MCP_Server SHALL NOT include a stack trace, an absolute path outside the Workspace, or an environment variable value in any response. <!-- REQ-MCP-6, Rules-4 -->

4. IF an unexpected exception reaches the tool boundary, THEN THE MCP_Server SHALL return `INTERNAL_ERROR`, write the full error to stderr, and keep serving subsequent requests. <!-- REQ-MCP-6 -->

5. FOR ALL generated markdown inputs (including empty files, lone `---`, CRLF mixes, binary-looking bytes, and a 1 MiB body), a Read_Only_Tool call SHALL complete without terminating the process. <!-- REQ-MCP-6 -->

6. WHEN the zod validation of a Tool input fails, THE MCP_Server SHALL return `INVALID_INPUT` whose `detail` is a list of `{ path, message }` pairs and no other data. <!-- REQ-MCP-2 -->

---

### Requirement 7: Path Guard

**User Story:** As a user, I want every file operation confined to my workspace, so that a model-supplied path can never read or write elsewhere.

#### Acceptance Criteria

1. THE Path_Guard SHALL expose `guardPath(workspace, rel)` which returns the absolute path for `rel` or fails with `PATH_ESCAPE`, and every filesystem read or write in Lethe_MCP SHALL go through it. <!-- REQ-MCP-4, Rules-8 -->

2. IF `rel` is absolute, contains a NUL byte, or after normalisation resolves outside the Workspace (including `..` segments that appear only after normalisation), THEN THE Path_Guard SHALL fail with `PATH_ESCAPE`. <!-- REQ-MCP-4 -->

3. IF the real path of the target, or of its deepest existing ancestor, resolves outside the real path of the Workspace through a symbolic link, junction, or reparse point, THEN THE Path_Guard SHALL fail with `PATH_ESCAPE`. <!-- REQ-MCP-4 -->

4. WHILE the host is Windows, THE Path_Guard SHALL additionally reject, with `PATH_ESCAPE`: drive-letter-relative paths (`C:foo`), drive-absolute paths for another drive, UNC paths (`\\server\share`), device or extended-length prefixes (`\\?\`, `\\.\`), alternate data stream syntax (a `:` after the first path segment character), and names with trailing dots or spaces. <!-- REQ-MCP-4 -->

5. WHILE the host file system is case-insensitive (Windows, macOS default), THE Path_Guard SHALL compare Workspace prefix and ancestor paths case-insensitively, so that `D:\PROJ\Lethe\..` and `d:\proj\lethe` name the same Workspace. <!-- REQ-MCP-4 -->

6. THE Path_Guard SHALL treat `workspacePath` itself as untrusted: it SHALL resolve it to a real path once per call and use that value as the confinement root for the whole call. <!-- REQ-MCP-4 -->

7. FOR ALL `rel` strings generated from segments drawn from `..`, `.`, names, separators of both kinds, and drive-like prefixes, the result of `guardPath` SHALL either be a path whose real location is inside the Workspace or `PATH_ESCAPE` (property test; symlink cases covered by example tests where the OS permits creating links). <!-- REQ-MCP-4 -->

---

### Requirement 8: Atomic Writes, Backups, and Tombstone Integrity

**User Story:** As a user, I want an apply to be recoverable even if it is interrupted, so that steering and the crypt are never left half-written.

#### Acceptance Criteria

1. THE Atomic_Writer SHALL write each file by creating a temp file in the same directory as the target, writing the full content, calling `fsync` on the file, then renaming over the target; on any failure it SHALL remove the temp file and return `IO_FAILED`. <!-- REQ-CRY-6, Rules-8 -->

2. THE Atomic_Writer SHALL create missing parent directories and SHALL write content exactly as given (no newline translation, no BOM added or removed). <!-- NFR-3 -->

3. WHEN an apply is about to change files, THE Lethe_MCP SHALL first copy the pre-image of every file it will change (steering files, `tombstones.json`, `state.json`) to `Backup_Dir` at the same relative path under `.kiro/lethe/backup/<commit>/`. IF that directory already exists, THEN it SHALL use `<commit>-2`, `<commit>-3`, and so on, and SHALL never overwrite an existing backup. IF no file differs from its pre-image, THEN THE Lethe_MCP SHALL create no Backup_Dir. <!-- NFR-2 -->

4. WHEN the apply sequence of Requirement 4.6 reaches writing, THE Lethe_MCP SHALL write in this order: `tombstones.json`, steering files in ascending path order, then `state.json`, and write only files whose new content differs from the current content. <!-- REQ-CRY-6, INV-3 -->

5. IF any write fails after at least one file was written, THEN THE Lethe_MCP SHALL restore every already-written file from the Backup_Dir, remove files created by this apply, and return `IO_FAILED` with `applied: false`; IF the restoration itself fails, THEN `detail` SHALL list the files still differing and the `backupPath`. <!-- NFR-2 -->

6. IF `tombstones.json` exists and fails core's `parseTombstones`, THEN THE Lethe_MCP SHALL return `CONFIG_INVALID` for any apply and SHALL NOT rewrite, truncate, or replace that file. <!-- REQ-CRY-3, INV-3 -->

7. IF an apply produces no archived record and no restored record, THEN THE Lethe_MCP SHALL NOT create or rewrite `tombstones.json`. <!-- REQ-CRY-4 -->

8. FOR ALL JSON files written by Lethe_MCP, THE Lethe_MCP SHALL emit sorted-by-schema stable key order, 2-space indent, `\n` line endings, and a trailing newline, and tombstones SHALL be serialised with core's `serializeTombstones`. <!-- NFR-3, Arch-7 -->

9. FOR ALL archived engrams, THE tombstone `raw` written to disk SHALL be recoverable byte-exact by a subsequent `lethe_resurrect_engram` apply (end-to-end round trip through the filesystem, including CRLF files and files with a BOM). <!-- REQ-CRY-3, INV-3 -->

10. BEFORE the first file write of an apply, THE Lethe_MCP SHALL atomically write the journal `.kiro/lethe/pending.json` naming the Backup_Dir and every file the apply will change, and SHALL delete it after the last write succeeded or after a completed rollback. WHEN a mutating operation acquires the lock and finds `pending.json` (a previous apply was interrupted), THE Lethe_MCP SHALL restore every listed file from the named Backup_Dir, delete files the interrupted apply created, delete the journal, add a Diagnostic `INTERRUPTED_APPLY_RECOVERED`, and then continue with its own operation. <!-- NFR-2, INV-3 -->

---

### Requirement 9: Concurrency

**User Story:** As a user, I want a hook and an agent tool call that fire at the same moment to produce one consistent result, so that two writers never corrupt the crypt.

#### Acceptance Criteria

1. THE Lethe_MCP SHALL serialise every mutating operation (`lethe_consolidate_sleep` with apply, `lethe_resurrect_engram` with apply, `lethe sleep --apply`, `lethe resurrect --apply`, writes to `pbt-failures.json`, and `state.json` writes) on one Workspace by holding `Lock_File`, created with exclusive-create semantics and containing `{ pid, host, startedAt }` as JSON. <!-- NFR-2 -->

2. WHEN the lock is held, THE Lethe_MCP SHALL retry every 50 ms for up to 5000 ms, then return `LOCKED` with the holder's `pid`, `host`, and `startedAt` in `detail`. <!-- NFR-2 -->

3. WHEN the lock file is older than 600 seconds AND (the recorded `host` equals the current host AND the recorded `pid` is not a running process), THE Lethe_MCP SHALL treat it as stale, remove it, and acquire the lock; a lock whose owner cannot be shown dead SHALL NOT be removed. <!-- NFR-2 -->

4. THE Lethe_MCP SHALL release the lock on completion, on error, and on `SIGINT`/`SIGTERM`, and SHALL load the Workspace only after acquiring it, so that the second of two simultaneous applies re-plans on the first one's result. <!-- INV-4 -->

5. FOR ALL pairs of simultaneous `sleep --apply` runs on the same Workspace with the same `--commit` and `--now`, the final bytes of every file SHALL equal the bytes produced by one run alone, and exactly one run SHALL report a non-empty `archived` (the other reports an empty one or `LOCKED`). <!-- INV-4 -->

6. THE Ledger append of `lethe record` SHALL NOT take the lock; it SHALL perform one `write` of a complete line opened in append mode, so concurrent appenders produce whole lines. <!-- REQ-DEC-5 -->

---

### Requirement 10: Workspace Loader and Persistence Formats

**User Story:** As a developer, I want the on-disk formats for config, ontology, state, and ledger to be versioned and validated, so that a malformed file produces an error code instead of a crash.

#### Acceptance Criteria

1. THE Workspace_Loader SHALL read steering from `.kiro/steering/**/*.md`, specs from `.kiro/specs/**/*.md`, and key every `VirtualWorkspace` file by its Workspace-relative path using `/` separators (for example `.kiro/steering/03-rules.md`). <!-- Arch-3 -->

2. THE Workspace_Loader SHALL read each markdown file as UTF-8 without newline translation or BOM stripping. IF a file is larger than 1 MiB or is not valid UTF-8, THEN it SHALL be skipped with a Diagnostic and SHALL never be rewritten. <!-- REQ-MCP-6, REQ-PAR-5 -->

3. THE Workspace_Loader SHALL derive each `SpecInvariant` from `.kiro/specs/<name>/`: `specName` is the directory name; `requirementIds` is the sorted unique set of `REQ-[A-Z]+-[0-9]+` tokens in `requirements.md`; `stances` is the sorted unique list of ontology stance ids (for example `state:signals`, `mod:esm`) asserted with positive polarity in the paragraphs of `requirements.md` that contain the word `SHALL`, computed by core's `deriveSpecStances` with the merged ontology; `active` is `true` when `tasks.md` is absent or contains at least one line matching `^\s*- \[[ -]\]`, `false` otherwise, unless `config.json` `activeSpecs` lists the spec names explicitly, in which case that list decides. <!-- REQ-DEC-4 -->

4. THE Workspace_Loader SHALL read `.kiro/lethe/config.json` as `{ "version": 1, ...overrides of LetheConfig fields, "activeSpecs"?: string[] }`, reject unknown keys, merge it over core's `DEFAULT_CONFIG`, and validate the result with core's `validateConfig`. IF the file is absent THEN defaults apply; IF it fails to parse, has a wrong `version`, or fails validation, THEN the result SHALL be `CONFIG_INVALID` naming the file and the offending key. <!-- REQ-CON-5, NFR-3 -->

5. THE Workspace_Loader SHALL read `.kiro/lethe/ontology.json` as `{ "version": 1, "axes": Axis[] }`, validated with zod, and merge it through core's `mergeOntology`. IF absent, only the default ontology applies; IF malformed, the result SHALL be `CONFIG_INVALID`. <!-- REQ-CON-5 -->

6. THE Workspace_Loader SHALL read `.kiro/lethe/state.json` in the shape `{ "version": 1, "commit": number, "at": string, "ledger": { "lines": number, "bytes": number, "lastLineSha256": string | null }, "engrams": { "<id>": { "stability", "lastReinforcedCommit", "lastReinforcedAt", "reinforcements" } } }`, validated with zod, converting each entry to an `EngramState` whose `id` is the map key. `engrams` holds checkpointed states (ledger events up to the cursor `ledger` already folded in; Requirement 23). IF absent, THEN there are no states and the cursor is `{ lines: 0, bytes: 0, lastLineSha256: null }`; IF malformed, THEN `CONFIG_INVALID`. <!-- Arch-7 -->

7. THE Lethe_MCP SHALL write `state.json` only as a full checkpoint (Requirement 23.1) performed by: an apply of `lethe_consolidate_sleep` or `lethe_resurrect_engram`; `lethe adopt --apply`; or the stamping step of `lethe record` (Requirement 12.7). THE Lethe_MCP SHALL never write it from a Read_Only_Tool, `check`, `score`, or `probe`, and SHALL write `engrams` keys in ascending order. <!-- NFR-2 -->

8. THE Ledger SHALL hold one JSON object per line, each conforming to core's `LedgerEvent` (`type`, `at`, `commit`, optional `filesTouched`, optional `cited`) with fixed key order `type, at, commit, filesTouched, cited`. <!-- REQ-DEC-5, Arch-7 -->

9. WHEN reading the Ledger, THE Workspace_Loader SHALL ignore a final line that is unterminated (a torn write) and add a Diagnostic `LEDGER_TORN_TAIL`; IF a newline-terminated line is blank, fails to parse as JSON, or fails `LedgerEvent` validation, THEN it SHALL skip that line, add a Diagnostic `LEDGER_LINE_SKIPPED` naming the 1-based line number, and continue. Every newline-terminated line, skipped or not, SHALL count toward the cursor of Requirement 23. <!-- REQ-DEC-5 -->

10. WHEN appending to a Ledger whose last byte is not `\n`, THE `record` command SHALL first write a `\n` so a torn fragment is never merged with the new event; the fragment then becomes a skipped line under Requirement 10.9. <!-- REQ-DEC-5 -->

11. THE Workspace_Loader SHALL treat an absent `.kiro/crypt/tombstones.json` as an empty crypt, and SHALL read `tombstones.json` only for `sleep` and `resurrect`. <!-- REQ-CRY-3 -->

12. FOR ALL valid `config.json`, `ontology.json`, and `state.json` values, parse then serialise then parse SHALL produce an equal value, and serialisation SHALL be byte-identical for equal values (round-trip and determinism property over the zod-valid domain). <!-- NFR-3 -->

---

### Requirement 11: Commit Counter and Clock

**User Story:** As a developer, I want the commit counter and clock to be explicit and overridable, so that tests and hooks get deterministic results.

#### Acceptance Criteria

1. WHEN no override is given, THE Lethe_MCP SHALL obtain the Commit_Counter by running `git rev-list --count HEAD` in the Workspace with `execFile` (no shell), a 2000 ms timeout, and `source = "git"`. <!-- Arch-10 -->

2. IF git is not installed, the Workspace is not a repository, HEAD has no commits, the command times out, or its output is not a non-negative integer, THEN THE Lethe_MCP SHALL use `max(state.json commit, highest ledger commit, 0)` as the Commit_Counter with `source` equal to `"state"`, `"ledger"`, or `"zero"` respectively, and SHALL add a Diagnostic with the text "git commit count unavailable" (not an error). <!-- Arch-10 -->

3. WHERE `atCommit` (tools) or `--commit <n>` (CLI) is given, THE Lethe_MCP SHALL use it, with `source = "override"`, and SHALL NOT run git. <!-- REQ-DEC-6 -->

4. WHERE `now` (tools) or `--now <iso>` (CLI) is given, THE Lethe_MCP SHALL use it as `nowISO`; otherwise it SHALL read the system clock once per invocation and reuse that value throughout. IF the string is not a valid ISO 8601 date-time with `Z` or a numeric offset, THEN THE Lethe_MCP SHALL return `INVALID_INPUT` (CLI exit 64). <!-- REQ-DEC-6 -->

5. THE Lethe_MCP SHALL pass `nowCommit` and `nowISO` to core explicitly and SHALL keep every `Date`, `Math.random`, and `process` access outside `@lethe/core`. <!-- INV-7 -->

---

### Requirement 12: Reinforcement Ledger via `lethe record`

**User Story:** As a developer, I want hooks to log "this work happened" events, so that rules tied to touched files are reinforced.

#### Acceptance Criteria

1. WHEN `lethe record --type <task_passed|spec_cited|manual_pin>` runs, THE CLI SHALL append one `LedgerEvent` with `at` = `nowISO`, `commit` = Commit_Counter, `filesTouched` from `--files a,b` (comma-separated), and `cited` from `--cited x,y`. <!-- REQ-HOK-2, REQ-DEC-5 -->

2. WHERE `--files-from-git` is given, THE CLI SHALL set `filesTouched` to the sorted union of `git diff --name-only HEAD` and `git ls-files --others --exclude-standard`, with `/` separators, unique, capped at 500 entries (a Diagnostic notes truncation). IF git fails, THEN `filesTouched` SHALL be empty and a Diagnostic SHALL be reported. <!-- REQ-HOK-2 -->

3. THE CLI SHALL pass every `filesTouched` entry through the Path_Guard and drop (with a stderr warning) any entry that fails, so the Ledger never records a path outside the Workspace. <!-- REQ-MCP-4 -->

4. IF `--type` is `spec_cited` or `manual_pin` and `--cited` is empty, THEN THE CLI SHALL exit 64. A `task_passed` event with neither files nor cited MAY be recorded and its summary SHALL say that it matches no engram. <!-- REQ-DEC-5 -->

5. THE CLI summary for `record` SHALL describe reinforcement as "estimated utility" and SHALL NOT claim a rule was useful. <!-- Rules-12 -->

6. FOR ALL events appended, reading the Ledger back SHALL yield an event deep-equal to the one appended (append/read round trip). <!-- REQ-DEC-5 -->

7. WHEN the Ledger append succeeded, THE CLI SHALL perform the checkpoint of Requirement 23.1 under the lock with a wait budget of 1000 ms, so engrams without persisted state start to decay. IF the lock cannot be acquired or the checkpoint write fails, THEN THE CLI SHALL keep the appended event, exit 0, and report a Diagnostic `STATE_NOT_UPDATED`. <!-- REQ-DEC-5, REQ-HOK-2 -->

---

### Requirement 13: CLI Contract

**User Story:** As a hook author, I want a stable command-line contract with precise exit codes, so that Kiro hooks and a future Crew adapter can rely on it.

#### Acceptance Criteria

1. THE CLI SHALL provide subcommands `check`, `record`, `score`, `sleep`, `resurrect`, `adopt`, `probe`, and `serve`, and global options `--workspace <path>` (default: current directory), `--json`, `--now <iso>`, `--commit <n>`, `--help`, `--version`. <!-- Arch-8.1 -->

2. THE CLI SHALL map subcommands to behaviour as follows. `check`: the logic of `lethe_detect_contradictions` with `--scope`. `score`: `lethe_score_memories` with `--include-specs`. `sleep`: `lethe_consolidate_sleep` with `--apply`, `--budget <n>`, `--skip-gate`, `--gate-runs <n>`. `resurrect`: `lethe_resurrect_engram` with `--query <text>` and `--apply`. `record`: Requirement 12. `adopt`: the checkpoint of Requirement 23.1, as a dry-run unless `--apply` is given (CLI only, not an MCP tool). `probe`: Requirement 19. `serve`: start the MCP_Server. <!-- Arch-8.1 -->

3. THE CLI SHALL use these exit codes: **0** success; **1** a negative domain outcome (`check` found contradictions, the Gate failed, or `resurrect` matched nothing); **2** only when `--block` is given and the condition for exit 1 holds; **64** usage error; **70** `INTERNAL_ERROR`; **74** any other error (`IO_FAILED`, `LOCKED`, `PATH_ESCAPE`, `CONFIG_INVALID`, `PARSE_*`, `ONTOLOGY_INVALID_PATTERN`, `INVALID_INPUT` from semantic checks). <!-- Arch-8.1 -->

4. THE CLI SHALL exit 64 for an unknown subcommand, unknown option, missing required option, malformed number or ISO string, or the combination `--skip-gate` with `--apply`, and SHALL print a one-line usage hint to stderr. <!-- Arch-8.1 -->

5. WHERE `check` is run with `--fail-on <any|unresolvable|never>` (default `any`), THE CLI SHALL exit 1 when at least one report exists, when at least one report is `unresolvable`, or never, respectively. <!-- REQ-HOK-1 -->

6. THE shipped Hook_Files SHALL NOT pass `--block`, because exit code 2 only blocks on `PreToolUse`, `UserPromptSubmit`, and `PreTaskExec`; its effect on `PostFileSave` and `PostTaskExec` is undocumented. <!-- REQ-HOK-1 -->

7. WHILE `--json` is given, THE CLI SHALL print exactly one Envelope as a single JSON document followed by `\n` on stdout and nothing else on stdout, whether the command succeeded or failed. <!-- INV-8 -->

8. WHILE `--json` is absent, THE CLI SHALL print the human-readable `summary` and details to stdout when the exit code is 0, and to stderr when the exit code is non-zero, because Kiro adds stdout to agent context only on exit 0 and sends stderr to the agent on other non-zero exits. <!-- REQ-HOK-1 -->

9. THE CLI SHALL NOT read stdin except in `probe`, so that a hook invocation never blocks waiting for input. <!-- REQ-HOK-1 -->

10. THE CLI contract (subcommand names, option names, exit codes, Envelope shape) SHALL be stable: a contract test SHALL snapshot `--help` output and the exit-code table, so a later Crew_Adapter can depend on it. <!-- Arch-8.3 -->

---

### Requirement 14: PBT Gate Integration

**User Story:** As a maintainer, I want consolidation to refuse to apply when any safety property fails, so that a broken engine can never delete a rule.

#### Acceptance Criteria

1. WHEN `lethe_consolidate_sleep` or `lethe sleep` runs with the gate enabled, THE Lethe_MCP SHALL call `runPbtGate(cfg, { numRuns })` from `@lethe/core/properties` with `numRuns` = `gateRuns` / `--gate-runs` (default 100) and the effective `LetheConfig`. <!-- REQ-PBT-3 -->

2. THE result's `pbtGate` SHALL be `"passed"` when the gate passed, `"failed"` when it failed, and `"skipped"` only when `skipGate` / `--skip-gate` was passed explicitly and `apply` is `false`. <!-- REQ-PBT-3 -->

3. IF the Gate fails and `apply` is `true`, THEN THE Lethe_MCP SHALL return `PBT_GATE_FAILED` with `detail` = `{ propertyId, seed, counterexample }` and SHALL NOT write any file other than `pbt-failures.json` (CLI exit 1). <!-- REQ-PBT-3, REQ-PBT-2 -->

4. WHEN the Gate fails (with or without `apply`), THE Lethe_MCP SHALL build the record with core's `pbtFailureEntry(result, nowISO)` and the new file text with `appendPbtFailure(existingText, entry)`, then write `.kiro/lethe/pbt-failures.json` atomically under the lock. A malformed existing file SHALL be replaced as core's helper specifies (documented, covered by an example test). <!-- REQ-PBT-2 -->

5. IF the Gate fails and `apply` is `false`, THEN THE Lethe_MCP SHALL return `ok: true` with `pbtGate: "failed"` and `data.gateFailure` = the failure detail, and SHALL leave every other file untouched. <!-- REQ-PBT-3 -->

6. THE Gate SHALL be loaded lazily: THE MCP_Server SHALL NOT import `fast-check` or the property modules until the first gate run in that process. <!-- REQ-MCP-5 -->

7. FOR ALL seeds, a Gate failure injected through a test double SHALL leave steering files and `tombstones.json` byte-identical to before the call when `apply` is `true`. <!-- REQ-PBT-3, NFR-2 -->

---

### Requirement 15: Kiro Hooks (`v1` format)

**User Story:** As a developer using Kiro, I want committed hooks that check contradictions and record task events, so that Lethe runs inside my normal workflow.

#### Acceptance Criteria

1. THE repository SHALL contain `.kiro/hooks/lethe-check-on-save.json` in `v1` format with one hook: `trigger: "PostFileSave"`, a `matcher` regular expression matching Workspace-relative `.kiro/steering/**/*.md` and `.kiro/specs/**/*.md` paths with either separator style, `action: { "type": "command", "command": "node packages/lethe-mcp/dist/lethe.mjs check --workspace ." }`, and `timeout: 30`. <!-- REQ-HOK-1 -->

2. THE repository SHALL contain `.kiro/hooks/lethe-record-on-task.json` in `v1` format with one hook: `trigger: "PostTaskExec"`, `action.command` = `node packages/lethe-mcp/dist/lethe.mjs record --workspace . --type task_passed --files-from-git`, and `timeout: 30`. THE hook SHALL use `git diff --name-only` semantics for `filesTouched` unless Requirement 20 verifies a payload field listing touched files, in which case the hook MAY be changed to use it. <!-- REQ-HOK-2 -->

3. WHERE `PostFileSave` does not fire for user saves (assumption A1), THE contradiction check SHALL remain available on demand through `lethe_detect_contradictions` and `lethe check`, and `lethe-sleep.md` (Requirement 16) SHALL instruct the agent to run it before consolidation. <!-- REQ-HOK-1 -->

4. THE Hook_Files SHALL validate against the `v1` shape in a unit test: `version` is `"v1"`, every hook has `name`, a PascalCase `trigger` from the verified list, and an `action` of type `command` or `agent`; `timeout` is a number when present; no `.kiro.hook` files exist. <!-- REQ-HOK-1, REQ-HOK-2 -->

5. WHEN a shipped command hook runs with exit code 0, THE CLI output on stdout SHALL be at most 2000 characters, so the context added to the agent stays small. <!-- REQ-HOK-1 -->

6. WHEN `check` finds contradictions, THE CLI SHALL exit 1 and write to stderr a summary of at most 2000 characters listing for each report the axis, the two ids, and the resolution, so Kiro forwards it to the agent. <!-- REQ-HOK-1 -->

7. THE repository SHALL contain `.kiro/hooks/lethe-probe.json` with two `enabled: false` hooks (`PostFileSave` and `PostTaskExec`) running `node packages/lethe-mcp/dist/lethe.mjs probe --workspace .`, used only for Requirement 20. <!-- REQ-HOK-1 -->

---

### Requirement 16: On-Demand Sleep Workflow and Repository Hygiene

**User Story:** As a developer, I want a slash command that walks me through a safe consolidation, so that burying rules always has a visible report and my confirmation.

#### Acceptance Criteria

1. THE repository SHALL contain `.kiro/steering/lethe-sleep.md` with front matter `inclusion: manual`, so it is not part of default context and is runnable as `/lethe-sleep`. <!-- REQ-HOK-3 -->

2. THE steering file SHALL instruct the agent to: (1) call `lethe_detect_contradictions` and report results; (2) call `lethe_consolidate_sleep` with `apply: false` and present `archived`, `merged`, `demoted`, `tokensBefore`, `tokensAfter`, `budgetStatus`, and `pbtGate`; (3) apply with `apply: true` only after `pbtGate` is `"passed"` and the user explicitly confirms; (4) never pass `skipGate` with `apply`; (5) report `backupPath` and how to call `lethe_resurrect_engram`. <!-- REQ-HOK-3, REQ-PBT-3 -->

3. THE steering file SHALL stay at or below 600 tokens (`ceil(chars/4)`) so it adds little context when included, and a unit test SHALL assert that bound and the `inclusion: manual` front matter. <!-- Prime-token-budget -->

4. THE repository SHALL NOT list `.kiro/` or any `.kiro/` subfolder in any `.gitignore`, and a test SHALL assert this for the root `.gitignore` and every nested one. <!-- REQ-HOK-4 -->

5. THE repository SHALL track `.kiro/specs/`, `.kiro/steering/`, `.kiro/hooks/`, and `.kiro/settings/mcp.json`. <!-- REQ-HOK-4 -->

---

### Requirement 17: MCP Registration

**User Story:** As a developer cloning the repo, I want Kiro to find the Lethe server without manual setup, so that the four tools are available immediately.

#### Acceptance Criteria

1. THE repository SHALL contain `.kiro/settings/mcp.json` equal to `{ "mcpServers": { "lethe": { "command": "node", "args": ["packages/lethe-mcp/dist/lethe.mjs", "serve"], "autoApprove": ["lethe_score_memories", "lethe_detect_contradictions"] } } }`. <!-- REQ-MCP-1 -->

2. THE `autoApprove` list SHALL contain only Read_Only_Tool names, never `*`, `lethe_consolidate_sleep`, or `lethe_resurrect_engram`, and a test SHALL assert this. <!-- REQ-MCP-3 -->

3. THE registration SHALL NOT use the `env` field or `${VAR}` expansion for anything required to start or run the server. <!-- Platform-fact -->

4. THE registration SHALL NOT set `disabled: true` and SHALL NOT list any of the four tools in `disabledTools`. <!-- REQ-MCP-1 -->

5. IF assumption A4 is false (the server's working directory is not the Workspace root, so the relative `args` path fails), THEN THE README SHALL document registering the server in user-level `~/.kiro/settings/mcp.json` with an absolute path to `dist/lethe.mjs`; this fallback SHALL be verified per Requirement 20. <!-- Platform-fact -->

---

### Requirement 18: Packaging and Distribution

**User Story:** As a maintainer without Bun, I want a single bundled file runnable with plain Node, so that the server, CLI, and hooks work on Windows, macOS, and Linux with no toolchain.

#### Acceptance Criteria

1. THE package SHALL build the Bundle `packages/lethe-mcp/dist/lethe.mjs` with esbuild as an ES module for Node 22+, inlining `@lethe/core` (TypeScript sources with `.js` import suffixes), `@modelcontextprotocol/sdk` (v1.x line, exact version pinned), `zod`, and `fast-check`. <!-- NFR-4 -->

2. WHEN `node dist/lethe.mjs <subcommand>` is run on Windows, macOS, or Linux with Node 22 or newer, THE Bundle SHALL run with no `bun`, `ts-node`, or `tsx` installed and with no `node_modules` present next to it. <!-- NFR-4 -->

3. THE Bundle SHALL begin with a `#!/usr/bin/env node` line and the package SHALL declare `bin: { lethe: "dist/lethe.mjs" }`. <!-- Arch-8.1 -->

4. THE repository SHALL commit `dist/lethe.mjs` so `.kiro/settings/mcp.json` and the hooks work from a fresh clone, and a drift test SHALL fail when a fresh build differs from the committed file. <!-- REQ-HOK-4 -->

5. THE package SHALL declare pinned exact versions for `@modelcontextprotocol/sdk`, `zod`, and the bundler, and SHALL declare `engines.node >= 22`. <!-- Rules-9 -->

6. THE Bundle SHALL make no network request and SHALL contain no analytics or telemetry. <!-- NFR-1 -->

7. THE Bundle SHALL be built without source maps, with no absolute path and no `sourceMappingURL` in its text, and the repository SHALL declare `dist/lethe.mjs` and all sources as LF in `.gitattributes`, so the drift test of Requirement 18.4 compares identical bytes on every operating system. <!-- REQ-HOK-4 -->

---

### Requirement 19: Logging, Stdout Hygiene, and `probe`

**User Story:** As a protocol client, I want stdout to carry only MCP traffic, so that a stray log line never corrupts the stream.

#### Acceptance Criteria

1. WHILE `lethe serve` runs, THE MCP_Server SHALL write only MCP protocol messages to stdout and SHALL write all logs to stderr. <!-- INV-8, REQ-MCP-6 -->

2. THE lethe-mcp source SHALL contain no `console.log`, `console.info`, `console.debug`, or `process.stdout.write` outside the single protocol/Envelope output module, enforced by a lint or grep test. <!-- INV-8 -->

3. WHEN the stdout stream has been fully collected from a session that called all four tools (including error cases), every line SHALL parse as JSON-RPC 2.0. <!-- INV-8 -->

4. WHEN `lethe probe` runs, THE CLI SHALL read stdin until EOF (capped at 1 MiB and 2000 ms), and write `.kiro/lethe/probe/<YYYYMMDDTHHMMSSmmmZ>-<event>.json` containing `{ receivedAt, argv, cwd, stdinRaw, stdinParsed? }`, where `<event>` is the sanitised `hook_event_name` or `unknown`, `stdinParsed` is present only when stdin is valid JSON, and the environment is never captured. <!-- Verification -->

5. THE `probe` command SHALL exit 0 after a successful write, print one confirmation line, and exit 74 only if the write fails; it SHALL never emit non-zero for unparseable stdin. <!-- Verification -->

---

### Requirement 20: Platform Verification

**User Story:** As a maintainer, I want unverified Kiro behaviour captured with real payloads and recorded, so that no claim in the write-up rests on an assumption.

#### Acceptance Criteria

1. THE project SHALL include a verification task that enables `.kiro/hooks/lethe-probe.json` inside Kiro, performs (a) an agent file save under `.kiro/steering/`, (b) a user save of the same file in the editor, and (c) completion of one spec task, then collects the files in `.kiro/lethe/probe/`. <!-- REQ-HOK-1, REQ-HOK-2 -->

2. WHEN the verification is complete, THE results for A1 to A6 SHALL be recorded as verified answers (or "not reproducible") in `.kiro/steering/06-memory.md` under "Verified Platform Facts", with the date and a payload field list that contains no session identifiers. <!-- Rules-0.5 -->

3. IF the verification contradicts a hook design here (for example `PostFileSave` ignores user saves, or `PostTaskExec` exposes a touched-files field), THEN THE affected requirement text and Hook_File SHALL be updated in the same change. <!-- REQ-HOK-1 -->

4. THE verification task SHALL delete `.kiro/lethe/probe/` after the facts are recorded and SHALL set `enabled: false` on the probe hooks. <!-- Rules-9 -->

---

### Requirement 21: Testing

**User Story:** As a maintainer, I want layered tests over the IO shell, so that every safety claim in this spec is machine-checked.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for: `guardPath` (property test per Requirement 7.7 plus fixed vectors for `..` after normalisation, drive-letter-relative, UNC, ADS, trailing dot, symlink escape where creatable, case-insensitive prefix); Atomic_Writer (temp cleanup on failure, no partial target, content exactness); lock (exclusive create, wait budget, stale takeover, no takeover of live owner); and Ledger tolerance (torn last line, bad middle line, newline repair). <!-- REQ-MCP-4, NFR-2 -->

2. THE test suite SHALL include contract tests driving the MCP_Server through an in-memory MCP transport that: list exactly 4 tools; validate each schema with accepted and rejected examples; assert dry-run default and `apply: true` requirement on both Mutating_Tools; and assert the error `code` for each failure class in Requirement 6. <!-- REQ-MCP-1, REQ-MCP-2, REQ-MCP-3, REQ-MCP-6 -->

3. THE test suite SHALL include CLI tests against temporary Workspaces covering each subcommand, each exit code in Requirement 13.3, `--json` single-document output, and the stdout/stderr split of Requirement 13.8. <!-- Arch-8.1 -->

4. THE test suite SHALL include an end-to-end test that spawns `node dist/lethe.mjs serve` as a child process, performs the MCP initialise handshake over stdio, calls all four tools, and asserts Requirement 19.3. <!-- INV-8 -->

5. THE test suite SHALL include a golden test that materialises `generateHauntedRepo` from `@lethe/core/fixtures` into a temporary directory, runs `lethe sleep --apply` with fixed `--commit` and `--now`, and compares the resulting files, `tombstones.json`, and `state.json` byte for byte with checked-in golden files; it SHALL then run `lethe resurrect --apply` for every tombstone and assert every steering file equals the pre-sleep bytes, except for the documented bullet-mode limitation. <!-- INV-3, INV-4, NFR-3 -->

6. THE test suite SHALL include a concurrency test spawning two `sleep --apply` processes on one temporary Workspace and asserting Requirement 9.5. <!-- INV-4 -->

7. THE test suite SHALL include a failure-injection test for each of: Gate failure (Requirement 14.7), write failure mid-apply with restoration (Requirement 8.5), and malformed `tombstones.json` (Requirement 8.6). <!-- NFR-2 -->

8. THE test suite SHALL include, for Requirement 23: the split-equivalence property (23.4), an end-to-end test that runs `sleep --apply` twice through the real IO layer with fixed `--commit` and `--now` and asserts that the Workspace tree (including `state.json` and the Backup_Dir listing) is byte-identical after the second run, a first-seen decay test (23.5 and 23.6), a ledger-rewrite test (23.7), and a future-commit test (23.3). <!-- INV-4, REQ-DEC-5 -->

9. THE test suite SHALL cover each `REQ-MCP-*`, `REQ-HOK-*`, and `NFR-*` id in this document with at least one test, and each test file SHALL cite the ids it covers. <!-- Rules-11 -->

---

### Requirement 22: Non-Functional Constraints

**User Story:** As a user, I want the server to be fast, quiet, and offline, so that it is invisible until it is needed.

#### Acceptance Criteria

1. WHEN `lethe serve` is started with a 100-engram Workspace, THE MCP_Server SHALL complete the MCP initialise handshake in under 500 ms, measured from process spawn to the `initialize` response in a warm Node 22 environment. <!-- REQ-MCP-5 -->

2. WHEN `lethe_score_memories` is called on a 500-engram Workspace in a warm process, THE Tool SHALL return in under 250 ms end to end (read files, parse, score, build Envelope), excluding the git command. <!-- NFR-1 -->

3. THE Lethe_MCP SHALL run on Node 22 or newer and SHALL make no network requests and emit no telemetry. <!-- NFR-1, NFR-4 -->

4. THE Lethe_MCP source SHALL follow `03-rules`: TypeScript strict mode with zero `any`, ESM only, at most 200 lines per file and 40 lines per function, and no `console.log` (Requirement 19.2). <!-- Rules-1 -->

5. THE Lethe_MCP SHALL keep read-only operations free of side effects, and any write SHALL stay under `.kiro/` (steering files, `.kiro/crypt/`, `.kiro/lethe/`), enforced by a test that diffs the full Workspace tree before and after each Read_Only_Tool call. <!-- NFR-2 -->

---

### Requirement 23: State Checkpointing, Ledger Cursor, and First-Seen Stamping

**User Story:** As a developer, I want persisted retention state that never counts a reinforcement twice and that starts decaying the moment a rule is first adopted, so that stale rules really fade and repeated runs give identical results.

#### Acceptance Criteria

1. THE Lethe_MCP SHALL compute every `state.json` write as a Checkpoint: (a) read the Ledger lines after the Cursor; (b) take the Consumable_Prefix of those lines (blank or skipped lines are consumable); (c) fold the Consumable_Prefix into the persisted state of every engram that has one, using core's `score` so that core's `reinforce` rules apply; (d) give every scanned steering engram that has no persisted state a Stamp that no Ledger event modifies; (e) set the Cursor to the end of the Consumable_Prefix. <!-- REQ-DEC-5, REQ-DEC-6 -->

2. WHEN a tool or command scores engrams, THE Lethe_MCP SHALL pass core the in-memory Checkpoint states together with only the Ledger events after the Consumable_Prefix, so that no Ledger event is applied more than once to any state. <!-- INV-4 -->

3. WHEN a Ledger line has a `commit` greater than the call's `nowCommit`, THE Lethe_MCP SHALL leave that line and all later lines unconsumed until a call whose `nowCommit` is at least that commit. <!-- REQ-DEC-6 -->

4. FOR ALL Ledgers, all partitions of the Ledger into consecutive Checkpoint runs with non-decreasing `nowCommit`, and all initial state sets, THE persisted states of engrams present in every run SHALL equal the states produced by one replay of the same events in file order over the same initial states (split-equivalence property). <!-- INV-4, NFR-3 -->

5. WHERE an engram has no persisted state, THE Read_Only_Tool SHALL score it with a Stamp at the call's `nowCommit` and `nowISO`, report `firstSeen: "synthesised"` for it (all others `"persisted"`), and add one Diagnostic `FIRST_SEEN_SYNTHESISED` whose message gives the number of such steering engrams and states that their retention is 1 by construction until `lethe adopt --apply`, `lethe record`, or an apply stamps them. <!-- REQ-DEC-6 -->

6. FOR ALL unprotected engrams stamped at commit `c0` and instant `t0` with no reinforcing event, THE retention scored at commit `c0 + n` and instant `t0` SHALL equal `exp(-n / s0)` and SHALL be non-increasing in `n`; with the default configuration the tier is Hot for `n <= 2`, Warm for `3 <= n <= 6`, and Crypt for `n >= 7`. <!-- REQ-DEC-1, REQ-DEC-2 -->

7. IF the Ledger has fewer bytes than `Cursor.bytes`, or the line ending at byte `Cursor.bytes` does not hash to `Cursor.lastLineSha256`, THEN a Read_Only_Tool SHALL ignore all Ledger events and add a Diagnostic `LEDGER_REWRITTEN`, and a Checkpoint SHALL move the Cursor to the end of the current Ledger without folding any event and add the same Diagnostic. <!-- REQ-DEC-5 -->

8. THE Lethe_MCP SHALL rewrite `state.json` only when its `engrams` or `ledger` value differs from the stored value, and SHALL set `commit` and `at` to the Checkpoint's `nowCommit` and `nowISO` when it writes. <!-- NFR-3, INV-4 -->

9. WHEN a Checkpoint is written, THE Lethe_MCP SHALL remove from `engrams` the ids archived by that apply and the ids that match no engram in the scanned steering files; IF at least one steering file was skipped (parse failure, size, or encoding), THEN it SHALL remove only the archived ids. <!-- INV-3 -->

10. FOR ALL Workspaces, running the Checkpoint a second time with the same `nowCommit` and `nowISO` SHALL change no file (idempotence through the persistence layer). <!-- INV-4 -->

11. THE `adopt` subcommand SHALL report `{ stamped, foldedEvents, pruned }` and write nothing unless `--apply` is given; WHEN `--apply` is given, THE CLI SHALL write only `state.json`, atomically, under the lock, and without creating a Backup_Dir. <!-- REQ-DEC-5 -->

12. WHERE `includeSpecs` is `true`, THE Lethe_MCP SHALL score spec engrams with Stamps that are never persisted, report them as `firstSeen: "synthesised"`, and exclude them from the count in the `FIRST_SEEN_SYNTHESISED` Diagnostic. <!-- REQ-MCP-2 -->

13. IF the call's `nowCommit` is less than `state.json` `commit`, THEN THE Lethe_MCP SHALL add a Diagnostic `COMMIT_BEFORE_CHECKPOINT` and SHALL NOT fail. <!-- REQ-DEC-6 -->

---

## Non-Goals and Deferred Work

- **Kiro Crew integration is out of scope.** Heartbeat or cron scheduling, Lessons ingestion, Crew hook events, and the Crew App manifest are unverified and deferred. The CLI contract (Requirement 13.10) is kept stable so a Crew_Adapter can call `lethe sleep` and `lethe record` later.
- No LLM calls, no vector search, no network service, no authentication.
- No new MCP tools beyond the four, no MCP resources or prompts.
- No automatic backup pruning; backups are kept until the user deletes them.
- No editing of `.kiro/steering/02-architecture.md` in this spec (documentation debt noted in the Introduction).
- No Web Studio code; `apps/web` consumes `@lethe/core` only.

## Open Items for Design

All four items are resolved in `design.md`:

- **OQ-1** (resolved) Core's `score` replays every Ledger event with `commit <= nowCommit` over the states it receives, so persisting post-replay states double counts. Resolved by Requirement 23 (checkpointed states plus a Ledger cursor). Never-persisted engrams never decayed; resolved by Requirement 23.1(d), 23.5, and 23.6.
- **OQ-2** (resolved) Stances are ontology stance ids; derived by core's `deriveSpecStances` (a small API addition to `@lethe/core`, see design "Core follow-ups"). Requirement 10.3 is amended.
- **OQ-3** (resolved) The drift test is deterministic across operating systems with esbuild, no source maps, LF normalisation, and `.gitattributes` (Requirement 18.7).
- **OQ-4** (resolved) `includeSpecs` defaults to `false`.
