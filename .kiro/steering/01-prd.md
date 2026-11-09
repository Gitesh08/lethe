---
inclusion: manual
---
# 01 — Product Requirements Document: Lethe

> Reference in Kiro chat with `#01-prd` when generating specs. Requirement IDs (`REQ-*`) are stable; specs, tests, and commits must cite them.

## 1. Executive Summary

**Lethe** is a biomimetic memory-decay engine for Kiro. It scores every rule in `.kiro/steering/*.md` (and, where available, Kiro Crew lessons) with an Ebbinghaus forgetting curve, detects contradictions between steering rules and active specs, buries dead or defeated rules into a reversible cold store (`.kiro/crypt/`), and proves its own invariants with property-based tests (fast-check, with shrinking).

It ships as one monorepo with three deliverables:

1. `packages/lethe-core` — pure TypeScript engine (parser, decay, contradiction, consolidation, crypt) plus the PBT suite.
2. `packages/lethe-mcp` — an MCP server (4 tools) plus a small `lethe` CLI that Kiro hooks call.
3. `apps/web` — "Obsidian Laboratory": a Bento + spatial-canvas studio with an in-browser Sandbox Mode that runs the *same* core engine, so judges can use it with zero install.

**Hackathon framing:** Kiroween 2026, primary track **Frankenstein** (19th-century cognitive psychology + formal property-based verification + agentic infrastructure), bonus targets: Best Kiro Crew App, Bonus Blog, Social Blitz, Best Demo.

## 2. Problem

Over weeks of work, steering files accumulate rules from old sprints. Some are stale, some duplicate each other, some contradict newer specs (e.g. old rule "use RxJS BehaviorSubject for state" vs. new spec "use signals"). Every prompt pays tokens for all of it, and the agent sees conflicting instructions. We call this **Agent Context Dementia**.

Today, pruning is manual, unprincipled, and unsafe (deleting a rule loses it forever; nothing proves a spec-critical rule survived).

## 3. Solution

Treat every rule as an **engram** with a retention score:

```
R = exp( -Δc / (S · W) )
```

- `Δc` — effective age: commits since last reinforcement + `α` × days since last reinforcement (default `α = 0.25`).
- `S` — stability (in commit-units). Starts at `S0 = 5`. Each reinforcement multiplies it: `S ← min(S · (1 + β), S_MAX)` (`β = 0.5`, `S_MAX = 120`) — spaced-repetition behavior.
- `W` — spec weight. `W = 1` by default; `W = 4` when linked to an active spec. Linked engrams additionally have a hard floor `R ≥ 0.50`.

Tiers:

| Tier | Condition | Meaning |
|---|---|---|
| Hot Cortex | `R ≥ 0.60` | Stays in `.kiro/steering/`, injected every prompt |
| Warm Hippocampus | `0.25 ≤ R < 0.60` | Stays on disk, retrieved on demand via MCP when matching globs are touched |
| Cold Crypt | `R < 0.25` **or** defeated in a contradiction trial | Moved to `.kiro/crypt/tombstones.json`, byte-exact, resurrectable |

All thresholds and constants are configurable via `.kiro/lethe/config.json` but defaults above are canonical for the demo.

## 4. Target Judge & 30-Second Hook

Judge persona: Kiro/AWS engineer or developer-advocate, watching dozens of videos, ≤3 minutes each. They know steering, specs, hooks, PBT.

Hook (first 15 s of video): *"Your Kiro steering files are rotting. Watch."* → drag the time scrubber +60 days → rules visibly fade, a contradiction flashes, press **Exorcise** → fast-check runs live and passes → token meter drops ~75% → click a tombstone → **Resurrect**.

Everything the judge needs is on one viewport, no login, no install.

## 5. Non-Goals

- Not a general vector DB or RAG product.
- No LLM calls inside the engine. Decay, contradiction detection, and consolidation are **deterministic** (same input ⇒ same output). LLMs may *author* code via Kiro; they do not run inside Lethe.
- No cloud backend, no accounts, no telemetry.
- No claim to measure "true" rule usefulness: reinforcement is an explicit, documented heuristic (see REQ-DEC-5).

## 6. Originality Constraint (Hard Rule)

The project must be newly created during the hackathon period. No source code, files, or assets are copied from any prior repository (including `nexyn-core`). Prior *knowledge and ideas* may inform design; code is written fresh inside Kiro. The first commit in this repo is the scaffold commit. Verify the exact submission-period start date in the Official Rules and confirm the repo's first commit is after it.

## 7. Functional Requirements (EARS)

