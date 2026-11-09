# Requirements Document

## Introduction

`lethe-core` is the pure TypeScript engine at the heart of the Lethe project — a biomimetic memory-decay system for Kiro steering files. It implements the Ebbinghaus forgetting curve to score every rule in `.kiro/steering/*.md` and `.kiro/specs/**/*.md`, detects contradictions between steering engrams, buries stale or defeated rules into a reversible cold store, and proves its own safety invariants with property-based tests.

The package has zero runtime dependencies and runs identically on Node 22+, Bun, and modern browsers. It is consumed by `lethe-mcp` (the Node IO shell that provides MCP tools and the `lethe` CLI) and `apps/web` (the browser sandbox studio). All IO, clock access, and filesystem operations are strictly forbidden inside this package; those concerns belong to the calling layer.

This document covers five subsystems: the Engram Parser, the Decay Engine, the Contradiction Detector, the Consolidation & Crypt system, and the Property-Based Testing suite.

---

## Glossary

- **Engram**: A single unit of memory — one H2/H3 section (or top-level bullet, depending on granularity) parsed from a steering or spec markdown file. An engram has a stable identity, a body, a content hash, and decay metadata.
- **Stability (`S`)**: A per-engram coefficient (in commit-units) controlling how quickly it decays. Starts at `S0 = 5`; grows with each reinforcement via spaced-repetition multiplication; capped at `S_MAX = 120`.
- **Retention (`R`)**: The current memory strength of an engram, computed as `R = exp(-Δc / (S·W))`. Always in the range `(0, 1]`. Determines the engram's tier and eligibility for eviction.
- **Effective Age (`Δc`)**: The number of commit-equivalent units since the engram was last reinforced. Calculated as commits since last reinforcement plus `α × days` since last reinforcement (default `α = 0.25`).
- **Weight (`W`)**: A multiplier applied to `S` during decay. `W = 1` for normal engrams; `W = 4` for engrams linked to an active spec or pinned. Higher weight slows decay.
- **Tier**: The three-level classification of an engram based on its retention score. Hot (`R ≥ 0.60`), Warm (`0.25 ≤ R < 0.60`), or Crypt (`R < 0.25` or defeated).
- **Tombstone**: A byte-exact archival record of a buried engram stored in `.kiro/crypt/tombstones.json`. Contains the full original body, all metadata, and the reason for burial. Fully reversible via resurrection.
- **Crypt**: The cold store where tombstones are kept. An engram in the Crypt is invisible to the model but can be resurrected at any time.
- **Ontology**: The conflict-detection knowledge base: a set of named axes, each containing mutually exclusive stances with trigger patterns. Shipped as a default set of ≥ 12 axes and user-extensible via `ontology.json`.
- **Stance**: A named position within a conflict axis (e.g., `css:tailwind` or `css:pure-css`). Stances within the same axis are mutually exclusive.
- **Axis**: A named dimension of conflict (e.g., `css-approach`, `state-management`). Two engrams conflict when they assert opposing stances on the same axis.
- **Ledger Event**: An append-only record of a reinforcement signal: `task_passed`, `spec_cited`, or `manual_pin`. Contains a commit counter, ISO timestamp, and optional file/id lists. The sole input to the reinforcement function.
- **Virtual Workspace**: An in-memory representation of the workspace as a `Map<path, string>` plus the tombstone list. The Node IO layer loads disk into it; the browser sandbox uses a seeded fixture generator. Core operates exclusively on Virtual Workspaces.
- **Protected Engram**: An engram that is either `pinned` or linked to an active spec. Protected engrams are never archived during consolidation and always have `R ≥ 0.50`.
- **ConsolidationPlan**: A dry-run description of all pending actions (archive, merge, demote) computed by `planConsolidation`. No mutation occurs until `applyPlan` is called with `apply: true`.

---

## Requirements

### Requirement 1: Engram Parser

**User Story:** As a developer using `lethe-core`, I want to parse markdown steering and spec files into structured engram objects, so that the decay engine and contradiction detector can operate on discrete, addressable units of memory with stable identities.

#### Acceptance Criteria

