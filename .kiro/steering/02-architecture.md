---
inclusion: fileMatch
fileMatchPattern: "{packages/**/*,apps/**/*,.kiro/hooks/**/*,.kiro/specs/**/*}"
---
# 02 — System & Monorepo Architecture

## 1. Guiding Principles

1. **One engine, three surfaces.** `lethe-core` is pure and shared by the MCP server, the CLI, and the browser sandbox.
2. **Functional core, imperative shell.** All IO lives in `lethe-mcp` (Node) or in the web app. Core receives data, returns data.
3. **Deterministic.** Clock and commit counter are inputs. No randomness except seeded generators in tests/fixtures.
4. **Reversible.** Nothing leaves steering without a byte-exact tombstone.
5. **Verifiable.** Every safety claim maps to a named fast-check property.

## 2. Monorepo Layout

```
lethe/
├─ .kiro/
│  ├─ steering/            # 01..06 vault files (+ Lethe manages these: dogfooding)
│  ├─ specs/
│  │  ├─ lethe-core/       # requirements.md design.md tasks.md
│  │  ├─ lethe-mcp/
│  │  └─ lethe-web-sandbox/
│  ├─ hooks/               # *.kiro.hook (IDE hooks)
│  ├─ crypt/
│  │  └─ tombstones.json   # cold store
│  └─ lethe/
│     ├─ config.json       # thresholds, budget K, alpha, beta
│     ├─ ontology.json     # optional user extensions to conflict axes
│     ├─ state.json        # per-engram S, lastReinforcedCommit
│     ├─ ledger.jsonl      # append-only reinforcement events
│     └─ pbt-failures.json
├─ packages/
│  ├─ lethe-core/
│  │  ├─ src/
│  │  │  ├─ types.ts
│  │  │  ├─ config.ts            # defaults + validation
│  │  │  ├─ parse/               # markdown → engrams, serialize
│  │  │  ├─ decay/               # retention, reinforcement, tiers
│  │  │  ├─ contradiction/       # ontology.ts, detect.ts, resolve.ts
│  │  │  ├─ consolidate/         # plan.ts, budget.ts, dedupe.ts
│  │  │  ├─ crypt/               # archive.ts, resurrect.ts
│  │  │  ├─ fixtures/            # seeded haunted-repo generator
│  │  │  └─ index.ts
│  │  └─ test/                   # unit + *.pbt.test.ts
│  └─ lethe-mcp/
│     ├─ src/
│     │  ├─ server.ts            # MCP stdio server
│     │  ├─ tools/               # one file per tool
│     │  ├─ io/                  # fs, git, atomic write, path guard
│     │  ├─ cli.ts               # `lethe record|score|check|sleep`
│     │  └─ index.ts
│     └─ test/
├─ apps/
│  └─ web/                       # Next.js 15 studio
│     ├─ app/
│     ├─ components/
│     ├─ lib/                    # store, engine bridge, tour script
│     └─ styles/                 # tokens.css, globals.css, *.module.css
├─ crew-app/                     # Kiro Crew App wrapper (if separate repo needed, mirror here)
├─ docs/                         # write-up drafts, blog draft, demo script
├─ turbo.json
├─ package.json                  # bun workspaces
├─ LICENSE                       # MIT
└─ README.md
```

## 3. Data Flow

```mermaid
flowchart LR
  subgraph Workspace[".kiro/ on disk"]
    ST[steering/*.md]
    SP[specs/**/*.md]
    CR[crypt/tombstones.json]
    LG[lethe/ledger.jsonl]
    SS[lethe/state.json]
  end

  subgraph MCP["lethe-mcp (Node 22)"]
    IO[io: fs + git + path guard]
    T[4 MCP tools]
    CLI[lethe CLI]
  end

  CORE[[lethe-core (pure TS)]]

  subgraph Web["apps/web"]
    BR[engine bridge]
    UI[Bento + Spatial Canvas]
    FX[seeded haunted repo]
  end

  H[Kiro hooks / Crew heartbeat] --> CLI
  AG[Kiro agent via MCP] --> T
  ST & SP & CR & LG & SS --> IO --> CORE
  T --> IO
  CLI --> IO
  CORE --> IO --> Workspace
  FX --> BR --> CORE
  CORE --> BR --> UI
```