### 7.1 Engram Parser (`REQ-PAR`)
- **REQ-PAR-1** WHEN given a markdown file from `.kiro/steering/` or `.kiro/specs/**`, THE SYSTEM SHALL split it into engrams: one per H2/H3 section by default (granularity `section`), or one per top-level list item (granularity `bullet`).
- **REQ-PAR-2** THE SYSTEM SHALL assign each engram a stable `id` = slug of `relativePath#headingPath`, independent of body content, and a separate `contentHash` (SHA-256 of normalized body).
- **REQ-PAR-3** THE SYSTEM SHALL estimate `tokens` deterministically as `ceil(chars / 4)` (no tokenizer dependency).
- **REQ-PAR-4** WHEN a section contains an annotation comment `<!-- lethe: globs=a,b; spec=name; pin=true -->`, THE SYSTEM SHALL parse it into `globs`, `specLinks`, and `pinned`.
- **REQ-PAR-5** FOR ALL parsed documents, serializing the engrams back SHALL reproduce the original file content byte-for-byte (parse/serialize round trip).
- **REQ-PAR-6** WHEN a steering file has frontmatter, THE SYSTEM SHALL preserve it untouched and never treat it as an engram.

### 7.2 Decay Engine (`REQ-DEC`)
- **REQ-DEC-1** THE SYSTEM SHALL compute `R = exp(-Δc / (S·W))` with `S ≥ S_MIN > 0` and `W ≥ 1`, so `R ∈ (0, 1]`.
- **REQ-DEC-2** FOR ALL engrams with no new reinforcement, increasing `Δc` SHALL NOT increase `R` (monotonic decay).
- **REQ-DEC-3** WHEN an engram is reinforced, THE SYSTEM SHALL update `S ← min(S·(1+β), S_MAX)` and reset `Δc` to 0.
- **REQ-DEC-4** WHEN an engram is linked to an *active* spec, THE SYSTEM SHALL apply `W = 4` and enforce `R ≥ 0.50`.
- **REQ-DEC-5** THE SYSTEM SHALL derive reinforcement only from ledger events (`task_passed`, `spec_cited`, `manual_pin`). A `task_passed` event reinforces engrams whose `globs` match any file in `filesTouched`, or whose id/spec link is cited in the event. This is a proxy heuristic and SHALL be documented as such.
- **REQ-DEC-6** THE SYSTEM SHALL take the clock and commit counter as explicit inputs; no function in `lethe-core` SHALL call `Date.now()`, `Math.random()`, or read the filesystem.
- **REQ-DEC-7** WHEN an engram is `pinned`, THE SYSTEM SHALL treat it as spec-linked for decay and eviction purposes.

### 7.3 Contradiction Detector (`REQ-CON`)
- **REQ-CON-1** THE SYSTEM SHALL maintain a **conflict ontology**: named *stances* (e.g. `state:rxjs-subjects`, `state:signals`, `css:tailwind`, `css:pure-css`) each with trigger patterns, grouped into mutually exclusive *axes*.
- **REQ-CON-2** WHEN two engrams express opposing stances on the same axis (one affirmative, one affirmative-of-the-other or one negated), THE SYSTEM SHALL report a `ContradictionReport` with both ids, the axis, evidence spans, and a deterministic `severity`.
- **REQ-CON-3** Contradiction detection SHALL be symmetric: `detect(a, b)` and `detect(b, a)` report the same pair.
- **REQ-CON-4** WHEN resolving a contradiction, THE SYSTEM SHALL choose the winner by: (1) spec-linked/pinned, (2) higher `R`, (3) newer `lastReinforcedCommit`, (4) lexicographic id. The loser is *defeated*.
- **REQ-CON-5** THE ontology SHALL be user-extensible via `.kiro/lethe/ontology.json`; the shipped default SHALL include at least 12 axes relevant to web/TypeScript projects.
- **REQ-CON-6** WHEN both sides are spec-linked/pinned, THE SYSTEM SHALL NOT defeat either and SHALL flag `unresolvable`.

### 7.4 Consolidation & Crypt (`REQ-CRY`)
- **REQ-CRY-1** WHEN consolidation runs, THE SYSTEM SHALL move every non-pinned, non-spec-linked engram with `R < 0.25` or status `defeated` into the Crypt as a `TombstoneRecord` containing the full original text, metadata, reason, and commit.
- **REQ-CRY-2** THE SYSTEM SHALL keep Hot-tier tokens ≤ budget `K` (default 4000) by demoting lowest-`R` non-protected engrams to Warm before reporting; IF protected engrams alone exceed `K` THEN THE SYSTEM SHALL report `budget_infeasible` and SHALL NOT delete protected engrams.
- **REQ-CRY-3** FOR ALL archived engrams, `resurrect(archive(e))` SHALL be deep-equal to `e` (lossless round trip).
- **REQ-CRY-4** Consolidation SHALL be idempotent: running it twice yields the same state as running it once.
- **REQ-CRY-5** WHEN near-duplicate engrams exist (normalized-token Jaccard ≥ 0.85), THE SYSTEM SHALL merge them into the higher-`R` one and tombstone the other with reason `duplicate`.
- **REQ-CRY-6** THE SYSTEM SHALL default to **dry-run**: no file is written unless `apply: true`. Writes SHALL be atomic (temp file + rename).
- **REQ-CRY-7** WHEN resurrecting, THE SYSTEM SHALL restore the engram to its original file/position when possible, else append under a `## Resurrected` section, and set `S` to `S0` with `Δc = 0`.

