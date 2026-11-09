# Implementation Plan: lethe-core

## Overview

This plan converts the `lethe-core` design into sequential, granular coding tasks. Each milestone builds on the previous one; PBT tasks are interleaved immediately after the subsystem they validate — they are not deferred to the end. Every task cites the `REQ-*` or `INV-*` ids it satisfies.

The implementation language is **TypeScript** (strict, ESM, ES2022), per D1–D2 and `03-rules.md §1`.

---

## Tasks

- [x] 1. Foundation — Types, Result, Config
  - No dependencies; these unblock every subsequent milestone.

  - [x] 1.1 Write `src/types.ts` — all exported types verbatim from design.md §Data Models: `EngramNode`, `EngramState`, `ScoredEngram`, `ContradictionReport`, `TombstoneRecord`, `SleepConsolidationResult`, `LetheConfig`, `LedgerEvent`, `ParsedDoc`, `Annotation`, `StanceMatch`, `Stance`, `Axis`, `Ontology`, `ConsolidationPlan`, `VirtualWorkspace`, `ErrorCode`, `LetheError`, `Result`, `Tier`, `EngramStatus`, `SpecInvariant`. All fields `readonly`. Zero `any`.
    - _Requirements: REQ-DEC-1, REQ-PAR-2, INV-7_

  - [x] 1.2 Write `src/result.ts` — `Result<T,E>` discriminated union, `ok<T>(value)`, `err<E>(error)`, `match<T,E,R>(result, cases)` helpers. File must be ≤ 40 lines.
    - _Requirements: REQ-DEC-6_

  - [x] 1.3 Write `src/config.ts` — `DEFAULT_CONFIG: LetheConfig` compile-time constant with all canonical defaults (s0=5, sMax=120, sMin=0.5, beta=0.5, alpha=0.25, wDefault=1, wSpec=4, specFloor=0.50, hotMin=0.60, cryptMax=0.25, budgetTokens=4000, dedupeJaccard=0.85, granularity="section"). Add `validateConfig(partial: unknown): Result<LetheConfig, LetheError>` that merges over `DEFAULT_CONFIG` and validates every field constraint.
    - _Requirements: REQ-DEC-1, CONFIG_INVALID_

  - [x]* 1.4 Run `bun run typecheck` — zero errors required before proceeding. Fix any issues.
    - _Requirements: INV-7_

- [x] 2. SHA-256 and Slug
  - Pure utility functions required by the parser; no dependencies beyond Milestone 1.

  - [x] 2.1 Write `src/parse/hash.ts` — self-contained pure synchronous SHA-256 with no platform API calls (no `globalThis.crypto`, no `node:crypto`). Returns lowercase 64-char hex. Must satisfy: `sha256("abc") === "ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469648079788f8f845a"`. Normalize input: strip trailing whitespace per line, normalize CRLF to LF, before hashing.
    - _Requirements: REQ-PAR-2, INV-7_

  - [x] 2.2 Write `src/parse/slug.ts` — `slugify(relativePath: string, headingPath: readonly string[]): string`. Join path and heading elements with `#`, lowercase the whole string, replace runs of non-`[a-z0-9]` chars with a single `-`, trim leading/trailing `-`.
    - _Requirements: REQ-PAR-2_

  - [x]* 2.3 Write unit tests in `test/parse.unit.test.ts` covering: known SHA-256 vectors (empty string, "abc", multi-block input), CRLF normalization changes the hash vs LF-only, unicode input (CJK, Arabic), slug stability (body change → hash change but id unchanged), empty headingPath, special characters in heading text.
    - _Requirements: REQ-PAR-2, REQ-PAR-5_

