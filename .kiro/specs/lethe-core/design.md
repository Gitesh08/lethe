# Design Document

## Overview

`lethe-core` is the pure TypeScript engine that implements biomimetic memory decay for Kiro steering files. It parses markdown documents into addressable engrams, scores each engram with an Ebbinghaus retention value, detects contradictions between steering rules using a deterministic ontology, and plans reversible consolidation of stale or defeated engrams into a cold store. The package has zero runtime dependencies and runs identically on Node 22+, Bun, and modern browsers. All IO, clock access, and filesystem operations are strictly forbidden; the engine operates exclusively on in-memory `VirtualWorkspace` objects supplied by callers. This design document drives implementation of all five subsystems — Parser, Decay Engine, Contradiction Detector, Consolidation Engine, and PBT Suite — described in `requirements.md`.

---

## Architecture

### Package Layout

```
packages/lethe-core/
├── src/
│   ├── types.ts                    # All exported types (authoritative)
│   ├── result.ts                   # Result<T,E>, ok(), err(), match()
│   ├── config.ts                   # DEFAULT_CONFIG + validateConfig()
│   ├── parse/
│   │   ├── slug.ts                 # slugify(path, headingPath) → string
│   │   ├── hash.ts                 # sha256(text): string — pure sync, no platform API
│   │   ├── frontmatter.ts          # parseFrontmatter(text) → Result<{fm,rest},LetheError>
│   │   ├── section.ts              # splitSections(text, granularity) → RawSection[]
│   │   ├── annotation.ts           # parseAnnotation(body) → Annotation
│   │   └── document.ts             # parseDocument / serializeDocument
│   ├── decay/
│   │   ├── delta.ts                # computeDeltaC(state, nowCommit, nowISO, alpha) → number
│   │   ├── retention.ts            # computeRetention(deltaC, S, W) → number
│   │   ├── weight.ts               # computeWeight(node, specs, cfg) → WeightResult
│   │   ├── reinforce.ts            # reinforce(state, ev, cfg) → EngramState
│   │   └── score.ts                # score(input) → ScoredEngram[]
│   ├── contradiction/
│   │   ├── default-ontology.ts     # DEFAULT_AXES: Axis[] (exactly 12 axes)
│   │   ├── validate-ontology.ts    # validateOntology(axes) → Result<CompiledOntology,LetheError>
│   │   ├── scan.ts                 # scanEngram(body, compiled) → StanceMatch[]
│   │   ├── resolve.ts              # resolveContradiction(a,b,axis,scored) → ContradictionReport
│   │   └── detect.ts               # detectContradictions(scored, specs, ontology?) → Result<...>
│   ├── consolidate/
│   │   ├── jaccard.ts              # jaccard(bodyA, bodyB): number
│   │   ├── dedupe.ts               # findDuplicates(scored, cfg) → DupePair[]
│   │   ├── budget.ts               # computeBudget(scored, cfg) → BudgetAnalysis
│   │   └── plan.ts                 # planConsolidation(scored, reports, cfg) → ConsolidationPlan
│   ├── crypt/
│   │   ├── archive.ts              # toTombstone(scored, reason, ...) → TombstoneRecord
│   │   ├── apply.ts                # applyPlan(workspace, plan, ...) → ApplyResult
│   │   └── resurrect.ts            # resurrect(workspace, tomb, ...) → Result<VirtualWorkspace>
│   ├── properties/                 # separate entry point "@lethe/core/properties"
│   │   ├── index.ts, gate.ts, json-safe.ts, arbitraries/
│   │   ├── p1-range.ts             # P1: 0 < R ≤ 1
│   │   ├── p2-monotonic.ts         # P2: decay is monotonic without reinforcement
│   │   ├── p3-reinforce.ts         # P3: reinforcement never lowers S or R
│   │   ├── p4-protected.ts         # P4: protected engrams never archived, R ≥ specFloor
│   │   ├── p5-contradiction.ts     # P5: no unresolved contradictions coexist in Hot/Warm
│   │   ├── p6-budget.ts            # P6: Hot tokens ≤ K or budget_infeasible with protected intact
│   │   ├── p7-roundtrip.ts         # P7: resurrect(archive(e)) deep-equals e
│   │   ├── p8-idempotent.ts        # P8: consolidate(consolidate(w)) = consolidate(w)
│   │   ├── p9-determinism.ts       # P9: same inputs → byte-identical outputs
│   │   ├── p10-partition.ts        # P10: every engram in exactly one tier
│   │   ├── p11-symmetric.ts        # P11: detect(a,b) === detect(b,a)
│   │   └── p12-serialize.ts        # P12: serialize(parse(text)) === text
│   ├── fixtures/
│   │   └── haunted-repo.ts         # generateHauntedRepo(seed, cfg) → VirtualWorkspace
│   └── index.ts                    # barrel: all public exports
└── test/
    ├── (arbitraries moved to src/properties/arbitraries/: engram, state, ledger, workspace, adversarial, ...)
    ├── pbt-runner.ts
    ├── boundary.unit.test.ts       # import-graph + purity scan
    ├── parse.unit.test.ts
    ├── decay.unit.test.ts
    ├── contradiction.unit.test.ts
    ├── consolidate.unit.test.ts
    ├── crypt.unit.test.ts
    ├── decay.pbt.test.ts
    ├── parse.pbt.test.ts
    ├── contradiction.pbt.test.ts
    ├── consolidate.pbt.test.ts
    └── crypt.pbt.test.ts
```

---

## Data Models

