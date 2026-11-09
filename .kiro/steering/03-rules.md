---
inclusion: always
---
# 03 — Engineering Rules (Always Active)

These rules apply to every Kiro response: Spec mode, Vibe mode, hooks, and Crew. If a request conflicts with a rule here, say so and propose a compliant alternative.

## 0. Prime Directives
1. **Originality:** write all code fresh. Never import or copy code from any other repository (including `nexyn-core`).
2. **Determinism:** `lethe-core` is deterministic. Clock and commit counter are parameters.
3. **Reversibility:** nothing is deleted from steering without a byte-exact tombstone.
4. **Traceability:** every spec task, test, and commit cites `REQ-*` ids from `01-prd`.
5. **Do not invent platform APIs.** If a Kiro/Crew/MCP API is uncertain, check docs or ask; record the verified fact in `06-memory.md`.

## 1. TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`.
- **Zero `any`.** No `as any`, no `@ts-ignore`. `@ts-expect-error` only with a comment explaining why and a linked issue/TODO id.
- Prefer `unknown` + narrowing at boundaries. Parse external data with zod (MCP/web) or hand-written guards (core has zero deps).
- No non-null assertions (`!`) except in tests.
- Types are `readonly` by default. Use `ReadonlyArray`, `readonly` fields; never mutate inputs.
- Use discriminated unions over boolean flags. Exhaustive `switch` with a `never` check.
- ESM only. Named exports; default exports only where Next.js requires them (`page.tsx`, `layout.tsx`).
- Target ES2022. Node 22+. No CommonJS.

## 2. Functional Purity in `lethe-core`
- **Zero runtime dependencies.** Dev dependencies only: `vitest`, `fast-check`, `typescript`.
- No `fs`, `path`, `process`, `Date.now()`, `new Date()` (without argument), `Math.random()`, `console.*`, or global mutable state.
- SHA-256 for `contentHash`: implement a small pure function (or use `globalThis.crypto.subtle` only inside an async boundary in the IO/bridge layer, passing the hash in). Prefer a pure sync implementation inside core so the engine stays sync and testable.
- Functions are total: invalid input returns a typed `Result`/diagnostic, it does not throw. Throwing is reserved for programmer errors (violated type contracts).
- Sorting is always explicit with a total-order comparator. Never rely on engine iteration order for output.
- Floating point: compute `R` with `Math.exp`; compare using documented epsilon (`1e-12`) only in tests, never in production branching, except tier thresholds which use exact `>=`/`<` on the computed value.

## 3. File & Function Size
- **≤ 200 lines per file** (excluding tests and generated fixtures). Split by responsibility.
- **≤ 40 lines per function**, cyclomatic complexity ≤ 10.
- One concept per file; file name = primary export in kebab-case.
- No barrel files except each package's `src/index.ts`.

## 4. Error Handling
- Core returns `Result<T, LetheError>` where `LetheError = { code: ErrorCode; message: string; detail?: unknown }`.
- Error codes (stable, documented): `PARSE_INVALID_FRONTMATTER`, `PARSE_DUPLICATE_ID`, `CONFIG_INVALID`, `ONTOLOGY_INVALID_PATTERN`, `BUDGET_INFEASIBLE`, `TOMBSTONE_NOT_FOUND`, `PATH_ESCAPE`, `PBT_GATE_FAILED`.
- MCP layer maps `LetheError` to MCP tool errors with `code`; never leaks stack traces to the model.
- Never swallow errors silently. A caught error is logged (to stderr in MCP, never stdout — stdout is the protocol channel) or returned.
- **MCP stdout is sacred:** no `console.log` in `lethe-mcp`. Use `console.error` or a logger writing to stderr.

## 5. Mandatory Property-Based Test Invariants
Every change touching `lethe-core` must keep all 12 properties green. Properties live in `packages/lethe-core/src/properties/` (exported so the web app can run them) and are executed by `test/*.pbt.test.ts`.

| ID | Property |
|---|---|
| P1 | `0 < R ≤ 1` for all valid inputs |
| P2 | Without reinforcement, `Δc₁ ≤ Δc₂ ⇒ R(Δc₁) ≥ R(Δc₂)` |
| P3 | Reinforcement never lowers `S` and never lowers `R` at the same instant |
| P4 | Protected (pinned or active-spec-linked) engrams are never archived and always have `R ≥ 0.50` |
| P5 | After consolidation, no contradicting pair coexists in the Hot/Warm sets (unless flagged `unresolvable`) |
| P6 | Hot tokens ≤ `K`, or `budget_infeasible` is reported with protected engrams intact |
| P7 | `resurrect(archive(e))` deep-equals `e` |
| P8 | `consolidate(consolidate(w)) = consolidate(w)` |
| P9 | Same inputs ⇒ byte-identical outputs |
| P10 | Every engram is in exactly one tier |
| P11 | `detect(a,b)` and `detect(b,a)` report the same pair |
| P12 | `serialize(parse(text)) === text` |

Rules for tests:
- ≥ 1,000 runs in CI (`FC_NUM_RUNS=1000`); 100 locally for speed (`FC_NUM_RUNS=100`).
- Always set and print the seed on failure. Never commit `fc.configureGlobal` with a fixed seed.
- Generators live in `test/arbitraries/`; include adversarial cases (REQ-PBT-4).
- A bug found by PBT gets **both**: a shrunk regression example test and a note in `06-memory.md` ("PBT Findings") — these are material for the Kiro write-up.
- Example-based unit tests cover parser edge cases; do not use them to replace properties.