1. WHEN `parseDocument` is called with a markdown file containing H2 or H3 sections and `granularity` is `"section"`, THE Parser SHALL split the document into one `EngramNode` per H2/H3 section. Each engram's body spans from the line after its heading marker up to (but not including) the next heading of equal or higher level, or end-of-document. <!-- REQ-PAR-1 -->

2. WHEN `parseDocument` is called with a markdown file containing top-level list items and `granularity` is `"bullet"`, THE Parser SHALL split the document into one `EngramNode` per top-level list item, where each engram's body includes any nested sub-list content under that item. <!-- REQ-PAR-1 -->

3. THE Parser SHALL assign each engram a stable `id` computed as the slug of `relativePath#headingPath`. For `granularity:"section"`, `headingPath` is the slash-joined sequence of ancestor and own heading texts from outermost to innermost (e.g. `"Section Title/Sub-Section"`). For `granularity:"bullet"`, `headingPath` is the zero-based decimal index of the bullet item (e.g. `"0"`, `"1"`). The slug function lowercases, replaces non-alphanumeric character runs with single hyphens, and trims leading and trailing hyphens. <!-- REQ-PAR-2 -->

4. THE Parser SHALL assign each engram a `contentHash` computed as the SHA-256 of the normalized body text (trailing whitespace stripped per line, CRLF normalized to LF before hashing). The `id` and `contentHash` SHALL be computed independently: editing the body SHALL change `contentHash` without changing `id`. <!-- REQ-PAR-2 -->

5. THE Parser SHALL compute `tokens` for each engram as `Math.ceil(body.length / 4)`, using only the character count of the body string and no external tokenizer. <!-- REQ-PAR-3 -->

6. WHEN a section body contains an annotation comment of the form `<!-- lethe: globs=a,b; spec=name1,name2; pin=true -->`, THE Parser SHALL parse it into: `globs` as an array of trimmed glob strings (empty array when `globs` key is absent); `specLinks` as an array of trimmed spec name strings (empty array when `spec` key is absent); and `pinned` as `true` when `pin=true` is present, `false` otherwise. Unrecognized keys SHALL be silently ignored. <!-- REQ-PAR-4 -->

7. WHEN a markdown document is parsed into a `ParsedDoc` via `parseDocument` (returning a `Result` success) and then serialized with `serializeDocument`, THE serialized output SHALL be byte-for-byte identical to the original input string. <!-- REQ-PAR-5 -->