```ts
// src/types.ts — authoritative from 02-architecture §4

export type Tier = "hot" | "warm" | "crypt";
export type EngramStatus = "active" | "defeated" | "duplicate";

export interface EngramNode {
  readonly id: string;
  readonly file: string;
  readonly headingPath: readonly string[];
  readonly body: string;
  readonly contentHash: string;
  readonly tokens: number;
  readonly globs: readonly string[];
  readonly specLinks: readonly string[];
  readonly pinned: boolean;
  readonly span: { readonly start: number; readonly end: number };
}

export interface EngramState {
  readonly id: string;
  readonly stability: number;
  readonly lastReinforcedCommit: number;
  readonly lastReinforcedAt: string;
  readonly reinforcements: number;
}

export interface SpecInvariant {
  readonly specName: string;
  readonly active: boolean;
  readonly requirementIds: readonly string[];
  readonly stances: readonly string[];
}

export interface ScoredEngram {
  readonly node: EngramNode;
  readonly state: EngramState;
  readonly deltaC: number;
  readonly weight: number;
  readonly retention: number;
  readonly rawRetention: number;
  readonly tier: Tier;
  readonly status: EngramStatus;
  readonly protected: boolean;
}

export interface ContradictionReport {
  readonly axis: string;
  readonly a: { id: string; stance: string; evidence: string };
  readonly b: { id: string; stance: string; evidence: string };
  readonly severity: "low" | "medium" | "high";
  readonly resolution:
    | { kind: "resolved"; winner: string; loser: string; reason: "spec" | "retention" | "recency" | "id" }
    | { kind: "unresolvable"; reason: "both-protected" };
}

export interface TombstoneRecord {
  readonly schema: 1;
  readonly id: string;
  readonly file: string;
  readonly headingPath: readonly string[];
  readonly body: string;
  /** Exact `fileText.slice(span.start, span.end)` (heading line + body, byte-exact incl. CRLF); makes resurrection byte-exact. `body` is kept for hashing/search. */
  readonly raw: string;
  readonly contentHash: string;
  readonly tokens: number;
  readonly meta: { globs: readonly string[]; specLinks: readonly string[]; pinned: boolean };
  readonly state: EngramState;
  readonly reason: "decayed" | "contradiction" | "duplicate";
  readonly retentionAtDeath: number;
  readonly buriedAtCommit: number;
  readonly buriedAt: string;
  readonly defeatedBy?: string;
  readonly position: { readonly index: number; readonly neighborBefore?: string };
}

export interface SleepConsolidationResult {
  readonly archived: readonly TombstoneRecord[];
  readonly merged: ReadonlyArray<{ keep: string; drop: string }>;
  readonly demoted: readonly string[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly budget: number;
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly pbtGate: "passed" | "failed" | "skipped";
  readonly applied: boolean;
}

export interface LetheConfig {
  readonly s0: number;            // default: 5
  readonly sMax: number;          // default: 120
  readonly sMin: number;          // default: 0.5
  readonly beta: number;          // default: 0.5
  readonly alpha: number;         // default: 0.25
  readonly wDefault: number;      // default: 1
  readonly wSpec: number;         // default: 4
  readonly specFloor: number;     // default: 0.50
  readonly hotMin: number;        // default: 0.60
  readonly cryptMax: number;      // default: 0.25
  readonly budgetTokens: number;  // default: 4000
  readonly dedupeJaccard: number; // default: 0.85
  readonly granularity: "section" | "bullet";
}

export interface LedgerEvent {
  readonly type: "task_passed" | "spec_cited" | "manual_pin";
  readonly at: string;
  readonly commit: number;
  readonly filesTouched?: readonly string[];
  readonly cited?: readonly string[];
}

// Internal types required by the engine

export interface ParsedDoc {
  readonly file: string;
  readonly frontmatter: string | null;  // raw block including --- delimiters, or null
  readonly engrams: readonly EngramNode[];
  readonly rawText: string;             // original full file text (for round-trip)
}

export interface Annotation {
  readonly globs: readonly string[];
  readonly specLinks: readonly string[];
  readonly pinned: boolean;
}

export interface StanceMatch {
  readonly axisId: string;
  readonly stanceId: string;
  readonly polarity: "+" | "-";
  readonly evidence: string;
}

export interface Stance {
  readonly id: string;
  readonly label: string;
  readonly patterns: readonly string[];  // pattern strings; compiled at validateOntology time
  readonly negationAware: boolean;
}

export interface Axis {
  readonly id: string;
  readonly description: string;
  readonly stances: readonly Stance[];
}

export type Ontology = readonly Axis[];

export interface ConsolidationPlan {
  readonly toArchive: ReadonlyArray<{ engram: ScoredEngram; reason: TombstoneRecord["reason"] }>;
  readonly toMerge: ReadonlyArray<{ keep: ScoredEngram; drop: ScoredEngram }>;
  readonly toDemote: readonly string[];
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface VirtualWorkspace {
  readonly files: ReadonlyMap<string, string>;
  readonly tombstones: readonly TombstoneRecord[];
}

export type ErrorCode =
  | "PARSE_INVALID_FRONTMATTER"
  | "PARSE_DUPLICATE_ID"
  | "CONFIG_INVALID"
  | "ONTOLOGY_INVALID_PATTERN"
  | "BUDGET_INFEASIBLE"
  | "TOMBSTONE_NOT_FOUND"
  | "PATH_ESCAPE"
  | "PBT_GATE_FAILED";

export interface LetheError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly detail?: unknown;
}

export type Result<T, E = LetheError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

---

## Components and Interfaces

### 1. Result Type (`src/result.ts`)

The `Result<T, E>` type is a discriminated union used as the return type of all fallible functions. It replaces thrown exceptions at IO/validation boundaries.

**Exports:**
- `ok<T>(value: T): Result<T, never>` — wraps a success value
- `err<E>(error: E): Result<never, E>` — wraps a failure
- `match<T, E, R>(result: Result<T, E>, cases: { ok: (v: T) => R; err: (e: E) => R }): R` — exhaustive pattern match

The `match` helper enables exhaustive handling without casting. All callers must handle both branches. File target: ≤ 40 lines. <!-- REQ-DEC-6 -->

---

### 2. Config (`src/config.ts`)

**`DEFAULT_CONFIG: LetheConfig`** — compile-time constant with all canonical defaults:

| Field | Default | Constraint |
|---|---|---|
| `s0` | 5 | > 0 |
| `sMax` | 120 | ≥ s0 |
| `sMin` | 0.5 | > 0 |
| `beta` | 0.5 | ≥ 0 |
| `alpha` | 0.25 | ≥ 0 |
| `wDefault` | 1 | ≥ 1 |
| `wSpec` | 4 | ≥ wDefault |
| `specFloor` | 0.50 | 0 < specFloor < 1 |
| `hotMin` | 0.60 | cryptMax < hotMin < 1 |
| `cryptMax` | 0.25 | 0 < cryptMax < hotMin |
| `budgetTokens` | 4000 | > 0 |
| `dedupeJaccard` | 0.85 | 0 < dedupeJaccard ≤ 1 |
| `granularity` | `"section"` | enum |

**`validateConfig(partial: unknown): Result<LetheConfig, LetheError>`** — merges `partial` over `DEFAULT_CONFIG`, then validates every field against the constraints above. Returns `CONFIG_INVALID` with a descriptive message on any violation. <!-- REQ-DEC-1, NFR-1 -->

---

### 3. SHA-256 (`src/parse/hash.ts`)

A self-contained pure synchronous TypeScript implementation of SHA-256 with no platform API calls (no `globalThis.crypto`, no `node:crypto`). This guarantees identical output across Node, Bun, and browsers. <!-- INV-7, REQ-PAR-2 -->

**Algorithm outline:**
1. Define the 64 K constants and 8 initial hash words (H0–H7) as compile-time `Uint32Array`.
2. Pad the input (UTF-8 encoded bytes): append `0x80`, zero bytes, then 64-bit big-endian bit-length so total length is a multiple of 512 bits.
3. Process each 512-bit (64-byte) block: expand 16 message schedule words to 64 using σ0/σ1 rotations, then run 64 compression rounds using Σ0/Σ1/Ch/Maj operations.
4. Produce the 256-bit digest as 8 big-endian 32-bit words, formatted as a lowercase 64-character hex string.

**Interface:** `sha256(text: string): string` — input is a string (normalized before hashing); output is a 64-char lowercase hex digest.

The implementation is approximately 80 lines of constant tables plus compression logic, staying within the 200-line file limit with a private helper for the round function.

---

### 4. Parser (`src/parse/`)

#### `slug.ts` — `slugify(relativePath: string, headingPath: readonly string[]): string`

1. Join `relativePath` and `headingPath` elements with `#`.
2. Lowercase the entire string.
3. Replace any run of characters that are not `[a-z0-9]` with a single `-`.
4. Trim leading and trailing `-` characters.