### Pipeline (one scoring pass)

```
files ─▶ parse ─▶ EngramNode[] ─▶ join(state, ledger) ─▶ decay(R,tier)
      ─▶ detect(contradictions) ─▶ resolve(winner/loser)
      ─▶ plan(consolidation: archive, merge, demote, budget)
      ─▶ [dry-run report] ─▶ (apply) ─▶ atomic writes + tombstones
```

## 4. Core Types (authoritative)

```ts
// packages/lethe-core/src/types.ts
export type Tier = "hot" | "warm" | "crypt";
export type EngramStatus = "active" | "defeated" | "duplicate";

export interface EngramNode {
  readonly id: string;                 // slug(relativePath#headingPath)
  readonly file: string;               // workspace-relative
  readonly headingPath: readonly string[];
  readonly body: string;               // exact original text of the section
  readonly contentHash: string;        // sha256 of normalized body
  readonly tokens: number;             // ceil(chars/4)
  readonly globs: readonly string[];
  readonly specLinks: readonly string[];
  readonly pinned: boolean;
  readonly span: { readonly start: number; readonly end: number }; // char offsets in file
}

export interface EngramState {
  readonly id: string;
  readonly stability: number;                 // S
  readonly lastReinforcedCommit: number;
  readonly lastReinforcedAt: string;          // ISO
  readonly reinforcements: number;
}

export interface SpecInvariant {
  readonly specName: string;                  // e.g. "lethe-core"
  readonly active: boolean;
  readonly requirementIds: readonly string[]; // REQ-*
  readonly stances: readonly string[];        // stances the spec asserts
}

export interface ScoredEngram {
  readonly node: EngramNode;
  readonly state: EngramState;
  readonly deltaC: number;
  readonly weight: number;                    // W
  readonly retention: number;                 // R after floor
  readonly rawRetention: number;              // R before floor
  readonly tier: Tier;
  readonly status: EngramStatus;
  readonly protected: boolean;                // pinned || spec-linked(active)
}

export interface ContradictionReport {
  readonly axis: string;                      // e.g. "state-management"
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
  readonly body: string;                      // byte-exact
  readonly contentHash: string;
  readonly tokens: number;
  readonly meta: { globs: readonly string[]; specLinks: readonly string[]; pinned: boolean };
  readonly state: EngramState;
  readonly reason: "decayed" | "contradiction" | "duplicate";
  readonly retentionAtDeath: number;
  readonly buriedAtCommit: number;
  readonly buriedAt: string;                  // ISO
  readonly defeatedBy?: string;               // id
  readonly position: { readonly index: number; readonly neighborBefore?: string };
}

export interface SleepConsolidationResult {
  readonly archived: readonly TombstoneRecord[];
  readonly merged: ReadonlyArray<{ keep: string; drop: string }>;
  readonly demoted: readonly string[];        // hot → warm for budget
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly budget: number;
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly pbtGate: "passed" | "failed" | "skipped";
  readonly applied: boolean;
}

export interface LetheConfig {
  readonly s0: number;            // 5
  readonly sMax: number;          // 120
  readonly sMin: number;          // 0.5
  readonly beta: number;          // 0.5
  readonly alpha: number;         // 0.25 (day → commit-equivalent)
  readonly wDefault: number;      // 1
  readonly wSpec: number;         // 4
  readonly specFloor: number;     // 0.50
  readonly hotMin: number;        // 0.60
  readonly cryptMax: number;      // 0.25
  readonly budgetTokens: number;  // 4000
  readonly dedupeJaccard: number; // 0.85
  readonly granularity: "section" | "bullet";
}

export interface LedgerEvent {
  readonly type: "task_passed" | "spec_cited" | "manual_pin";
  readonly at: string;            // ISO
  readonly commit: number;        // commit counter at event time
  readonly filesTouched?: readonly string[];
  readonly cited?: readonly string[]; // engram ids or spec names
}
```

## 5. Core Function Surface (pure)