## 6. Next.js 15 / React 19 Rules (`apps/web`)
- App Router only. `app/page.tsx` and `app/layout.tsx` are **Server Components**.
- `"use client"` only at the top of the interactive tree root and files needing hooks, browser APIs, React Flow, or Motion. Never mark pure presentational leaf components client unless they use client-only features.
- No data fetching on the client for the sandbox; fixtures are generated in-process.
- No `useEffect` for derived state — compute in render or selectors. `useEffect` only for subscriptions, measuring, and imperative APIs.
- Use `useSyncExternalStore` (or a tiny store) for shared state; avoid prop drilling beyond two levels.
- Memoize at boundaries that matter (React Flow node components via `memo`; node/edge arrays via `useMemo` keyed on scored data). Do not sprinkle `useMemo` everywhere.
- Accessibility is a requirement, not polish: semantic landmarks, visible focus ring, `aria-live="polite"` for telemetry changes that matter (not per frame), keyboard control of scrubber (arrow keys step 1, shift+arrow step 10), `prefers-reduced-motion` honored.
- Images: none required; use inline SVG. Fonts via the `geist` package with `next/font`-compatible loading; `font-display: swap`.
- No client-side network calls. No analytics.

## 7. Pure CSS Architecture
- **No Tailwind, Bootstrap, or CSS-in-JS.** CSS Modules for component styles + one global `tokens.css` and `globals.css`.
- All colors, spacing, radii, shadows, durations, easings come from CSS custom properties defined in `04-design-system`. **No hard-coded hex values outside `tokens.css`.**
- Naming: component module classes are camelCase (`.nodeHot`); tokens are `--kebab-case` with prefixes (`--c-`, `--sp-`, `--r-`, `--t-`, `--e-`, `--sh-`).
- Layout with CSS Grid (named areas) and Flexbox; no absolute positioning for layout (only for canvas overlays).
- Use modern CSS where supported: `color-mix()`, `@layer`, container queries, `:has()`, `text-wrap: balance`. Provide sane fallbacks only where cheap.
- Animate `transform` and `opacity` only; never animate `width/height/top/left`. `will-change` only on elements actively animating.
- `@layer reset, tokens, base, components, utilities;` order.
- Max specificity: single class. No `!important` (except the reduced-motion reset).

## 8. MCP Server Rules (`lethe-mcp`)
- Built on `@modelcontextprotocol/sdk` with stdio transport. Tool inputs validated with `zod`; schemas exported for tests.
- Exactly four tools (REQ-MCP-1). Do not add tools without updating the PRD.
- Mutating tools default to dry-run; `apply: true` required.
- All file writes atomic (write temp in same dir, `fsync`, rename).
- Every path passes through `guardPath(workspace, rel)`; reject escapes and symlink traversal.
- Tool descriptions are written *for the model*: state when to call it, what it returns, and that it is safe (dry-run) by default.

## 9. Git, Commits, Branching
- Conventional Commits: `feat(core): …`, `test(core): …`, `docs(vault): …`. Footer `Refs: REQ-DEC-1, REQ-DEC-2`.
- Small commits aligned to spec tasks (one task ⇒ one commit when possible). The commit counter drives `Δc` in dogfooding, so avoid noisy micro-commits.
- Never add `.kiro/` or any subfolder to `.gitignore`. Never commit secrets or `.env`.
- `main` stays green: `bun run typecheck && bun run test && bun run lint` before merge.

## 10. Kiro Workflow Rules
- **Spec mode** for: `lethe-core`, `lethe-mcp`, sandbox fixtures. Specs use EARS from `01-prd`; `tasks.md` must include PBT tasks as first-class items, not afterthoughts.
- **Vibe mode** for: web UI composition and animation, guided by `04-design-system`. After each vibe session, summarize decisions in `06-memory.md`.
- Hooks stay small, idempotent, and fast (< 2 s). A hook must never modify source code silently; it may write only to `.kiro/lethe/` or append to `06-memory.md`.
- Dogfooding: Lethe scores its own steering. Annotate protected rules with `<!-- lethe: pin=true -->`.
- Keep a running log of Kiro usage insights (what worked, what didn't) in `docs/kiro-writeup.md` as the build proceeds, not at the end.

## 11. Quality Gates (Definition of Done)
A task is done only when:
1. Typecheck, lint, tests pass; relevant PBTs run ≥ 1,000 cases.
2. Linked `REQ-*` ids are covered by at least one test.
3. No file > 200 lines, no `any`.
4. UI work: keyboard + reduced-motion verified, contrast checked, screenshot at 1440×900 and 390×844 captured in `docs/shots/`.
5. `06-memory.md` changelog updated.

## 12. Things To Never Do
- Never call an LLM from inside Lethe.
- Never present heuristic reinforcement as ground truth in UI copy; label it "estimated utility".
- Never claim a Kiro/Crew feature works a certain way in docs or the write-up without having verified it.
- Never hide a failing property by lowering runs, fixing seeds, or loosening generators.