The `id` is stable: renaming a section body changes `contentHash` but not `id`; changing the heading text or file path changes `id`. <!-- REQ-PAR-2 -->

#### `frontmatter.ts` — `parseFrontmatter`

- Input: raw file text.
- If the text does not begin with `---\n`, return `{ fm: null, rest: text }`.
- Scan for a subsequent line containing only `---`. If found before any H2/H3 heading or end-of-file, return `{ fm: rawBlock, rest: remainder }`.
- If the opening `---` is present but no closing `---` is found, return `err({ code: "PARSE_INVALID_FRONTMATTER" })`. <!-- REQ-PAR-6 -->

#### `section.ts` — `splitSections`

Returns `RawSection[]` where each entry has `{ headingPath: string[]; body: string; span: { start: number; end: number } }`.

**Section granularity (`"section"`):**
- Walk the text character by character tracking line boundaries.
- When encountering a line starting with `##` or `###`, begin a new section. The `headingPath` is the stack of ancestor heading texts plus the current heading text (outermost to innermost).
- A section's body runs from the line after its heading to (but not including) the next heading of equal or higher level, or end-of-document.
- `span.start` = index of the first character of the heading line; `span.end` = exclusive index one past the last character of the section body.

**Bullet granularity (`"bullet"`):**
- Identify top-level list items (lines starting with `- ` or `* ` or `N. ` at column 0).
- Each item's body includes all nested sub-list lines (indented 2+ spaces) that follow until the next top-level item or end-of-document.
- `headingPath` is the zero-based decimal index of the item as a string array: `["0"]`, `["1"]`, etc.

<!-- REQ-PAR-1 -->

#### `annotation.ts` — `parseAnnotation`

Scans the body string for the first occurrence of `<!-- lethe: ... -->`. Extracts key-value pairs separated by `;`. Known keys:

| Key | Parser | Default |
|---|---|---|
| `globs` | split by `,`, trim each | `[]` |
| `spec` | split by `,`, trim each → `specLinks` | `[]` |
| `pin` | `=== "true"` → boolean | `false` |

Unrecognized keys are silently ignored. Always returns a valid `Annotation` — never fails. <!-- REQ-PAR-4 -->

#### `document.ts` — `parseDocument` and `serializeDocument`

**`parseDocument(file, text, cfg): Result<ParsedDoc, LetheError>`**

1. Call `parseFrontmatter(text)` — propagate failure if any.
2. Call `splitSections(rest, cfg.granularity)` to get `RawSection[]`.
3. For each `RawSection`, call `parseAnnotation(body)`, `slugify(file, headingPath)` for `id`, `sha256(normalizedBody)` for `contentHash`, and `Math.ceil(body.length / 4)` for `tokens`.
4. Check for duplicate `id` values across all sections — return `err({ code: "PARSE_DUPLICATE_ID" })` if found. <!-- REQ-PAR-2 -->
5. Return `ok({ file, frontmatter: fm, engrams, rawText: text })`.