8. WHEN a steering file begins with YAML frontmatter (a block where the file's first line is exactly `---` and a subsequent line is exactly `---`), THE Parser SHALL preserve the frontmatter block unchanged in the serialized output and SHALL NOT produce an `EngramNode` for the frontmatter content. <!-- REQ-PAR-6 -->

9. WHEN `parseDocument` encounters two engrams with the same computed `id` in a single document, THE Parser SHALL return a `Result` failure with error code `PARSE_DUPLICATE_ID` and SHALL NOT return any partial engram list. <!-- REQ-PAR-2 -->

10. IF a document begins with `---` on the first line but has no subsequent line containing only `---` before the first heading or end-of-document, THEN THE Parser SHALL return a `Result` failure with error code `PARSE_INVALID_FRONTMATTER`. <!-- REQ-PAR-6 -->

11. THE Parser SHALL record the `span` of each engram as `{ start: number; end: number }` character offsets in the original file string, where `start` is the index of the first character of the heading line (or bullet marker), `end` is exclusive (one past the last character of the section body), and the invariant `fileString.slice(span.start, span.end)` reconstructs the full source text for that engram. <!-- REQ-PAR-5 -->

12. WHEN `parseDocument` is called on a document that contains no headings (for `granularity:"section"`) or no top-level list items (for `granularity:"bullet"`), THE Parser SHALL return a `Result` success containing an empty `EngramNode` array. <!-- REQ-PAR-1 -->

---

### Requirement 2: Decay Engine

**User Story:** As a developer using `lethe-core`, I want to score every engram with a retention value derived from the Ebbinghaus forgetting curve, so that rules the project has recently relied on stay prominent while stale ones naturally fade.

#### Acceptance Criteria

1. THE Decay Engine SHALL compute retention as `R = exp(-Δc / (S · W))` for each engram, where `Δc` is the effective age in commit-units, `S` is the engram's current stability, and `W` is the weight. The result SHALL satisfy `0 < R ≤ 1` for all valid inputs (`S > 0`, `W ≥ 1`, `Δc ≥ 0`). <!-- REQ-DEC-1, INV-2 -->

2. THE Decay Engine SHALL compute `Δc` as `commitsSinceReinforcement + cfg.alpha × daysSinceReinforcement`, where both components are non-negative real numbers derived from `nowCommit`, `nowISO`, and the corresponding `EngramState` fields supplied as explicit parameters. The default value of `cfg.alpha` is `0.25`. <!-- REQ-DEC-1, REQ-DEC-6 -->

3. WHILE an engram receives no new reinforcement, THE Decay Engine SHALL produce monotonically non-increasing `R` values as `Δc` increases. For any two effective ages `Δc₁ ≤ Δc₂` with the same `S` and `W`, `R(Δc₁) ≥ R(Δc₂)`. <!-- REQ-DEC-2, INV-2 -->

4. WHEN the `score` function processes a `LedgerEvent` of type `task_passed`, `spec_cited`, or `manual_pin` that matches an engram (per criterion 9), THE Decay Engine SHALL reinforce that engram's state by: (a) setting `stability` to `min(S · (1 + cfg.beta), cfg.sMax)` where `cfg.beta = 0.5` and `cfg.sMax = 120` by default; (b) setting `lastReinforcedCommit` to the event's `commit`; (c) setting `lastReinforcedAt` to the event's `at` ISO string; (d) incrementing `reinforcements` by 1. When computing `Δc` for a reinforced engram, `commitsSinceReinforcement` and `daysSinceReinforcement` are both zero. <!-- REQ-DEC-3 -->

5. THE Decay Engine SHALL enforce `S ≥ cfg.sMin` at all times, where `cfg.sMin > 0` (default `0.5`). IF a stored state has `stability < cfg.sMin`, THE Decay Engine SHALL clamp it to `cfg.sMin` before computing `R`, so the denominator `S · W` is always positive and `R` is always a finite value greater than zero. <!-- REQ-DEC-1, INV-2 -->

6. WHEN an engram's `specLinks` array contains a name that matches any `SpecInvariant` in the input where `active` is `true`, THE Decay Engine SHALL apply `W = cfg.wSpec` (default `4`) to that engram's retention computation. For engrams with no active-spec match and `pinned: false`, `W = cfg.wDefault` (default `1`). <!-- REQ-DEC-4 -->

7. WHEN an engram is spec-linked (per criterion 6), THE Decay Engine SHALL enforce `retention = Math.max(rawRetention, cfg.specFloor)` where `cfg.specFloor = 0.50` by default, after computing `rawRetention` from the formula. The `ScoredEngram` SHALL carry both `rawRetention` and `retention` fields. <!-- REQ-DEC-4, INV-1 -->

8. WHEN an engram has `pinned: true`, THE Decay Engine SHALL treat it identically to a spec-linked engram: apply `W = cfg.wSpec` and enforce `retention ≥ cfg.specFloor`. An engram that is both pinned and spec-linked receives only one application of `wSpec` (not compounded). <!-- REQ-DEC-7, INV-1 -->

9. THE Decay Engine SHALL derive reinforcement eligibility exclusively from `LedgerEvent` records in the `ledger` input. A `task_passed` event reinforces an engram if and only if: (a) the event's `filesTouched` array contains at least one path that matches any pattern in the engram's `globs` array using minimatch-compatible glob semantics; OR (b) the event's `cited` array contains the engram's exact `id` string; OR (c) the event's `cited` array contains a string that matches any element of the engram's `specLinks` array. A `spec_cited` or `manual_pin` event reinforces an engram when its `cited` array satisfies (b) or (c). <!-- REQ-DEC-5 -->

10. THE `score` function signature SHALL require `nowCommit: number` (non-negative integer) and `nowISO: string` (ISO 8601 date-time) as explicit input parameters. The function SHALL NOT call `Date.now()`, `new Date()` without an argument, `Math.random()`, `process.hrtime()`, or any IO function. <!-- REQ-DEC-6, INV-7 -->

11. THE Decay Engine SHALL assign each `ScoredEngram` to exactly one tier based on its `retention` value (after floor application): Hot when `retention ≥ cfg.hotMin` (default `0.60`); Warm when `cfg.cryptMax ≤ retention < cfg.hotMin` (default `0.25 ≤ R < 0.60`); Crypt when `retention < cfg.cryptMax`. Tier boundary comparisons use exact IEEE 754 `>=` and `<` operators on the computed value; no epsilon is applied. <!-- INV-2 -->

12. THE Decay Engine SHALL produce `rawRetention` as the `exp(-Δc / (S · W))` value before any floor is applied, and `retention` as `Math.max(rawRetention, floor)` where `floor = cfg.specFloor` for protected engrams and `0` for unprotected engrams. Both fields SHALL always be present in `ScoredEngram`. <!-- REQ-DEC-4 -->

---

### Requirement 3: Contradiction Detector

**User Story:** As a developer using `lethe-core`, I want contradictory steering rules to be detected and surfaced deterministically, so that the agent never operates under conflicting instructions without being aware of the conflict.

#### Acceptance Criteria

1. THE Contradiction Detector SHALL maintain a conflict ontology represented as an array of `Axis` objects. Each `Axis` has a unique `id`, a `description`, and an array of `Stance` objects. Each `Stance` has a unique-within-axis `id`, a `label`, an array of `patterns` (compiled regular expressions), and a `negationAware` boolean. Stances within the same axis are treated as mutually exclusive positions. <!-- REQ-CON-1 -->

2. THE Contradiction Detector SHALL ship a default ontology with at least 12 axes having the following ids: `state-management`, `css-approach`, `framework`, `package-manager`, `test-runner`, `module-system`, `error-handling`, `typing-strictness`, `component-model`, `data-fetching`, `naming-convention`, and `file-size-policy`. Each axis SHALL contain at least 2 stances. <!-- REQ-CON-5 -->

3. WHEN `detectContradictions` is called, THE Contradiction Detector SHALL process each engram's body by splitting it into sentences at `.`, `!`, `?`, or newline boundaries. For each sentence and each negation-aware stance, it SHALL check for the presence of negation-trigger words (`do not`, `never`, `avoid`, `no`, `instead of`) within the 4-token window immediately preceding a stance pattern match. A sentence yields polarity `+` (affirmative) when a pattern matches and no negation precedes it within the window, and polarity `-` (negated) when a negation word does precede the pattern match. <!-- REQ-CON-2 -->

4. WHEN two engrams assert opposing stances on the same axis — either `(+StanceA, +StanceB)` where `StanceA ≠ StanceB` on the same axis, or `(+StanceA, -StanceA)` across the two engrams — THE Contradiction Detector SHALL emit one `ContradictionReport` for the pair. The report SHALL contain: the `axis` id string; an `a` object with `{ id: engram.id, stance: stanceId, evidence: matchingSentence }` for the engram that is sorted first by `(a.id ≤ b.id)` lexicographic order; a `b` object for the other; a `severity` of `"high"` when either engram is protected, `"medium"` when both are in the Hot tier, and `"low"` otherwise; and a `resolution` field. <!-- REQ-CON-2 -->

5. THE `detectContradictions` function SHALL produce the same `ContradictionReport` regardless of argument order: calling it with engrams in any permutation SHALL yield reports where, for each detected pair, the `a` and `b` fields are assigned consistently by lexicographic `id` order (lower `id` → `a`). This guarantees `detect(a,b) === detect(b,a)` for the same pair. <!-- REQ-CON-3, INV-5 -->

6. WHEN resolving a contradiction, THE Contradiction Detector SHALL select the winner using this exact priority order: (1) a protected engram (spec-linked or pinned) beats an unprotected one; (2) among equal-protection engrams, the one with strictly higher `retention` wins; (3) if `retention` values are equal (within `1e-12` tolerance), the engram with the larger `lastReinforcedCommit` wins; (4) if those are also equal, the engram whose `id` is lexicographically smaller wins. The `resolution` field SHALL be `{ kind: "resolved", winner: winnerEngramId, loser: loserEngramId, reason: "spec" | "retention" | "recency" | "id" }`. The loser's `status` SHALL be set to `"defeated"` in the returned `ScoredEngram` array. <!-- REQ-CON-4 -->

7. WHEN both engrams in a contradicting pair are protected, THE Contradiction Detector SHALL set `resolution` to `{ kind: "unresolvable", reason: "both-protected" }` and SHALL NOT modify the `status` of either engram. The pair SHALL still appear in the output `ContradictionReport` array. <!-- REQ-CON-6, INV-5 -->

8. THE `detectContradictions` output array SHALL be sorted in ascending order by the composite key `(axis, a.id, b.id)` using lexicographic string comparison. For any set of inputs, this sort order is total and deterministic, producing byte-identical output arrays for identical inputs. <!-- REQ-CON-3 -->

9. WHEN a user-provided ontology is supplied as a second argument to `detectContradictions`, THE Contradiction Detector SHALL merge it with the default ontology: axes and stances whose `id` matches an existing default entry are replaced by the user-provided version; new ids are appended. The merge SHALL be deterministic and order-independent with respect to the default. <!-- REQ-CON-5 -->

10. IF any `Stance` in the active ontology (default or user-provided) contains a `pattern` string that fails to compile as a JavaScript `RegExp`, THEN `detectContradictions` SHALL return a `Result` failure with error code `ONTOLOGY_INVALID_PATTERN` and SHALL NOT emit any partial contradiction reports. All patterns SHALL be validated before scanning any engram bodies. <!-- REQ-CON-1 -->

---

### Requirement 4: Consolidation and Crypt

**User Story:** As a developer using `lethe-core`, I want stale, defeated, and near-duplicate engrams to be archived into a reversible cold store, so that the Hot tier stays within a token budget while no information is permanently lost.

#### Acceptance Criteria

1. WHEN `planConsolidation` is called, THE Consolidation Engine SHALL mark for archival every engram that (a) is not protected (not pinned and not spec-linked to an active spec) AND (b) satisfies at least one of: `retention < cfg.cryptMax` (default `0.25`), or `status === "defeated"`. Protected engrams SHALL never be marked for archival regardless of their retention or status. <!-- REQ-CRY-1, INV-1 -->

2. WHEN `applyPlan` is called, THE Consolidation Engine SHALL create a `TombstoneRecord` for each archived engram with `schema: 1` and containing: the byte-exact `body` string; all metadata (`globs`, `specLinks`, `pinned`); the full `EngramState` at time of archival; `reason` set to `"decayed"` for retention-based archival, `"contradiction"` for defeated engrams, or `"duplicate"` for merged duplicates; `retentionAtDeath` as the `retention` value at the moment of archival; `buriedAtCommit` as `nowCommit`; `buriedAt` as `nowISO`; and `position` as `{ index: number; neighborBefore?: string }` where `index` is the zero-based position of the engram within its file's engram list, and `neighborBefore` is the `id` of the immediately preceding engram (absent when the engram is first in the file). <!-- REQ-CRY-1 -->

   The `TombstoneRecord` SHALL also carry `raw`: the exact original file text of the engram, `fileText.slice(span.start, span.end)` (heading line plus body, including CRLF and trailing newline), so that resurrection is byte-exact. `body` is retained for hashing and search. <!-- REQ-CRY-1, REQ-CRY-3, INV-3 -->

3. THE Consolidation Engine SHALL count Hot-tier tokens as the sum of `tokens` for all engrams with `tier === "hot"` in the post-archival workspace. This total token count SHALL NOT exceed `cfg.budgetTokens` (default `4000`). Token counting uses the same `Math.ceil(body.length / 4)` formula as the parser to ensure consistency. <!-- REQ-CRY-2, INV-6 -->

4. WHEN the Hot-tier token total after archival would exceed `cfg.budgetTokens`, THE Consolidation Engine SHALL demote Hot engrams to Warm tier — starting from the engram with the lowest `retention` and proceeding upward — until the remaining Hot-tier token total is within budget. Only non-protected Hot engrams are eligible for demotion. <!-- REQ-CRY-2, INV-6 -->

5. IF the sum of `tokens` for all protected engrams with `tier === "hot"` exceeds `cfg.budgetTokens`, THEN THE Consolidation Engine SHALL set `budgetStatus` to `"budget_infeasible"` in the returned `SleepConsolidationResult` and SHALL NOT archive, demote, or modify any protected engram. The plan SHALL still be returned and the `demoted` array SHALL be empty. <!-- REQ-CRY-2, INV-1, INV-6 -->

6. FOR ALL engrams archived via `applyPlan`, calling `resurrect` on the resulting Virtual Workspace with that engram's `TombstoneRecord` SHALL produce a Virtual Workspace where the engram's `body`, `id`, `file`, `headingPath`, `contentHash`, `tokens`, `globs`, `specLinks`, and `pinned` fields are deep-equal to those of the original `EngramNode` before archival. The resurrected `EngramState` SHALL have `stability = cfg.s0` and a `deltaC` of zero when next scored. <!-- REQ-CRY-3, INV-3 -->

7. THE `planConsolidation` function SHALL be idempotent: if called on a Virtual Workspace that is already fully consolidated (all archivable engrams archived, duplicates merged), it SHALL return a `ConsolidationPlan` with empty `toArchive` and `toMerge` arrays and an unchanged `budgetStatus`. The `toDemote` array is STABLE (identical to that of the first plan), because demotion is derived from retention on every scoring pass and is not persisted to the workspace. <!-- REQ-CRY-4, INV-4 -->

8. Idempotency SHALL hold transitively: after calling `applyPlan` on a plan produced by `planConsolidation`, running `planConsolidation` again on the resulting workspace SHALL produce a plan with empty `toArchive` and `toMerge`, the same `budgetStatus`, and a `toDemote` identical to the first plan's; AND the workspace (files and tombstones) SHALL be unchanged by the second `applyPlan`. <!-- REQ-CRY-4, INV-4 -->

9. WHEN two engrams have a normalized-token Jaccard similarity ≥ `cfg.dedupeJaccard` (default `0.85`), THE Consolidation Engine SHALL resolve the pair by retaining the engram with higher `retention` and tombstoning the other with reason `"duplicate"`. If `retention` values are equal, the engram with the lexicographically smaller `id` is retained. Deduplication is resolved greedily in descending similarity order; a previously retained engram may be tombstoned in a later pairwise resolution within the same cluster, ensuring transitivity. <!-- REQ-CRY-5 -->

10. THE `planConsolidation` function SHALL operate in dry-run mode: it SHALL return a `ConsolidationPlan` value that describes all pending archive, merge, and demote actions without mutating any field of the input `ScoredEngram[]` array or the Virtual Workspace's file map or tombstone list. The function has no observable side effects outside its return value. <!-- REQ-CRY-6 -->

11. WHEN `resurrect` is called with a `TombstoneRecord`, THE Consolidation Engine SHALL attempt to restore the engram to its original file at position `tombstone.position.index`. The position is valid when `0 ≤ index ≤ currentEngrams.length` in that file's current engram list. If valid, the engram is inserted at that index. IF the index is out of bounds for the current file, THEN the engram SHALL be appended under a `## Resurrected` heading at the end of that file. In both cases, the resurrected engram SHALL re-enter scoring with `stability = cfg.s0` and `deltaC = 0`, yielding `retention = 1.0` on the first subsequent `score` call. <!-- REQ-CRY-7 -->

12. IF `resurrect` is called and no `TombstoneRecord` with the requested `id` exists in the Virtual Workspace's tombstone list, THEN the function SHALL return a `Result` failure with error code `TOMBSTONE_NOT_FOUND`. <!-- REQ-CRY-7 -->

13. THE Consolidation Engine SHALL compute the normalized-token Jaccard similarity for deduplication as: (1) tokenize each engram's body by splitting on whitespace after lowercasing and stripping punctuation; (2) form the set of unique tokens for each; (3) Jaccard = `|intersection| / |union|`. This computation is order-independent and case-insensitive. <!-- REQ-CRY-5 -->

---

### Requirement 5: Property-Based Testing Suite

**User Story:** As a developer and hackathon judge, I want the 12 core safety properties to be continuously verified with fast-check property-based testing, so that every claimed invariant is machine-checked and any counterexample is reproducible and shrunk.

#### Acceptance Criteria

1. THE PBT Suite SHALL implement all 12 properties (P1–P12) as individually named, exported functions in `src/properties/`, each accepting an `fc.Arbitrary` seed configuration and returning a `fc.IProperty` or equivalent runnable definition. These exports SHALL be published through the separate `@lethe/core/properties` entry point (`./properties` in `package.json` `exports`) and SHALL be importable by the web sandbox to run in the browser using the same definitions used in CI. No file in `src/` SHALL import from `test/`. <!-- REQ-PBT-1 -->

2. THE PBT Suite SHALL read the run count from the environment variable `FC_NUM_RUNS` at test start-time (defaulting to `100` when the variable is absent or non-numeric). In CI (where `FC_NUM_RUNS=1000` is set), each property SHALL execute ≥ 1,000 runs. Shrinking SHALL be enabled on all properties (no `endOnFailure` or equivalent setting that bypasses shrinking). <!-- REQ-PBT-1 -->

3. THE suite SHALL implement these 12 named properties: P1 — for all valid `score` inputs, every `ScoredEngram.retention` is in `(0, 1]`; P2 — for any engram with no reinforcement event between two scoring calls with `Δc₁ < Δc₂`, `R(Δc₁) ≥ R(Δc₂)`; P3 — for any engram before and after `reinforce`, `state.stability` is non-decreasing and `retention` is non-decreasing at `Δc = 0`; P4 — after `planConsolidation`, no protected engram appears in `plan.archive` and every protected engram has `retention ≥ cfg.specFloor`; P5 — after `applyPlan`, for every pair in `detectContradictions(result)`, the resolution is either `"resolved"` (both not in Hot/Warm simultaneously) or `"unresolvable"`; P6 — after `planConsolidation` and `applyPlan`, either the Hot-tier token total ≤ `cfg.budgetTokens` or `budgetStatus === "budget_infeasible"` with all protected engrams intact; P7 — for any engram `e`, `resurrect(applyPlan(plan including e))` produces a workspace where the engram's node deep-equals `e.node`; P8 — `planConsolidation` on an already-consolidated workspace returns a plan with empty action arrays; P9 — calling `score` twice with identical inputs produces identical `ScoredEngram[]` arrays; P10 — after `score`, every engram appears in exactly one of `{hot, warm, crypt}` tier sets; P11 — `detectContradictions` with `[a, b]` and `[b, a]` produces the same report set; P12 — for any document `d` where `parseDocument` returns success, `serializeDocument(parseDocument(d))` equals `d`. <!-- REQ-PBT-1, INV-1 through INV-5 -->

4. WHEN a property fails during a test run, THE PBT Suite SHALL: (a) print the failing seed and the shrunk counterexample to the test reporter output; (b) append a JSON entry to `.kiro/lethe/pbt-failures.json` containing `{ propertyId, seed, counterexample, failedAt: ISO }`. If the file does not exist, it SHALL be created. If the file exists and contains valid JSON, the new entry SHALL be appended to the `failures` array. If the file exists but is malformed, a new file SHALL be written with only the new entry. <!-- REQ-PBT-2 -->

5. THE PBT Suite SHALL export a `runPbtGate(cfg: LetheConfig): Promise<PbtGateResult>` function where `PbtGateResult` is `{ status: "passed" } | { status: "failed"; propertyId: string; seed: number; counterexample: unknown }`. This function runs all 12 properties sequentially with 100 runs each (not the full CI count) and returns on the first failure. <!-- REQ-PBT-3 -->

6. The `lethe_consolidate_sleep` MCP tool (in `lethe-mcp`) SHALL call `runPbtGate` before executing any file mutations. If `runPbtGate` returns `{ status: "failed" }`, the tool SHALL NOT apply the consolidation plan and SHALL return a tool error with code `PBT_GATE_FAILED` containing the `propertyId` and `seed`. <!-- REQ-PBT-3 -->

7. THE fast-check generators in `src/properties/arbitraries/` SHALL produce adversarial inputs including: (a) engram sets with bursty commit histories — ≥ 20 `LedgerEvent`s within a `Δc` window of ≤ 5 commits; (b) long idle gaps — `Δc ≥ 500` commits with no reinforcement; (c) all-spec-linked sets — every engram in the input has at least one active `specLink`; (d) empty engram sets — empty arrays for `engrams`, `states`, and `ledger`; (e) duplicate-id collisions — the raw text for a document contains two sections that would produce the same `id` slug; (f) engram bodies containing Unicode text (CJK, RTL Arabic/Hebrew, combining diacritics), mixed CRLF/LF line endings, and zero-width space characters. <!-- REQ-PBT-4 -->

8. THE PBT Suite SHALL never include a `fc.configureGlobal` call with a fixed `seed` value committed to the repository. Each test run generates seeds dynamically; the seed SHALL be extracted from the fast-check failure output and printed to the console on failure. <!-- REQ-PBT-1 -->

---

### Requirement 6: Non-Functional and Cross-Cutting Constraints

**User Story:** As a developer integrating `lethe-core` into `lethe-mcp` and `apps/web`, I want strict guarantees about performance, portability, purity, and safety, so that the engine is a reliable foundation across all three execution environments.

#### Acceptance Criteria

1. THE `score` function SHALL process 500 engrams in fewer than 50 milliseconds, measured with `performance.now()` in a warm Node 22 process (at least one prior call in the same process to allow JIT compilation), with a ledger of at least 500 events and a state object of 500 entries. <!-- NFR-1 -->

2. THE `lethe-core` package SHALL declare zero entries in the `dependencies` field of its `package.json`. All tooling (`vitest`, `fast-check`, `typescript`) SHALL appear in `devDependencies`. `fast-check` MAY additionally appear as an OPTIONAL peer dependency (`peerDependenciesMeta` `optional: true`, same pinned version) used only by the `./properties` entry point; the engine entry point (`.`) SHALL NOT import `fast-check`, `vitest`, any `node:` module, or anything under `src/properties/`. <!-- INV-7, NFR-4 -->

3. THE `lethe-core` source SHALL contain no static import, dynamic import, or require call referencing any of: `fs`, `path`, `os`, `process`, `node:fs`, `node:path`, `node:os`, `node:process`, `node:crypto`, `globalThis.crypto`, `console`, `Date` called with no arguments, or `Math.random`. Any SHA-256 computation SHALL use a pure synchronous algorithm implemented directly in TypeScript with no platform API calls. <!-- INV-7, REQ-DEC-6 -->

4. WHEN given identical inputs (same engrams, states, specs, ledger, `nowCommit`, `nowISO`, and config), every exported `lethe-core` function SHALL produce structurally identical output across repeated calls. Tier assignments (hot/warm/crypt) and all string output (ids, hashes, serialized documents) SHALL be byte-identical. Floating-point `R` values MAY differ by at most `1e-9` across JS engine implementations (Node vs Bun vs browser) due to `Math.exp` implementation variance, but SHALL be identical within the same engine across calls. <!-- NFR-3, INV-4 -->

5. THE `lethe-core` package SHALL be importable in Chrome 120+, Safari 17+, and Firefox 121+ without any polyfills, transpilation, or platform-specific bundler plugins beyond standard ES2022 module resolution. <!-- NFR-4 -->

6. IF any exported function is called with an out-of-contract input — including but not limited to: `cfg.s0 ≤ 0`, `cfg.sMin ≤ 0`, `cfg.beta < 0`, `cfg.sMax < cfg.s0`, `nowCommit < 0`, a non-finite or NaN retention value in a pre-scored input, or a `TombstoneRecord` with `schema !== 1` — THEN the function SHALL return a `Result` failure with `code` set to the most specific applicable error code from: `PARSE_INVALID_FRONTMATTER`, `PARSE_DUPLICATE_ID`, `CONFIG_INVALID`, `ONTOLOGY_INVALID_PATTERN`, `BUDGET_INFEASIBLE`, `TOMBSTONE_NOT_FOUND`, `PATH_ESCAPE`, `PBT_GATE_FAILED`. It SHALL NOT throw an unhandled exception. <!-- REQ-DEC-6, INV-7 -->

7. WHILE the `apply` field of the options argument to `planConsolidation` is absent or `false`, THE function SHALL NOT mutate any field of the input `ScoredEngram[]` array or the Virtual Workspace. The function's only observable effect is its return value (`ConsolidationPlan`); there are no side effects outside the function call. <!-- REQ-CRY-6, NFR-2 -->

8. THE `lethe-core` TypeScript source SHALL compile without errors under `tsc` with these flags active: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`. The compiled output SHALL contain zero uses of the `any` type (verified by `@typescript-eslint/no-explicit-any` with `allowExplicitAny: false`). <!-- INV-7 -->