```ts
parseDocument(file: string, text: string, cfg: LetheConfig): ParsedDoc
serializeDocument(doc: ParsedDoc): string                    // inverse of parse

score(input: { engrams: EngramNode[]; states: EngramState[]; specs: SpecInvariant[];
               ledger: LedgerEvent[]; nowCommit: number; nowISO: string; cfg: LetheConfig }): ScoredEngram[]

reinforce(state: EngramState, ev: LedgerEvent, cfg: LetheConfig): EngramState

detectContradictions(scored: ScoredEngram[], specs: SpecInvariant[], ontology: Ontology): ContradictionReport[]

planConsolidation(scored: ScoredEngram[], reports: ContradictionReport[], cfg: LetheConfig): ConsolidationPlan

applyPlan(workspace: VirtualWorkspace, plan: ConsolidationPlan): { workspace: VirtualWorkspace; tombstones: TombstoneRecord[] }

resurrect(workspace: VirtualWorkspace, tomb: TombstoneRecord, nowCommit: number, nowISO: string): VirtualWorkspace
```

`VirtualWorkspace` is an in-memory `Map<path, string>` plus the tombstone list. The Node IO layer loads disk into it; the browser sandbox uses the fixture generator. This is what makes one engine serve all surfaces.

## 6. Conflict Ontology (Contradiction Detection, Deterministic)

```ts
interface Stance { id: string; label: string; patterns: RegExp[]; negationAware: boolean }
interface Axis { id: string; description: string; stances: Stance[] }   // stances are mutually exclusive
```

Algorithm:
1. For each engram, scan sentences. A sentence yields `(stance, polarity)` where polarity is `+` (directive affirms), `-` (negated: "do not", "never", "avoid", "no", "instead of"). Negation lookbehind window: 4 tokens.
2. Per axis, two engrams conflict when: (`+A` vs `+B`, A≠B) or (`+A` vs `-A`).
3. Spec stances (`SpecInvariant.stances`) are extracted the same way from active spec requirement text.
4. Resolution per REQ-CON-4. Output sorted by `(axis, a.id, b.id)` for determinism.

Default axes (≥ 12): state-management, css-approach, framework (react/angular/vue), package-manager, test-runner, module-system (ESM/CJS), error-handling (throw/result), typing-strictness, component-model (server/client), data-fetching, naming-convention, file-size-policy.

Honest limits: this is pattern-based, not semantic understanding. The ontology is the extension point; unmatched contradictions are not detected. Documented in README.

## 7. Persistence Formats

### `.kiro/lethe/state.json`
```json
{ "version": 1, "commit": 148, "engrams": { "<id>": { "stability": 12.4, "lastReinforcedCommit": 131, "lastReinforcedAt": "2026-11-20T10:00:00Z", "reinforcements": 3 } } }
```

### `.kiro/lethe/ledger.jsonl` (append-only, one JSON per line)
```json
{"type":"task_passed","at":"2026-11-20T10:00:00Z","commit":131,"filesTouched":["apps/web/components/Canvas.tsx"]}
```

### `.kiro/crypt/tombstones.json`
```json
{ "version": 1, "tombstones": [ /* TombstoneRecord[] sorted by buriedAtCommit, id */ ] }
```

All JSON is written with stable key order and 2-space indent so diffs are clean and output is byte-deterministic.

## 8. Kiro Integration Architecture

> **Verify before building.** Event names below come from planning notes and Kiro docs as understood at design time. Phase 0 requires confirming each against current Kiro docs (IDE hooks, CLI/Crew hooks). Where the platform differs, adapt the trigger but keep the CLI contract below stable.

### 8.1 CLI contract (what every hook calls)

```
lethe check   --workspace .                 # detect contradictions, exit 0/1, print summary
lethe record  --workspace . --type task_passed --files "a.ts,b.ts"
lethe score   --workspace . --json
lethe sleep   --workspace . [--apply]        # runs PBT gate before apply
lethe resurrect --workspace . --query "<id|text>" [--apply]
```

### 8.2 IDE hooks (`.kiro/hooks/`)

| Hook | Trigger | Action |
|---|---|---|
| `lethe-check-on-save` | File saved matching `.kiro/steering/**/*.md`, `.kiro/specs/**/*.md` | `lethe check` → agent surfaces contradictions |
| `lethe-record-on-task` | Agent turn / spec task completed | `lethe record --type task_passed --files $(git diff --name-only)` |
| `lethe-sleep-manual` | Manual trigger | `lethe sleep` (dry-run), then prompt to apply |
| `lethe-memory-ledger` | Spec task completed | Agent appends entry to `06-memory.md` changelog |