**`serializeDocument(doc: ParsedDoc): string`**

Reconstructs the original file text by concatenating:
1. `doc.frontmatter ?? ""`
2. Each engram's source text reconstructed from `span` offsets in `doc.rawText`.

Because `rawText` is preserved verbatim in `ParsedDoc`, serialization is: `rawText` itself (when the doc was parsed successfully, `rawText` is already the full source). The round-trip guarantee holds by construction: the serialized output equals `doc.rawText`. <!-- REQ-PAR-5 -->

---

### 5. Decay Engine (`src/decay/`)

#### `delta.ts` — `computeDeltaC`

```
commitsSince = nowCommit - state.lastReinforcedCommit   (≥ 0, clamp to 0)
daysSince    = (new Date(nowISO).getTime() - new Date(state.lastReinforcedAt).getTime())
               / (1000 * 60 * 60 * 24)                  (≥ 0, clamp to 0)
ΔC = commitsSince + alpha × daysSince
```

`new Date(isoString)` is permitted because it takes an explicit argument. `new Date()` with no arguments is banned. <!-- REQ-DEC-2, REQ-DEC-6 -->

#### `retention.ts` — `computeRetention`

```
S_eff = Math.max(S, cfg.sMin)
R     = Math.exp(-deltaC / (S_eff * W))
```

Always returns a value in `(0, 1]` for valid inputs. <!-- REQ-DEC-1, P1 -->

#### `weight.ts` — `computeWeight`

Returns `{ W: number; isProtected: boolean; floor: number }`.

- If `node.pinned === true` OR `node.specLinks` contains a name matching any active `SpecInvariant.specName`: `W = cfg.wSpec`, `isProtected = true`, `floor = cfg.specFloor`.
- Otherwise: `W = cfg.wDefault`, `isProtected = false`, `floor = 0`.
- Pinned + spec-linked → `wSpec` applied once, not compounded. <!-- REQ-DEC-4, REQ-DEC-7, REQ-DEC-8 -->

#### `reinforce.ts` — `reinforce`

Applies one `LedgerEvent` to an `EngramState`:

```
newS = Math.min(state.stability * (1 + cfg.beta), cfg.sMax)
return { ...state, stability: newS, lastReinforcedCommit: ev.commit,
         lastReinforcedAt: ev.at, reinforcements: state.reinforcements + 1 }
```

<!-- REQ-DEC-3, P3 -->

#### Reinforcement matching (inside `score.ts`)

An event reinforces an engram when:
- `task_passed`: `filesTouched` contains a path matching any glob in `engram.globs` (minimatch-compatible), OR `cited` contains the engram's exact `id`, OR `cited` contains a string matching any element of `engram.specLinks`.
- `spec_cited` / `manual_pin`: `cited` contains the engram's exact `id` or a matching `specLink`. <!-- REQ-DEC-5 -->

#### `score.ts` — `score`

Algorithm (all pure):
1. Validate config — return early on `CONFIG_INVALID`.
2. Build a `Map<id, EngramState>` from `states`; for any engram without a state, synthesize a default state: `{ stability: cfg.s0, lastReinforcedCommit: 0, lastReinforcedAt: nowISO, reinforcements: 0 }`.
3. Apply `ledger` events in order: for each event, check all engrams for matching, call `reinforce` on matches.
4. For each engram, compute `computeWeight`, then `computeDeltaC`, then `computeRetention`.
5. Apply floor: `retention = Math.max(rawRetention, floor)`.
6. Assign tier: `retention ≥ cfg.hotMin` → `"hot"`; `retention ≥ cfg.cryptMax` → `"warm"`; else → `"crypt"`.
7. Return `ScoredEngram[]` sorted by `(tier-rank, -retention, id)` for determinism. <!-- REQ-DEC-11, P10 -->

---

### 6. Contradiction Detector (`src/contradiction/`)

#### Default Ontology (`default-ontology.ts`)

Exactly 12 axes with the following ids, each containing ≥ 2 stances:

| Axis id | Example stances |
|---|---|
| `state-management` | `redux`, `zustand`, `context`, `signals` |
| `css-approach` | `tailwind`, `pure-css`, `css-in-js`, `css-modules` |
| `framework` | `react`, `angular`, `vue`, `svelte` |
| `package-manager` | `npm`, `yarn`, `pnpm`, `bun` |
| `test-runner` | `jest`, `vitest`, `mocha` |
| `module-system` | `esm`, `commonjs` |
| `error-handling` | `throw`, `result-type` |
| `typing-strictness` | `strict`, `loose` |
| `component-model` | `server-components`, `client-components` |
| `data-fetching` | `react-query`, `swr`, `server-fetch`, `no-fetch` |
| `naming-convention` | `camelCase`, `kebab-case`, `PascalCase` |
| `file-size-policy` | `micro-files`, `standard-files`, `large-files` |

Each `Stance` has `patterns: string[]` (validated into `RegExp` at runtime). <!-- REQ-CON-2, REQ-CON-5 -->

#### `validate-ontology.ts` — `validateOntology`

- Attempts `new RegExp(pattern)` for every pattern string in every stance.
- On any failure: return `err({ code: "ONTOLOGY_INVALID_PATTERN", detail: { axis, stance, pattern } })`.
- On success: return `ok(compiledOntology)` where `CompiledOntology = ReadonlyArray<CompiledAxis>` with `compiledPatterns: ReadonlyArray<RegExp>`.
- All patterns are validated before any scanning occurs. <!-- REQ-CON-1, REQ-CON-10 -->

Input-length cap: before running any ontology pattern against an engram body, truncate the body to 8,192 characters for ReDoS protection. <!-- §11 Security -->