### 7.5 MCP Server (`REQ-MCP`)
- **REQ-MCP-1** THE SYSTEM SHALL expose exactly four tools: `lethe_score_memories`, `lethe_detect_contradictions`, `lethe_consolidate_sleep`, `lethe_resurrect_engram`.
- **REQ-MCP-2** Every tool SHALL validate input with zod and return structured JSON plus a short human-readable summary.
- **REQ-MCP-3** `lethe_consolidate_sleep` and `lethe_resurrect_engram` SHALL require `apply: true` to mutate files.
- **REQ-MCP-4** All paths SHALL be resolved inside `workspacePath`; path traversal outside it SHALL be rejected.
- **REQ-MCP-5** Server startup SHALL complete in < 500 ms on a 100-engram workspace (stdio transport).
- **REQ-MCP-6** Errors SHALL be returned as MCP tool errors with a machine-readable `code`; the server SHALL never crash on malformed markdown.

### 7.6 Kiro Integration (`REQ-HOK`)
- **REQ-HOK-1** WHEN a file under `.kiro/steering/` or `.kiro/specs/` is saved, a Kiro hook SHALL run contradiction detection and surface results.
- **REQ-HOK-2** WHEN an agent turn/task completes with passing tests, a hook SHALL append a `task_passed` event to `.kiro/lethe/ledger.jsonl` via `lethe record`.
- **REQ-HOK-3** On a schedule/idle trigger (Kiro Crew heartbeat if available, otherwise a manual-trigger hook), THE SYSTEM SHALL run consolidation in dry-run, then apply only when the PBT gate passes.
- **REQ-HOK-4** THE repository SHALL contain `.kiro/specs/`, `.kiro/steering/`, `.kiro/hooks/` committed and NOT ignored by `.gitignore`.

### 7.7 Web Studio (`REQ-WEB`)
- **REQ-WEB-1** THE SYSTEM SHALL render a single-viewport Bento layout: Spatial Canvas, Telemetry tile, Séance tile, Time-Travel Dock (see `04-design-system`).
- **REQ-WEB-2** THE Spatial Canvas SHALL show engrams as nodes in three concentric zones (Hot/Warm/Crypt) with edges to spec nodes; node glow, opacity, and radial position SHALL derive from `R`.
- **REQ-WEB-3** WHEN the user drags the scrubber, THE SYSTEM SHALL recompute all scores via `lethe-core` and animate nodes to new positions within 16 ms of compute per frame for ≤ 200 engrams.
- **REQ-WEB-4** WHEN the user selects a node, THE SYSTEM SHALL show full markdown, `R`, `S`, `W`, `Δc`, tokens, tier, and linked specs.
- **REQ-WEB-5** WHEN contradictions exist, THE Séance tile SHALL show a side-by-side diff with a **Verify & Exorcise** action that runs the real fast-check properties in-browser (visible progress, seed, run count, pass/fail) and then archives the loser.
- **REQ-WEB-6** THE Dock SHALL include the scrubber (`+0 … +150 commits`), a **Run REM Sleep** button, and a **Reset** button.
- **REQ-WEB-7** THE Telemetry tile SHALL show Hot-tier tokens vs. budget, percent saved, and a retention-curve sparkline, using tabular numerals.
- **REQ-WEB-8** THE Crypt drawer SHALL list tombstones with reason, commit, and a **Resurrect** action.
- **REQ-WEB-9** THE UI SHALL be keyboard operable, respect `prefers-reduced-motion`, and meet WCAG AA contrast for text.