### 8.3 Kiro Crew mapping (Best Kiro Crew App)

| Crew capability (to verify) | Lethe use |
|---|---|
| Heartbeat / cron | Nightly "REM sleep": `lethe sleep` dry-run → PBT gate → apply |
| Lessons / memory store | Ingest lessons as engrams (adapter `crew-lessons` → `EngramNode[]`), same scoring |
| Hooks (spawn / prompt submit / pre-tool / stop) | `UserPromptSubmit`: inject Hot-tier summary; `Stop`: `lethe record`; `PreToolUse`: warn on edits that violate protected rules |
| Signed event log | Log every archive/resurrect event |
| Crew App UI | Embed/point to the web studio; expose the 4 tools |

If a Crew capability is not as assumed, degrade gracefully: the IDE-hook path alone satisfies all functional requirements; Crew adds the heartbeat + lessons adapter.

## 9. Web Architecture (`apps/web`)

- **Next.js 15 App Router.** One route `/` (Sandbox). `page.tsx` is a Server Component shell; the Studio is a single Client Component tree (`"use client"` at `StudioRoot`), because it is interactive and runs the engine in the browser.
- **Engine bridge (`lib/engine.ts`):** wraps `lethe-core`; heavy recompute on scrub runs on the main thread for ≤ 200 engrams; fall back to a Web Worker (`lib/engine.worker.ts`) behind a flag if profiling shows > 8 ms.
- **State:** a small store (`lib/store.ts`, `useSyncExternalStore`) holding `{ workspace, commit, scored, reports, tombstones, selection, tourStep }`. Derived data via selectors; no duplicated state.
- **Canvas:** `@xyflow/react` with custom node types `EngramNode`, `SpecNode`, `ZoneLabel`. Radial positions are computed from `R` (pure function `layoutRadial(scored)`), not stored.
- **PBT in browser:** the "Verify & Exorcise" action imports the same property definitions from `lethe-core/properties` and runs `fc.assert` with a small run count (default 200, visible progress) against the *current* workspace; the CI suite runs 1,000+.
- **Deployment:** Vercel; `lethe-core` consumed as a workspace package via `transpilePackages`.

## 10. Browser vs. Local Execution Bridge

| Concern | Browser Sandbox | Local (MCP/CLI) |
|---|---|---|
| Source of files | Seeded `VirtualWorkspace` or user-dropped files | Real disk via `io/` |
| Writes | In-memory only | Atomic writes, only with `apply` |
| Git/commit counter | Simulated by scrubber | `git rev-list --count HEAD` (plus ledger) |
| PBT | Reduced runs, interactive | Full runs, CI + hook gate |
| Trust boundary | Nothing leaves the browser | Path guard confines to `workspacePath` |

The only code difference is the `io/` layer; `lethe-core` imports nothing platform-specific.

## 11. Security & Safety

- MCP path guard: `path.resolve(workspace, rel)` must start with `workspace + sep`; reject symlinks escaping the root.
- Never execute content from markdown. Never `eval`. Regexes in ontology are validated and run with input-length caps to avoid ReDoS.
- Dry-run default; `apply` creates a pre-image copy of changed files in `.kiro/lethe/backup/<commit>/` (keep it small and commit-friendly; never add `.kiro/**` to `.gitignore`).
- Web sandbox processes dropped files client-side only; no network calls.

## 12. Testing Strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | vitest | parser edge cases, config validation, path guard |
| Property | vitest + fast-check | 12 properties, ≥1,000 runs CI, shrinking on |
| Contract | vitest | MCP tool schemas via in-memory transport |
| E2E smoke | Playwright (optional) | sandbox loads, scrub changes tokens, exorcise passes |
| Visual | manual + screenshots | design-system checklist |

## 13. Platform Assumptions To Verify (Phase 0)

1. Kiro IDE hook event names and the `.kiro.hook` file format.
2. How a Kiro agent surfaces hook command output back to the model.
3. Kiro Crew: installation state, hook events, heartbeat/cron config, Lessons storage format, and App manifest/registration process.
4. Whether MCP servers are configured in `.kiro/settings/mcp.json` (workspace) and the exact schema.
5. Kiro credit budget available for the build (hackathon credits).

Record outcomes in `06-memory.md` under "Verified Platform Facts".