#### `scan.ts` — `scanEngram`

Splits `body` into sentences at `.`, `!`, `?`, or newline. For each sentence and each axis:
1. For each `Stance`, test each compiled pattern against the sentence.
2. If a pattern matches and `negationAware === true`, check the 4-token lookbehind window for negation words: `do not`, `never`, `avoid`, `no`, `instead of`.
3. Polarity: `+` if pattern matches and no negation; `-` if pattern matches and negation found.
4. Yield a `StanceMatch` for each match.

<!-- REQ-CON-3 -->

#### `resolve.ts` — `resolveContradiction`

Priority for winner selection (first applicable rule wins):
1. Protected beats unprotected → `reason: "spec"`.
2. Higher `retention` wins → `reason: "retention"`.
3. Higher `lastReinforcedCommit` wins → `reason: "recency"`.
4. Lexicographically smaller `id` wins → `reason: "id"`.

If both engrams are protected: `resolution = { kind: "unresolvable", reason: "both-protected" }`. <!-- REQ-CON-4, REQ-CON-6 -->

Severity rules:
- `"high"` if either engram is protected.
- `"medium"` if both are Hot tier.
- `"low"` otherwise.

#### `detect.ts` — `detectContradictions`

1. Merge user ontology (if any) with `DEFAULT_AXES`: matching axis/stance `id`s are replaced; new ids appended.
2. Call `validateOntology` on merged set — propagate failure.
3. Call `scanEngram` on every engram body — collect `Map<engramId, StanceMatch[]>`.
4. For each axis, collect all engrams with a positive-polarity stance. For each pair with conflicting stances (different stances on same axis, or one `+` vs one `-` on same stance), call `resolveContradiction`.
5. Deduplicate: emit at most one report per `(axis, engramA.id, engramB.id)` pair.
6. Sort output by `(axis, a.id, b.id)` using lexicographic comparison.
7. Return `ok(reports)`. <!-- REQ-CON-3, REQ-CON-5, REQ-CON-8 -->

---

### 7. Consolidation Engine (`src/consolidate/`)

#### `jaccard.ts` — `jaccard(bodyA, bodyB): number`

1. Tokenize each body: `body.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean)`.
2. Form `Set<string>` for each.
3. Compute `|intersection| / |union|`. Return `0` when both sets are empty (no division by zero). <!-- REQ-CRY-5, REQ-CRY-13 -->

#### `dedupe.ts` — `findDuplicates`

- O(n²) pairwise Jaccard scan over all non-protected engrams.
- Collect pairs where `jaccard(a.node.body, b.node.body) >= cfg.dedupeJaccard`.
- Sort pairs descending by similarity score.
- Greedy resolution: for each pair, the engram with higher `retention` is the keeper (ties broken by lex-smaller `id`). Mark the loser; a previously kept engram may become a loser in a later resolution.

Returns `DupePair[]` where `DupePair = { keep: ScoredEngram; drop: ScoredEngram; similarity: number }`. <!-- REQ-CRY-5 -->

#### `budget.ts` — `computeBudget`

- `hotEngrams` = all `ScoredEngram` with `tier === "hot"` that are not in `toArchive`.
- `tokensBefore` = sum of `tokens` for all hot engrams.
- `protectedHotTokens` = sum for protected hot engrams only.
- If `protectedHotTokens > cfg.budgetTokens`: return `{ status: "budget_infeasible", demotion: [] }`.
- Otherwise: sort non-protected hot engrams by `retention` ascending; accumulate into `demotion[]` until remaining hot tokens ≤ budget. <!-- REQ-CRY-2, REQ-CRY-3, REQ-CRY-4 -->

#### `plan.ts` — `planConsolidation`

Pure dry-run function — no mutations. Algorithm:

1. Collect `toArchive` candidates: non-protected engrams where `retention < cfg.cryptMax` OR `status === "defeated"`. Protected engrams are unconditionally excluded. <!-- REQ-CRY-1 -->
2. Collect `toMerge` from `findDuplicates`.
3. Resolve budget with `computeBudget` on the post-archive/merge hot tier.
4. Return `ConsolidationPlan` with `toArchive`, `toMerge`, `toDemote`, `budgetStatus`, `tokensBefore`, `tokensAfter`.

Caveat: demotion is derived from retention on every pass and is not persisted, so after `applyPlan` a re-plan has empty `toArchive`/`toMerge` but a STABLE `toDemote` identical to the first plan's. <!-- REQ-CRY-4, INV-4 -->

<!-- REQ-CRY-6, REQ-CRY-10 -->

---

### 8. Crypt (`src/crypt/`)

#### `archive.ts` — `toTombstone`

Constructs a `TombstoneRecord` (schema: 1) from a `ScoredEngram`. Fields:
- `body`: taken from `engram.node.body` exactly (byte-exact).
- `raw`: a caller-provided parameter of `toTombstone`; `applyPlan` fills it from the file text via the node span (`fileText.slice(span.start, span.end)`). Resurrection re-inserts `raw`, which is what makes it byte-exact. <!-- REQ-CRY-3, INV-3 -->
- `meta`: `{ globs, specLinks, pinned }` from `engram.node`.
- `state`: `engram.state` at time of archival.
- `reason`: caller-provided (`"decayed"` | `"contradiction"` | `"duplicate"`).
- `retentionAtDeath`: `engram.retention`.
- `position`: `{ index, neighborBefore?: string }` from caller. <!-- REQ-CRY-1 -->

#### `apply.ts` — `applyPlan`

Takes the current `VirtualWorkspace` plus a `ConsolidationPlan` and returns a new `VirtualWorkspace` (immutable):