- [x] 3. Parser — Frontmatter, Section Split, Annotation
  - Three building blocks of `parseDocument`; depend on Milestone 2.

  - [x] 3.1 Write `src/parse/frontmatter.ts` — `parseFrontmatter(text: string): Result<{ fm: string | null; rest: string }, LetheError>`. Handle: no opening `---` → `{ fm: null, rest: text }`; valid block with closing `---` → `{ fm: rawBlock, rest: remainder }`; opening `---` present but no closing `---` before first heading or EOF → `err({ code: "PARSE_INVALID_FRONTMATTER" })`.
    - _Requirements: REQ-PAR-6_

  - [x] 3.2 Write `src/parse/section.ts` — `splitSections(text: string, granularity: "section" | "bullet"): RawSection[]`. Section mode: walk line-by-line, track H2/H3 heading stack, compute `headingPath` as ancestor-plus-own heading text array, set `span.start` to first char of heading line and `span.end` exclusive one past section body. Bullet mode: identify top-level list items (`- `, `* `, `N. ` at column 0), include nested sub-list lines, set `headingPath` to zero-based decimal index array. Empty document → empty array.
    - _Requirements: REQ-PAR-1_

  - [x] 3.3 Write `src/parse/annotation.ts` — `parseAnnotation(body: string): Annotation`. Scan for first `<!-- lethe: ... -->`. Extract key-value pairs separated by `;`. Keys: `globs` (split by `,`, trim) → `globs[]`; `spec` (split by `,`, trim) → `specLinks[]`; `pin` (`=== "true"`) → `pinned`. Unrecognized keys silently ignored. Always returns a valid `Annotation` — never fails.
    - _Requirements: REQ-PAR-4_

  - [x]* 3.4 Expand `test/parse.unit.test.ts` with: frontmatter with CRLF line endings, frontmatter with duplicate closing `---` (should parse only the first), H3 nested inside H2 heading stack, bullet with nested sub-lists spanning multiple lines, annotation with all keys present, annotation with only `pin=true`, annotation with unknown keys, empty body annotation.
    - _Requirements: REQ-PAR-4, REQ-PAR-6_

- [x] 4. Document Parser + P12 Serialize Round-Trip PBT
  - Completes the parser; immediately verifies P12 to catch round-trip regressions early.

  - [x] 4.1 Write `src/parse/document.ts` — `parseDocument(file: string, text: string, cfg: LetheConfig): Result<ParsedDoc, LetheError>` and `serializeDocument(doc: ParsedDoc): string`. `parseDocument` orchestrates: `parseFrontmatter` → `splitSections` → for each section: `parseAnnotation`, `slugify`, `sha256(normalizedBody)`, `Math.ceil(body.length / 4)` for tokens. Check for duplicate `id` values → return `PARSE_DUPLICATE_ID` if found. `serializeDocument` returns `doc.rawText` (the original input stored verbatim in `ParsedDoc`).
    - _Requirements: REQ-PAR-1, REQ-PAR-2, REQ-PAR-3, REQ-PAR-4, REQ-PAR-5, REQ-PAR-6_

  - [x]* 4.2 Expand `test/parse.unit.test.ts` with: round-trip test for a real vault-style file (H2/H3 headings + frontmatter), duplicate id detection returns `PARSE_DUPLICATE_ID`, empty document success with zero engrams, frontmatter is preserved byte-for-byte in serialization, token count matches `Math.ceil(body.length / 4)` for known inputs.
    - _Requirements: REQ-PAR-2, REQ-PAR-5_

  - [x] 4.3 Write `test/arbitraries/engram.arb.ts` — `fc.Arbitrary<string>` for synthetic markdown documents. Generates: random H2/H3 heading counts (0–10), random body text, optional YAML frontmatter, optional `<!-- lethe: -->` annotations with random keys, CRLF line endings variant, unicode in headings (CJK, Arabic), zero-heading documents.
    - _Requirements: REQ-PBT-4_

  - [x] 4.4 Write `src/properties/p12-serialize.ts` — P12: `FOR ALL` markdown documents `d` where `parseDocument(file, d, cfg)` returns `ok`, `serializeDocument(result.value) === d`. Export as `p12Serialize(cfg: LetheConfig): fc.IProperty<string>`.
    - _Requirements: REQ-PBT-1, REQ-PAR-5, P12_

  - [x]* 4.5 Write `test/parse.pbt.test.ts` — vitest test file importing `p12Serialize`. Reads `FC_NUM_RUNS` from env (default 100). Runs `fc.assert(p12Serialize(DEFAULT_CONFIG), { numRuns, seed: ... })`. Print seed on failure.
    - _Requirements: REQ-PBT-1, REQ-PAR-5_