### 7.8 Judge Sandbox Mode (`REQ-SBX`)
- **REQ-SBX-1** THE public URL SHALL load directly into Sandbox Mode with a seeded "haunted repo": ~45 engrams across 6 steering files, 3 active specs, 60 days / ~150 commits of history, ≥ 3 planted contradictions, ≥ 6 stale rules, ≥ 2 duplicate pairs.
- **REQ-SBX-2** THE seed SHALL be generated deterministically from a fixed seed so the demo is reproducible.
- **REQ-SBX-3** THE Sandbox SHALL run `lethe-core` in the browser (no server calls) and SHALL show a "Sandbox" badge making clear no real files are touched.
- **REQ-SBX-4** WHEN the user presses the *guided tour* control, THE SYSTEM SHALL play the 60-second hero sequence (scrub → conflict → exorcise → sleep → resurrect).
- **REQ-SBX-5** OPTIONAL: THE user MAY paste or drop their own steering markdown files to score them locally in the browser (processed client-side only).

### 7.9 Property-Based Testing (`REQ-PBT`)
- **REQ-PBT-1** THE suite SHALL include these properties, each with ≥ 1,000 runs in CI and shrinking enabled: P1 range, P2 monotonic decay, P3 reinforcement monotonicity, P4 spec immunity, P5 contradiction exclusion, P6 budget bound, P7 crypt round trip, P8 consolidation idempotence, P9 determinism, P10 tier partition, P11 contradiction symmetry, P12 parse/serialize round trip.
- **REQ-PBT-2** WHEN a property fails, THE failing seed and shrunk counterexample SHALL be printed and saved to `.kiro/lethe/pbt-failures.json`.
- **REQ-PBT-3** THE Kiro hook gate in REQ-HOK-3 SHALL block `apply` when any property fails.
- **REQ-PBT-4** Generators SHALL include adversarial streams: bursty commits, long idle gaps, all-spec-linked sets, empty sets, duplicate-id collisions, unicode/CRLF content.

## 8. Non-Functional Requirements

- **NFR-1 Performance:** score 500 engrams < 50 ms in Node 22; web scrub recompute < 16 ms for 200 engrams.
- **NFR-2 Safety:** no destructive operation without `apply: true`; every deletion from steering is recoverable from the crypt.
- **NFR-3 Determinism:** identical inputs ⇒ byte-identical outputs.
- **NFR-4 Portability:** `lethe-core` has zero runtime dependencies and runs on Node 22+, Bun, and modern browsers.
- **NFR-5 Footprint:** web first-load JS ≤ 250 kB gzipped excluding fonts.
- **NFR-6 Licensing:** MIT license at repo root, visible in the GitHub About panel.

## 9. MCP Tool Specifications

All tools accept `workspacePath: string` (absolute) and return `{ ok: boolean, summary: string, data: … }`.

### `lethe_score_memories`
- Input: `{ workspacePath, atCommit?: number, now?: string (ISO), includeSpecs?: boolean }`
- Output: `ScoreReport { engrams: ScoredEngram[], tiers: {hot,warm,crypt}: number, hotTokens, budget, budgetStatus }`

### `lethe_detect_contradictions`
- Input: `{ workspacePath, scope?: "steering-vs-specs" | "all" }`
- Output: `ContradictionReport[]` with `winner`, `loser`, `axis`, `evidence`, `resolution`.

### `lethe_consolidate_sleep`
- Input: `{ workspacePath, apply?: boolean (default false), budgetTokens?: number }`
- Output: `SleepConsolidationResult { archived: TombstoneRecord[], merged, demoted, tokensBefore, tokensAfter, pbtGate: "passed"|"failed"|"skipped" }`

### `lethe_resurrect_engram`
- Input: `{ workspacePath, query: string (id | text | file glob), apply?: boolean (default false) }`
- Output: `{ matches: TombstoneRecord[], restored?: EngramNode[] }`

## 10. Success Metrics (Demo-Visible)

- Hot-tier token reduction ≥ 70% on the sandbox dataset (target 4,800 → ≤ 1,300).
- 12/12 properties green, ≥ 1,000 runs each, visible in-UI and in CI.
- 0 protected engrams lost across 10,000 adversarial consolidation runs.
- Time from URL click to first meaningful interaction < 3 s.

## 11. Submission Deliverables Checklist

- [ ] Public GitHub repo, MIT license detected in About.
- [ ] `/.kiro/` committed (specs, steering, hooks), not in `.gitignore`.
- [ ] Live URL (Vercel) loading Sandbox Mode.
- [ ] Demo video < 3 min, public on YouTube, shows the app working.
- [ ] Kiro write-up covering: IDE/CLI/Crew differences, custom agents (if any), hooks, spec-driven vs vibe, steering strategy, MCP, PBT findings, powers (if any).
- [ ] Best Kiro Crew App: public repo URL + feature description.
- [ ] Bonus Blog: public post mentioning Kiroween 2026 hackathon.
- [ ] Social Blitz: post starting with `#KiroweenHackathon26`.
- [ ] Category selected: Frankenstein.