1. For each entry in `plan.toArchive` and `plan.toMerge.drop`: remove the engram's text span from its file using the `span` offsets; call `toTombstone`; add to tombstone list.
2. Compute `index` and `neighborBefore` for each archived engram from its position in the pre-apply file's engram list.
3. For `plan.toDemote`: these are metadata changes only (tier is recomputed during `score`, not stored in file text). No file mutation needed — the plan is recorded for reporting.
4. Return the updated workspace. <!-- REQ-CRY-2, REQ-CRY-6 -->

#### `resurrect.ts` — `resurrect`

1. Find the `TombstoneRecord` by `tomb.id` in `workspace.tombstones` — return `TOMBSTONE_NOT_FOUND` if absent. <!-- REQ-CRY-12 -->
2. Locate the target file in `workspace.files`. Parse it to get current engram list.
3. Determine insert position: if `tomb.position.index <= currentEngrams.length`, insert at that position; otherwise append under `## Resurrected`.
4. Insert the engram text at the correct position in the file string.
5. Remove the tombstone from the list.
6. Return the updated `VirtualWorkspace`. <!-- REQ-CRY-7, REQ-CRY-11 -->

On first subsequent `score` call, the resurrected engram defaults to `stability = cfg.s0` and `lastReinforcedCommit = nowCommit`, yielding `ΔC = 0` → `R = 1.0`. <!-- REQ-CRY-6 -->

---

### 9. Properties (`src/properties/`)

Each file exports one named function returning an `fc.IProperty` (from `fast-check`). Properties and their arbitraries live in `src/properties/` and `src/properties/arbitraries/` (not `test/`), so no file in `src/` depends on `test/` and the browser sandbox can import them without Vitest. They are published as a separate package entry point, `@lethe/core/properties`; the engine entry point (`.`) never imports `src/properties/` or `fast-check`. `fast-check` is an optional peer dependency (and a devDependency) used only by that entry point. `test/boundary.unit.test.ts` enforces this by scanning the import graph from `src/index.ts`. <!-- REQ-PBT-1 -->

`src/properties/index.ts` re-exports all 12 property functions plus:

```ts
export type PbtGateResult =
  | { status: "passed"; ran: number; numRuns: number }
  | { status: "failed"; propertyId: string; seed: number; counterexample: unknown; message: string };

export const PROPERTY_IDS: readonly string[]; // "P1".."P12"
export function runPbtGate(
  cfg: LetheConfig,
  opts?: { numRuns?: number; onProgress?: (id: string, index: number, total: number) => void },
): Promise<PbtGateResult>
export function pbtFailureEntry(result, atISO): { propertyId; seed; counterexample; failedAt }
export function appendPbtFailure(existingText: string | undefined, entry): string // pure text, no IO
```

`runPbtGate` runs the 12 properties sequentially (P1..P12) using `fc.check` (never `fc.assert`), 100 runs each by default, and returns on the first failure with `seed = details.seed` and a JSON-safe `counterexample` (strings truncated at 2000 chars; cycles and BigInt handled). It never throws: exceptions from a property or factory become a `failed` result. It yields to the event loop between properties. The file IO for `.kiro/lethe/pbt-failures.json` stays in `lethe-mcp`; `appendPbtFailure` only builds the new file text (a missing or malformed file yields `{ "failures": [entry] }`). <!-- REQ-PBT-3, REQ-PBT-5 -->

---

### 10. Fixtures (`src/fixtures/haunted-repo.ts`)

**`generateHauntedRepo(seed: number, cfg: LetheConfig): VirtualWorkspace`**

Uses a seeded linear congruential generator (LCG: `state = (a * state + c) % m` with well-chosen constants) — never `Math.random()`. <!-- INV-7 -->

Produces a deterministic `VirtualWorkspace` with:
- ~45 engrams across 6 steering files (names drawn from the real vault: `01-prd.md`, `02-architecture.md`, etc.)
- 3 active `SpecInvariant` objects with overlapping stances
- ≥ 3 contradiction pairs (seeded engrams with opposing `css-approach`, `module-system`, and `error-handling` stances)
- ≥ 6 stale engrams with `R < 0.25` (enforced by baking in high `Δc` via old `lastReinforcedCommit`)
- ≥ 2 near-duplicate pairs with Jaccard ≥ 0.85
- 60-day / 150-commit history baked in via a `LedgerEvent[]` with varying event types and file paths

<!-- REQ-PBT-7 -->

---

## Data Flow

The full pipeline for one scoring pass, from files to optional write:

```
VirtualWorkspace (files Map + tombstones)
  │
  ├─▶ parseDocument(file, text, cfg)        [parse/]
  │     → Result<ParsedDoc, LetheError>
  │     → EngramNode[]
  │
  ├─▶ score({ engrams, states, specs,       [decay/]
  │           ledger, nowCommit, nowISO, cfg })
  │     → ScoredEngram[]
  │       (deltaC, weight, rawRetention,
  │        retention, tier, protected)
  │
  ├─▶ detectContradictions(scored,          [contradiction/]
  │     specs, ontology?)
  │     → Result<ContradictionReport[], LetheError>
  │       (each report has resolved winner/loser
  │        or unresolvable marker)
  │
  ├─▶ planConsolidation(scored,             [consolidate/]
  │     reports, cfg)
  │     → ConsolidationPlan
  │       (toArchive, toMerge, toDemote,
  │        budgetStatus, token counts)
  │     [dry-run: no mutations yet]
  │
  └─▶ applyPlan(workspace, plan,            [crypt/]
        nowCommit, nowISO)  ← requires apply:true from caller
        → { workspace: VirtualWorkspace;
            tombstones: TombstoneRecord[] }
          (updated files Map, extended tombstone list)
```

The IO layer (`lethe-mcp`) is responsible for loading disk files into the `VirtualWorkspace` before calling `parseDocument`, and for writing the updated workspace back to disk after `applyPlan`. Core is never aware of the filesystem.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Retention is always in range