- [x] 5. Checkpoint — Parser complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Decay Engine — Delta, Retention, Weight, Reinforce
  - Core math functions. Pure, no IO, no clock access.

  - [x] 6.1 Write `src/decay/delta.ts` — `computeDeltaC(state: EngramState, nowCommit: number, nowISO: string, alpha: number): number`. `commitsSince = Math.max(0, nowCommit - state.lastReinforcedCommit)`. `daysSince = Math.max(0, (new Date(nowISO).getTime() - new Date(state.lastReinforcedAt).getTime()) / 86400000)`. Return `commitsSince + alpha * daysSince`. `new Date(isoString)` (with argument) is permitted.
    - _Requirements: REQ-DEC-2, REQ-DEC-6_

  - [x] 6.2 Write `src/decay/retention.ts` — `computeRetention(deltaC: number, S: number, W: number, sMin: number): number`. Clamp: `S_eff = Math.max(S, sMin)`. Return `Math.exp(-deltaC / (S_eff * W))`. Always in `(0, 1]` for valid inputs.
    - _Requirements: REQ-DEC-1_

  - [x] 6.3 Write `src/decay/weight.ts` — `computeWeight(node: EngramNode, specs: readonly SpecInvariant[], cfg: LetheConfig): { W: number; isProtected: boolean; floor: number }`. If `node.pinned === true` OR `node.specLinks` intersects any active `SpecInvariant.specName`: `W = cfg.wSpec`, `isProtected = true`, `floor = cfg.specFloor`. Otherwise: `W = cfg.wDefault`, `isProtected = false`, `floor = 0`. Pinned + spec-linked → apply `wSpec` once only.
    - _Requirements: REQ-DEC-4, REQ-DEC-7, REQ-DEC-8_

  - [x] 6.4 Write `src/decay/reinforce.ts` — `reinforce(state: EngramState, ev: LedgerEvent, cfg: LetheConfig): EngramState`. Compute `newS = Math.min(state.stability * (1 + cfg.beta), cfg.sMax)`. Return new state with updated `stability`, `lastReinforcedCommit`, `lastReinforcedAt`, incremented `reinforcements`. Input is not mutated.
    - _Requirements: REQ-DEC-3_

  - [x]* 6.5 Write unit tests in `test/decay.unit.test.ts`: known `R` value for `deltaC=10, S=5, W=1` (verify with formula), floor application for pinned engram, `W=4` for spec-linked, stability capped at `sMax` on reinforce, `sMin` clamping, alpha=0.25 default, reinforcement timestamp update, `Δc=0` → `R=1.0`.
    - _Requirements: REQ-DEC-1, REQ-DEC-2, REQ-DEC-3, REQ-DEC-4_