*For any* valid combination of `LetheConfig`, `EngramState`, effective age `ΔC ≥ 0`, and weight `W ≥ 1`, the computed retention value `R = exp(-ΔC / (S · W))` is always strictly greater than 0 and at most 1.

**Validates: Requirements 2.1, 2.5** <!-- REQ-DEC-1, INV-2 -->

### Property 2: Decay is monotonic without reinforcement

*For any* engram and two effective ages `ΔC₁ ≤ ΔC₂` with identical stability and weight, the retention at `ΔC₁` is greater than or equal to the retention at `ΔC₂`.

**Validates: Requirements 2.3** <!-- REQ-DEC-2, INV-2 -->

### Property 3: Reinforcement never lowers stability or immediate retention

*For any* `EngramState` and any valid `LedgerEvent` that matches an engram, calling `reinforce` produces a new state where `stability` is greater than or equal to the original stability, and computing retention at `ΔC = 0` on the new state yields a value greater than or equal to the original.

**Validates: Requirements 2.4, 2.9** <!-- REQ-DEC-3, REQ-DEC-5 -->

### Property 4: Protected engrams are never archived and always meet the retention floor

*For any* scored workspace and consolidation plan, no engram that is pinned or linked to an active spec appears in `plan.toArchive`, and every such engram has `retention ≥ cfg.specFloor`.

**Validates: Requirements 2.7, 2.8, 4.1** <!-- REQ-DEC-4, REQ-DEC-7, REQ-DEC-8, REQ-CRY-1, INV-1 -->

### Property 5: No resolved contradiction pair coexists in Hot/Warm after consolidation

*For any* workspace after `applyPlan`, every `ContradictionReport` in the resulting workspace has either `resolution.kind === "unresolvable"` (both protected) or the losing engram is no longer in the Hot or Warm tier.

**Validates: Requirements 3.4, 3.6, 3.7** <!-- REQ-CON-2, REQ-CON-4, REQ-CON-6, INV-5 -->

### Property 6: Hot token budget is respected or infeasibility is reported with protected engrams intact

*For any* workspace and budget configuration, after `planConsolidation` and `applyPlan`, either the sum of `tokens` for all Hot-tier engrams is ≤ `cfg.budgetTokens`, or `budgetStatus === "budget_infeasible"` and every protected engram that was in the Hot tier before consolidation remains in the Hot tier after.

**Validates: Requirements 4.3, 4.4, 4.5** <!-- REQ-CRY-2, REQ-CRY-3, REQ-CRY-4, INV-6 -->

### Property 7: Archive → resurrect is lossless (round-trip)

*For any* engram `e` that is archived via `applyPlan`, calling `resurrect` on the resulting workspace with `e`'s tombstone produces a workspace where the engram's `node` (all fields: `id`, `file`, `headingPath`, `body`, `contentHash`, `tokens`, `globs`, `specLinks`, `pinned`) deep-equals the original `e.node`.

**Validates: Requirements 4.6, 4.11** <!-- REQ-CRY-3, REQ-CRY-7, INV-3 -->

### Property 8: Consolidation is idempotent

*For any* workspace `w`, running `planConsolidation` on the result of `applyPlan(w, planConsolidation(scored(w)))` produces a plan with empty `toArchive`, `toMerge`, and `toDemote` arrays.

**Validates: Requirements 4.7, 4.8** <!-- REQ-CRY-4, INV-4 -->

### Property 9: Same inputs produce byte-identical outputs

*For any* set of inputs to any exported function (`parseDocument`, `score`, `detectContradictions`, `planConsolidation`), calling the function twice with identical inputs produces structurally identical results where all string values are byte-identical and floating-point values are equal within the same JS engine.

**Validates: Requirements 6.4** <!-- NFR-3, INV-4 -->

### Property 10: Every engram is in exactly one tier

*For any* call to `score`, every `ScoredEngram` in the result has a `tier` that is exactly one of `"hot"`, `"warm"`, or `"crypt"`, and the three tier subsets partition the entire output array without overlap or gap.

**Validates: Requirements 2.11** <!-- REQ-DEC-11, INV-2 -->

### Property 11: Contradiction detection is symmetric

*For any* two scored engrams `a` and `b`, calling `detectContradictions([a, b], ...)` and `detectContradictions([b, a], ...)` produce the same set of `ContradictionReport` objects (same `axis`, same `a`/`b` assignment by lex order, same `resolution`).

**Validates: Requirements 3.5** <!-- REQ-CON-3, REQ-CON-5 -->

### Property 12: Parse → serialize round-trip

*For any* markdown document `text` where `parseDocument` returns a `Result` success, calling `serializeDocument` on the resulting `ParsedDoc` produces a string that is byte-for-byte identical to `text`.

**Validates: Requirements 1.7, 1.8, 1.11** <!-- REQ-PAR-5, REQ-PAR-6 -->

---

## Error Handling

All fallible exported functions return `Result<T, LetheError>` — they never throw. The `match` helper in `result.ts` enforces exhaustive handling at call sites.

### Error Code Table

| Code | Source | Trigger |
|---|---|---|
| `PARSE_INVALID_FRONTMATTER` | `parseFrontmatter` | Opening `---` found but no closing `---` |
| `PARSE_DUPLICATE_ID` | `parseDocument` | Two sections produce the same slug id |
| `CONFIG_INVALID` | `validateConfig` | Any field outside its valid range |
| `ONTOLOGY_INVALID_PATTERN` | `validateOntology` | A stance pattern fails `new RegExp(p)` |
| `BUDGET_INFEASIBLE` | `computeBudget` | Protected hot engrams alone exceed budget (returned in plan, not as error) |
| `TOMBSTONE_NOT_FOUND` | `resurrect` | Requested id not in tombstone list |
| `PATH_ESCAPE` | *(MCP layer only)* | Path traversal outside workspace root |
| `PBT_GATE_FAILED` | `runPbtGate` | A property fails before `sleep --apply` |

`BUDGET_INFEASIBLE` surfaces as `budgetStatus: "budget_infeasible"` in `ConsolidationPlan` rather than a `Result` failure, because an infeasible budget is a valid (if unfortunate) plan state — the caller still receives a complete plan with no modifications to protected engrams.

Out-of-contract inputs (invalid config values, negative commit counts, NaN retention, tombstones with `schema !== 1`) are caught by validation functions and returned as `CONFIG_INVALID` or the most specific applicable code. <!-- REQ-DEC-6 -->

---

## Testing Strategy

### Dual-Layer Approach

Every subsystem has both unit tests (example-based) and property tests (fast-check). They are complementary: unit tests verify concrete behavior and edge cases; property tests verify universal invariants across the full input space.

### Unit Tests (`test/*.unit.test.ts`)

Focus areas:
- Parser: malformed frontmatter (PARSE_INVALID_FRONTMATTER), duplicate ids, annotation parsing edge cases (missing keys, extra whitespace), CRLF normalization, empty documents, H3 nesting.
- Decay: boundary values (`deltaC = 0`, `S = sMin`, `W = wSpec`), reinforcement matching (glob, cited id, spec name), multiple events in one ledger.
- Contradiction: each of the 12 default axes with a clear contradicting pair, negation polarity flip, both-protected resolution, sorting order.
- Consolidation: budget_infeasible when only protected engrams fill the Hot tier, Jaccard tokenizer edge cases (empty bodies, identical bodies), greedy deduplication transitivity.
- Crypt: resurrect at index 0, resurrect past end of file (appends under `## Resurrected`), TOMBSTONE_NOT_FOUND.
- Config: each validation rule in `validateConfig`.

### Property Tests (`test/*.pbt.test.ts`)

One `*.pbt.test.ts` per subsystem, each importing property functions from `src/properties/`. Each property is wrapped in a `fc.assert` call with run count controlled by `FC_NUM_RUNS` env var (default 100 locally, 1000 in CI).

```ts
// Example structure (decay.pbt.test.ts)
import { fc } from "@fast-check/vitest";
import { p1Range, p2Monotonic, p3Reinforce } from "../src/properties/index.js";

describe("Decay Engine – P1 Retention Range", () => {
  it.prop(/* arbitraries */)("0 < R ≤ 1 for all valid inputs", p1Range(DEFAULT_CONFIG));
});
```

Tag format for traceability: `// Feature: lethe-core, Property 1: 0 < R ≤ 1 for all valid inputs`

### Adversarial Arbitraries (`src/properties/arbitraries/adversarial.arb.ts`)

Required generators per REQ-PBT-4:
- **Bursty histories**: ≥ 20 `LedgerEvent`s within a `ΔC` window of ≤ 5 commits.
- **Long idle gaps**: `ΔC ≥ 500` commits with no reinforcement.
- **All-spec-linked sets**: every engram in the array has ≥ 1 active `specLink`.
- **Empty sets**: empty `engrams`, `states`, `ledger` arrays.
- **Duplicate-id collisions**: two raw sections that produce the same slug.
- **Unicode bodies**: CJK, RTL Arabic/Hebrew, combining diacritics, zero-width spaces, mixed CRLF/LF endings.

### Browser Portability of Properties

Property functions in `src/properties/` must not import from `vitest` or `node:*`. They accept arbitrary configurations and return `fc.IProperty` objects. The browser sandbox imports them from `@lethe/core/properties` and runs `runPbtGate` (which uses `fc.check`) with `numRuns: 200`. <!-- REQ-PBT-1 -->

### Performance Benchmark

A single vitest benchmark test verifies that `score` processes 500 engrams with a 500-event ledger in < 50 ms (warm, Node 22). This is a deterministic benchmark, not a property test. <!-- NFR-1 -->

### PBT Failure Logging

When running in Node via `lethe-mcp`, `runPbtGate` appends failure details to `.kiro/lethe/pbt-failures.json` (IO layer responsibility — not in core). <!-- REQ-PBT-2, REQ-PBT-4 -->

---

## Constraints and Non-Goals

### Hard Constraints

| Constraint | Enforcement |
|---|---|
| Zero runtime dependencies | `package.json` `dependencies` field must be empty; enforced by CI |
| No IO, no clock, no randomness | Static: no `fs`, `path`, `process`, `Date()` (no-arg), `Math.random()`, `console.*` |
| No `any` type | `@typescript-eslint/no-explicit-any` with `allowExplicitAny: false` |
| `readonly` on all types | TypeScript strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| File ≤ 200 lines, function ≤ 40 lines | Enforced by code review and file split discipline |
| SHA-256 is self-contained | No `globalThis.crypto`, no platform polyfill; pure TS only |
| Browser importable | ES2022 target; no Node built-ins in `src/`; tested against `exports` field |

<!-- INV-7, NFR-4 -->

### Non-Goals

- **No LLM calls**: lethe-core never invokes a language model. <!-- 12-never-do -->
- **No filesystem access**: the engine operates on `VirtualWorkspace` objects. IO is the caller's responsibility.
- **No git access**: commit counters are supplied as explicit `number` parameters.
- **No cross-document deduplication of ids**: each `parseDocument` call is independent. The caller (scoring pass) merges results.
- **No semantic contradiction detection**: the ontology is pattern-based. Contradictions that don't match a known axis go undetected. This is documented as an honest limit.
- **No real-time scoring**: the engine is stateless and batch-oriented. There is no subscription or incremental update API.
- **No CLI or MCP tools**: those live in `lethe-mcp`. This package exports pure functions only.