- [x] 7. P1–P4 Decay PBTs
  - Immediately validate the four decay safety invariants after writing the math functions.

  - [x] 7.1 Write `test/arbitraries/state.arb.ts` — arbitrary `EngramState`: `stability` in `[cfg.sMin, cfg.sMax]`, non-negative `lastReinforcedCommit`, valid ISO `lastReinforcedAt`, non-negative `reinforcements`. Add bursty variant (rapid commit increments) and long-idle variant (`stability` near `sMin`, large `commitsSince`).
    - _Requirements: REQ-PBT-4_

  - [x] 7.2 Write `test/arbitraries/ledger.arb.ts` — arbitrary `LedgerEvent[]`: all three types, random `filesTouched` and `cited` arrays, non-decreasing commit counters. Include bursty variant (≥ 20 events within `Δc ≤ 5`) and empty-array variant.
    - _Requirements: REQ-PBT-4_

  - [x] 7.3 Write `src/properties/p1-range.ts` — P1: `FOR ALL` valid `(EngramState, nowCommit, nowISO, cfg)`, `computeRetention` returns a value in `(0, 1]`. Export `p1Range(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-DEC-1, INV-2_

  - [x] 7.4 Write `src/properties/p2-monotonic.ts` — P2: `FOR ALL` `(state, Δc₁, Δc₂, cfg)` where `Δc₁ ≤ Δc₂`, `computeRetention(Δc₁, S, W, sMin) ≥ computeRetention(Δc₂, S, W, sMin)`. Export `p2Monotonic(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-DEC-2, INV-2_

  - [x] 7.5 Write `src/properties/p3-reinforce.ts` — P3: `FOR ALL` `(state, event, cfg)`, after `reinforce(state, event, cfg)` the new `stability ≥ state.stability` and `computeRetention(0, newS, W, sMin) ≥ computeRetention(0, state.stability, W, sMin)`. Export `p3Reinforce(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-DEC-3_

  - [x] 7.6 Write `src/properties/p4-protected.ts` — P4: `FOR ALL` scored workspace and consolidation plan, no protected engram appears in `plan.toArchive` and every protected engram has `retention ≥ cfg.specFloor`. (Requires stub `planConsolidation` that returns empty plan for now; wire real implementation in Milestone 11.)
    - _Requirements: REQ-DEC-4, REQ-DEC-7, REQ-DEC-8, REQ-CRY-1, INV-1_

  - [x]* 7.7 Write `test/decay.pbt.test.ts` — runs P1, P2, P3, P4 with `FC_NUM_RUNS` count. Reads env var; defaults to 100. Print seed on any failure. All four must pass.
    - _Requirements: REQ-PBT-1, INV-1, INV-2_

- [x] 8. `score` Function
  - Wires delta, retention, weight, reinforce, and tier assignment into the top-level scoring function.

  - [x] 8.1 Write `src/decay/score.ts` — `score(input: ScoreInput): ScoredEngram[]`. (1) Validate config via `validateConfig`. (2) Build `Map<id, EngramState>` from `states`; synthesize default for missing. (3) Apply `ledger` events in order via `reinforce` matching: glob match on `filesTouched` (minimatch-compatible), exact id match, or `specLinks` match on `cited`. (4) For each engram compute `computeWeight`, `computeDeltaC`, `computeRetention`, apply floor. (5) Assign tier: `≥ hotMin` → `"hot"`, `≥ cryptMax` → `"warm"`, else `"crypt"`. (6) Return sorted by `(tier-rank, -retention, id)`.
    - _Requirements: REQ-DEC-1, REQ-DEC-2, REQ-DEC-3, REQ-DEC-4, REQ-DEC-5, REQ-DEC-6, REQ-DEC-7_

  - [x] 8.2 Write `test/arbitraries/workspace.arb.ts` — arbitrary complete score inputs: `{ engrams, states, specs, ledger, nowCommit, nowISO, cfg }`. Include all-spec-linked variant (every engram has ≥ 1 active specLink), empty-engrams variant, mixed protected/unprotected.
    - _Requirements: REQ-PBT-4_

  - [x] 8.3 Write `src/properties/p9-determinism.ts` — P9: `FOR ALL` valid score inputs, calling `score(input)` twice returns arrays where every field of every `ScoredEngram` is structurally identical (string fields byte-equal, floats equal within same engine). Export `p9Determinism(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: NFR-3, INV-4_

  - [x] 8.4 Write `src/properties/p10-partition.ts` — P10: `FOR ALL` valid score inputs, the output array's `tier` values form a partition of `{"hot","warm","crypt"}` — every engram is in exactly one tier and the three subsets cover the entire array. Export `p10Partition(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-DEC-11, INV-2_

  - [x]* 8.5 Expand `test/decay.pbt.test.ts` to include P9 and P10. All six decay PBTs (P1–P4, P9, P10) must pass.
    - _Requirements: REQ-PBT-1, INV-2_

- [x] 9. Checkpoint — Decay Engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Contradiction Detector
  - Full ontology validation, sentence scanning, and detection pipeline.

  - [x] 10.1 Write `src/contradiction/default-ontology.ts` — `DEFAULT_AXES: Axis[]` with exactly 12 axes: `state-management`, `css-approach`, `framework`, `package-manager`, `test-runner`, `module-system`, `error-handling`, `typing-strictness`, `component-model`, `data-fetching`, `naming-convention`, `file-size-policy`. Each axis has ≥ 2 stances with realistic pattern strings and `negationAware` flags.
    - _Requirements: REQ-CON-1, REQ-CON-5_

  - [x] 10.2 Write `src/contradiction/validate-ontology.ts` — `validateOntology(axes: readonly Axis[]): Result<CompiledOntology, LetheError>`. Attempts `new RegExp(pattern)` for every pattern in every stance; returns `ONTOLOGY_INVALID_PATTERN` on first failure with `{ axis, stance, pattern }` in detail. All patterns validated before any scanning.
    - _Requirements: REQ-CON-1_

  - [x] 10.3 Write `src/contradiction/scan.ts` — `scanEngram(body: string, compiled: CompiledOntology): readonly StanceMatch[]`. Truncate body to 8,192 chars first (ReDoS protection). Split into sentences at `.`, `!`, `?`, or newline. Per sentence per stance: check compiled patterns. If `negationAware`, scan 4-token lookbehind for negation words (`do not`, `never`, `avoid`, `no`, `instead of`). Polarity `+` when match and no negation; `-` when match and negation present.
    - _Requirements: REQ-CON-2_

  - [x] 10.4 Write `src/contradiction/resolve.ts` — `resolveContradiction(a: ScoredEngram, b: ScoredEngram, axisId: string): ContradictionReport`. Priority order: (1) protected > unprotected → `reason: "spec"`; (2) higher `retention` → `reason: "retention"`; (3) higher `lastReinforcedCommit` → `reason: "recency"`; (4) lex-smaller `id` → `reason: "id"`. Both protected → `{ kind: "unresolvable", reason: "both-protected" }`. Severity: `"high"` if either protected; `"medium"` if both Hot; `"low"` otherwise. Lower `id` → `a` field in report.
    - _Requirements: REQ-CON-4, REQ-CON-6_

  - [x] 10.5 Write `src/contradiction/detect.ts` — `detectContradictions(scored: readonly ScoredEngram[], specs: readonly SpecInvariant[], ontology?: Ontology): Result<readonly ContradictionReport[], LetheError>`. Merge user ontology into `DEFAULT_AXES` (replace matching ids, append new). Validate merged ontology. Scan all engram bodies. For each axis collect `(+stance, engramId)` pairs; emit one report per conflicting `(+A,+B where A≠B)` or `(+A,-A)` pair. Deduplicate. Sort by `(axis, a.id, b.id)`.
    - _Requirements: REQ-CON-2, REQ-CON-3, REQ-CON-4, REQ-CON-5, REQ-CON-6_

  - [x]* 10.6 Write unit tests in `test/contradiction.unit.test.ts`: no-contradiction case returns empty array, two opposing `css-approach` stances detected, negated stance produces `-` polarity, both-protected pair → `unresolvable`, resolution priority tested for each of the 4 tiebreaker levels, invalid regex pattern → `ONTOLOGY_INVALID_PATTERN`, custom ontology axis replaces default, custom ontology adds new axis, output sorted by `(axis, a.id, b.id)`.
    - _Requirements: REQ-CON-1, REQ-CON-2, REQ-CON-3, REQ-CON-4, REQ-CON-5, REQ-CON-6_

- [x] 11. P5 and P11 Contradiction PBTs
  - Immediately validate symmetry and post-consolidation mutual exclusion.

  - [x] 11.1 Write `src/properties/p11-symmetric.ts` — P11: `FOR ALL` two `ScoredEngram` values `a` and `b`, `detectContradictions([a,b], specs)` and `detectContradictions([b,a], specs)` produce the same set of reports (same `axis`, same `a`/`b` assignment, same `resolution`). Export `p11Symmetric(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-CON-3, INV-5_

  - [x] 11.2 Write `src/properties/p5-contradiction.ts` — P5: `FOR ALL` workspace, after `applyPlan`, for every `ContradictionReport` in `detectContradictions(resultScored)`, the resolution is either `"unresolvable"` or the losing engram is no longer in Hot or Warm tier. Export `p5Contradiction(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-CON-2, REQ-CON-4, REQ-CON-6, INV-5_

  - [x]* 11.3 Write `test/contradiction.pbt.test.ts` — runs P11 and P5 with `FC_NUM_RUNS` count. Both must pass. Print seed on failure.
    - _Requirements: REQ-PBT-1, INV-5, REQ-CON-3_

- [x] 12. Consolidation Engine
  - Jaccard similarity, deduplication, budget analysis, and the dry-run plan.

  - [x] 12.1 Write `src/consolidate/jaccard.ts` — `jaccard(bodyA: string, bodyB: string): number`. Tokenize by lowercasing, stripping `[^\w\s]`, splitting on whitespace, filtering empty. Form `Set<string>` for each. Return `|intersection| / |union|`. Return `0` when both sets empty.
    - _Requirements: REQ-CRY-5, REQ-CRY-13_

  - [x] 12.2 Write `src/consolidate/dedupe.ts` — `findDuplicates(scored: readonly ScoredEngram[], cfg: LetheConfig): readonly DupePair[]`. O(n²) scan over non-protected engrams. Collect pairs with `jaccard ≥ cfg.dedupeJaccard`. Sort descending by similarity. Greedy resolution: higher `retention` kept (ties: lex-smaller `id`). A previously kept engram may be dropped in a later resolution (transitivity).
    - _Requirements: REQ-CRY-5, REQ-CRY-9_

  - [x] 12.3 Write `src/consolidate/budget.ts` — `computeBudget(scored: readonly ScoredEngram[], toArchive: ReadonlySet<string>, cfg: LetheConfig): BudgetAnalysis`. Count Hot tokens excluding archived ids. If protected-hot tokens alone exceed budget → `{ status: "budget_infeasible", demotion: [] }`. Otherwise sort non-protected Hot by `retention` ascending, accumulate into `demotion[]` until budget satisfied.
    - _Requirements: REQ-CRY-2, REQ-CRY-3, REQ-CRY-4_

  - [x] 12.4 Write `src/consolidate/plan.ts` — `planConsolidation(scored: readonly ScoredEngram[], reports: readonly ContradictionReport[], cfg: LetheConfig): ConsolidationPlan`. Pure dry-run — no mutations. (1) Collect `toArchive`: non-protected with `retention < cfg.cryptMax` OR `status === "defeated"`. (2) Collect `toMerge` from `findDuplicates`. (3) Compute budget with `computeBudget`. (4) Return `ConsolidationPlan` with `toArchive`, `toMerge`, `toDemote`, `budgetStatus`, `tokensBefore`, `tokensAfter`.
    - _Requirements: REQ-CRY-1, REQ-CRY-6, REQ-CRY-10_

  - [x]* 12.5 Write unit tests in `test/consolidate.unit.test.ts`: decayed engram (`R < cryptMax`) → archived; defeated engram → archived; protected engram with `R < cryptMax` → NOT archived; budget demotion selects lowest-retention first; `budget_infeasible` when protected Hot tokens alone exceed `budgetTokens`; known Jaccard pairs (identical bodies → 1.0, disjoint bodies → 0.0); greedy dedup with transitive chain; idempotency on already-consolidated input.
    - _Requirements: REQ-CRY-1, REQ-CRY-2, REQ-CRY-3, REQ-CRY-4, REQ-CRY-5, REQ-CRY-9_

- [x] 13. Checkpoint — Consolidation Engine complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Crypt — Archive, Apply, Resurrect
  - The functions that mutate the `VirtualWorkspace`.

  - [x] 14.1 Write `src/crypt/archive.ts` — `toTombstone(scored: ScoredEngram, reason: TombstoneRecord["reason"], nowCommit: number, nowISO: string, index: number, neighborBefore?: string): TombstoneRecord`. Builds `schema: 1` record with byte-exact `body` from `scored.node.body`, `meta` from node fields, full `state` at archival time, `retentionAtDeath`, `buriedAtCommit`, `buriedAt`, `position`.
    - _Requirements: REQ-CRY-1_

  - [x] 14.2 Write `src/crypt/apply.ts` — `applyPlan(workspace: VirtualWorkspace, plan: ConsolidationPlan, nowCommit: number, nowISO: string): { workspace: VirtualWorkspace; tombstones: readonly TombstoneRecord[] }`. For each entry in `plan.toArchive` and `plan.toMerge` drops: remove engram text from file using `span` offsets, compute `index` and `neighborBefore` from pre-apply engram list, call `toTombstone`. Return new immutable `VirtualWorkspace` with updated files and extended tombstone list.
    - _Requirements: REQ-CRY-1, REQ-CRY-2, REQ-CRY-6_

  - [x] 14.3 Write `src/crypt/resurrect.ts` — `resurrect(workspace: VirtualWorkspace, tomb: TombstoneRecord, nowCommit: number, nowISO: string, cfg: LetheConfig): Result<VirtualWorkspace, LetheError>`. Find tombstone by `tomb.id`; return `TOMBSTONE_NOT_FOUND` if absent. Parse target file to get current engram list. If `tomb.position.index ≤ currentEngrams.length`: insert at index. Else: append under `## Resurrected` heading. Remove tombstone from list. Return updated workspace.
    - _Requirements: REQ-CRY-3, REQ-CRY-7, REQ-CRY-11, REQ-CRY-12_

  - [x]* 14.4 Write unit tests in `test/crypt.unit.test.ts`: round-trip body byte-equality after archive+resurrect, insert at index 0, insert at middle index, insert past end → fallback to `## Resurrected`, `TOMBSTONE_NOT_FOUND` when id absent from tombstone list, `stability` resets to `cfg.s0` after resurrection, `neighborBefore` correctly identifies preceding engram id.
    - _Requirements: REQ-CRY-3, REQ-CRY-7, REQ-CRY-11, REQ-CRY-12, INV-3_

- [x] 15. P4 (full), P6, P7, P8 Consolidation/Crypt PBTs
  - Write all consolidation and crypt safety properties now that `planConsolidation` and `applyPlan` are real implementations.

  - [x] 15.1 Write `test/arbitraries/adversarial.arb.ts` — adversarial arbitraries: all-spec-linked workspace (every engram has ≥ 1 active `specLink`), duplicate-id collision documents (two sections produce identical slug), unicode+CRLF bodies (CJK, Arabic, Hebrew, combining diacritics, zero-width spaces, mixed CRLF/LF), empty engram sets, bursty ledger (≥ 20 events in `Δc ≤ 5`), long-idle gaps (`Δc ≥ 500` with no reinforcement).
    - _Requirements: REQ-PBT-4_

  - [x] 15.2 Update `src/properties/p4-protected.ts` — wire to real `planConsolidation`. No-op if already correct from stub; verify property still passes end-to-end.
    - _Requirements: REQ-CRY-1, INV-1_

  - [x] 15.3 Write `src/properties/p6-budget.ts` — P6: `FOR ALL` workspace and config, after `planConsolidation` + `applyPlan`, either Hot-tier token total ≤ `cfg.budgetTokens`, or `budgetStatus === "budget_infeasible"` and every protected engram that was Hot before remains Hot after. Export `p6Budget(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-CRY-2, REQ-CRY-3, REQ-CRY-4, INV-6_

  - [x] 15.4 Write `src/properties/p7-roundtrip.ts` — P7: `FOR ALL` engram `e` archived via `applyPlan`, `resurrect(resultWorkspace, tomb).value.node` deep-equals `e.node` (all nine fields listed in REQ-CRY-6). Export `p7Roundtrip(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-CRY-3, REQ-CRY-7, INV-3_

  - [x] 15.5 Write `src/properties/p8-idempotent.ts` — P8: `FOR ALL` workspace `w`, `planConsolidation(score(applyPlan(w, planConsolidation(score(w))).workspace))` returns a plan with empty `toArchive`, `toMerge`, `toDemote` arrays. Export `p8Idempotent(cfg: LetheConfig): fc.IProperty<...>`.
    - _Requirements: REQ-CRY-4, INV-4_

  - [x]* 15.6 Write `test/consolidate.pbt.test.ts` — runs P4 (full), P6, P8 with `FC_NUM_RUNS` count. All must pass.
    - _Requirements: REQ-PBT-1, INV-1, INV-4, INV-6_

  - [x]* 15.7 Write `test/crypt.pbt.test.ts` — runs P7 with `FC_NUM_RUNS` count. Must pass. Print seed on failure.
    - _Requirements: REQ-PBT-1, INV-3_

- [x] 16. Checkpoint — Crypt and all PBTs green
  - Ensure all 12 properties pass with FC_NUM_RUNS=100, ask the user if questions arise.

- [x] 17. `runPbtGate` and Fixtures
  - Wire up the gate function and generate the haunted-repo fixture.

  - [x] 17.1 Write `src/properties/index.ts` — re-exports all 12 property functions (`p1Range` through `p12Serialize`). Defines `PbtGateResult` type and `runPbtGate(cfg: LetheConfig): Promise<PbtGateResult>`. Runs all 12 properties sequentially via `fc.assert` with 100 iterations each; returns on first failure with `{ status: "failed", propertyId, seed, counterexample }`.
    - _Requirements: REQ-PBT-3_

  - [x] 17.2 Write `src/fixtures/haunted-repo.ts` — `generateHauntedRepo(seed: number, cfg: LetheConfig): VirtualWorkspace`. Uses seeded LCG (`state = (1664525 * state + 1013904223) % 2^32`) — never `Math.random()`. Produces: ~45 engrams across 6 steering files, 3 active `SpecInvariant` objects, ≥ 3 contradiction pairs (opposing `css-approach`, `module-system`, `error-handling` stances baked in), ≥ 6 stale engrams (`R < 0.25` via old `lastReinforcedCommit`), ≥ 2 near-duplicate pairs (Jaccard ≥ 0.85), 60-day/150-commit history baked into `LedgerEvent[]`.
    - _Requirements: REQ-PBT-4_

- [x] 18. Barrel, TypeCheck, and Performance Gate
  - Final wiring and quality-gate verification.

  - [x] 18.1 Write `src/index.ts` — named re-exports of all public types and functions: `parseDocument`, `serializeDocument`, `score`, `reinforce`, `detectContradictions`, `planConsolidation`, `applyPlan`, `resurrect`, `DEFAULT_CONFIG`, `validateConfig`, `generateHauntedRepo`, `runPbtGate`, and all types from `types.ts`.
    - _Requirements: INV-7, NFR-4_

  - [x]* 18.2 Run `bun run typecheck` — zero type errors, zero uses of `any`. Verify compiler flags active: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`.
    - _Requirements: INV-7_

  - [x]* 18.3 Run `bun test` with `FC_NUM_RUNS=100` — all unit tests and all PBT tests pass. Confirm each of the 12 properties is exercised.
    - _Requirements: REQ-PBT-1_

  - [x] 18.4 Write a performance benchmark (as a `bench` or timed test in `test/decay.unit.test.ts`): generate 500 `EngramNode` objects with 500 corresponding `EngramState` entries and a 500-event `LedgerEvent[]`, call `score(...)` in a warm process (run once before timing), measure with `performance.now()`, assert elapsed < 50 ms.
    - _Requirements: NFR-1_

  - [x]* 18.5 Append one line to `.kiro/steering/06-memory.md` changelog: `- <date> · phase 1 · spec · lethe-core tasks.md created + all milestones green · Refs: REQ-PAR-1, REQ-DEC-1, REQ-CON-1, REQ-CRY-1, REQ-PBT-1 · commit <sha7>`.
    - _Requirements: INV-4_

---

## Notes

- Tasks marked with `*` are optional sub-tasks (tests and documentation steps). Core implementation sub-tasks without `*` are mandatory.
- Every task references specific `REQ-*` or `INV-*` ids for traceability per `03-rules.md §10`.
- PBT tasks are interleaved with the subsystems they test — not deferred appendices.
- `bun run typecheck` and `bun test` are the quality gate commands for this package.
- `FC_NUM_RUNS=100` locally; CI sets `FC_NUM_RUNS=1000`.
- The 12 properties live in `src/properties/` (not `test/`) so the web sandbox can import them directly.
- Milestone ordering ensures every task depends only on completed prior milestones.
- Any PBT failure must record a shrunk counterexample in `06-memory.md` PBT Findings per `03-rules.md §5`.

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 5, "tasks": ["4.5", "6.1", "6.2", "6.3", "6.4"] },
    { "id": 6, "tasks": ["6.5", "7.1", "7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.6"] },
    { "id": 8, "tasks": ["7.7", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 10, "tasks": ["8.5", "10.1"] },
    { "id": 11, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 12, "tasks": ["10.5", "10.6"] },
    { "id": 13, "tasks": ["11.1", "11.2"] },
    { "id": 14, "tasks": ["11.3", "12.1"] },
    { "id": 15, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 16, "tasks": ["12.5", "14.1"] },
    { "id": 17, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 18, "tasks": ["15.1", "15.2"] },
    { "id": 19, "tasks": ["15.3", "15.4", "15.5"] },
    { "id": 20, "tasks": ["15.6", "15.7"] },
    { "id": 21, "tasks": ["17.1", "17.2"] },
    { "id": 22, "tasks": ["18.1"] },
    { "id": 23, "tasks": ["18.2", "18.3", "18.4"] },
    { "id": 24, "tasks": ["18.5"] }
  ]
}
```
