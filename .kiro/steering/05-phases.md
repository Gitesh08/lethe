---
inclusion: manual
---
# 05 — Phases: Step-by-Step Build Roadmap

Date at planning: **2026-11-03**. Deadline per planning notes: **2026-12-04** — *confirm the exact date/time and timezone on the Devpost page before relying on it.* Plan assumes ~30 days; each phase has an exit gate. Legend: 🧬 = Kiro **Spec mode**, 🎛️ = Kiro **Vibe mode** (steered), 🔧 = manual/terminal, 🧪 = verification.

## Phase 0 — Ground Truth & Setup (Day 1–2)

Goal: remove assumptions about Kiro before building on them.

1. 🔧 Install Kiro IDE; sign in; import editor settings.
2. 🔧 Confirm Kiro CLI and Kiro Crew state (`kiro-cli whoami`, `kirocrew doctor`). Crew is already installed in WSL; keep `kirocrew gateway` in its own tab when needed.
3. 🔧 Decide working location: **move the repo into native WSL FS** (`~/lethe`) for fast installs/watchers; open via Kiro's WSL integration. If staying on `/mnt/d/...`, expect slow `bun install` and file watching.
4. 🧪 **Platform verification checklist** (record answers in `06-memory.md` → Verified Platform Facts):
   - IDE hook file format and available event types
   - How hook output returns to the agent
   - MCP config location/schema in Kiro IDE
   - Crew: hook events, heartbeat/cron config, Lessons storage, App manifest + registration
   - Credit/limits available; hackathon promo credits
5. 🔧 Read Official Rules: submission-period start date (originality), license requirements, video rules, bonus requirements. Paste key dates into `06-memory.md`.
6. 🔧 Remove stale files created earlier from the Angular-based plan: `.kiro/steering/product.md`, `tech.md`, `structure.md` (superseded by `01–06`). Keep their text in git history only.

**Exit gate:** verified-facts table filled; rules dates recorded; repo location decided.

## Phase 1 — Context Vault & Monorepo Foundation (Day 2–4)

1. 🔧 Create/clean repo `lethe`; add `LICENSE` (MIT), `README.md` stub, `.gitignore` (**must not** ignore `.kiro/`).
2. 🔧 Place `01…06` into `.kiro/steering/` (first commit: `docs(vault): add context vault`).
3. 🔧 Scaffold with Bun + Turborepo:
   ```bash
   bun init -y
   # root package.json: { "workspaces": ["apps/*","packages/*"], "private": true }
   mkdir -p packages/lethe-core/src packages/lethe-core/test packages/lethe-mcp/src apps
   cd apps && bunx create-next-app@latest web --ts --app --eslint --no-tailwind --src-dir=false --import-alias "@/*" && cd ..
   bun add -d turbo typescript vitest fast-check @types/node
   ```
4. 🔧 Configure `tsconfig.base.json` with strict flags from `03-rules`; per-package `tsconfig.json`; `turbo.json` pipeline (`build`, `typecheck`, `test`, `lint`).
5. 🔧 Add ESLint rule banning `any` (`@typescript-eslint/no-explicit-any: error`) and a custom check script for ≤200 LOC/file.
6. 🧪 `bun run typecheck && bun run test` pass on empty skeleton; CI workflow on GitHub Actions (typecheck, lint, test with `FC_NUM_RUNS=1000`).
7. 🔧 Create Vercel project; deploy the empty Next.js shell to confirm the pipeline early.

**Exit gate:** green CI, deployed placeholder URL, vault committed, `.kiro` not ignored.

## Phase 2 — `lethe-core` + PBT (Day 4–11) 🧬

Spec: `.kiro/specs/lethe-core/` generated from `#01-prd` §7.1–7.4, 7.9.

Suggested spec prompt (Spec mode):
> Create a spec for `packages/lethe-core` implementing REQ-PAR-*, REQ-DEC-*, REQ-CON-*, REQ-CRY-*, REQ-PBT-* from #01-prd, honoring #03-rules and the types in #02-architecture §4. Tasks must include a property-based test task for each of P1–P12 and the seeded fixture generator.

Task order (each ⇒ commit):
1. Types, config, `Result` helper.
2. Parser + serializer + hashing (P12).
3. Decay: retention, reinforcement, tiers (P1, P2, P3, P10).
4. Spec-link/pin protection (P4).
5. Ontology + detector + resolver (P5, P11).
6. Consolidation planner: archive, dedupe, budget (P6, P8).
7. Crypt archive/resurrect on `VirtualWorkspace` (P7).
8. Determinism harness (P9).
9. Seeded "haunted repo" fixture generator (REQ-SBX-1/2).
10. Property exports for browser use.

Process notes:
- Review `requirements.md` → `design.md` → `tasks.md` gates deliberately; edit them. Keep an honest log of what Kiro got wrong (write-up material).
- When PBT finds a bug, save shrunk counterexample in `06-memory.md` → PBT Findings.
- 🧪 Run mutation-style sanity: temporarily break an invariant (e.g., remove floor) and confirm a property fails. Screenshot for the write-up.

**Exit gate:** 12/12 properties green at 1,000 runs; coverage of all `REQ-PAR/DEC/CON/CRY/PBT` ids; fixture generator deterministic.

## Phase 3 — `lethe-mcp`, CLI, Hooks, Crew (Day 11–17) 🧬 + 🔧

Spec: `.kiro/specs/lethe-mcp/` from `#01-prd` §7.5–7.6, §9.

1. 🧬 IO layer: fs adapter, git commit counter, atomic write, path guard.
2. 🧬 Four MCP tools with zod schemas; in-memory-transport contract tests.
3. 🧬 `lethe` CLI (`check`, `record`, `score`, `sleep`, `resurrect`).
4. 🔧 Register MCP server in Kiro (workspace MCP config per verified schema); call each tool from Kiro chat and screenshot.
5. 🔧 Author IDE hooks (`.kiro/hooks/`): check-on-save, record-on-task, sleep-manual, memory-ledger.
6. 🧪 PBT gate wired into `lethe sleep --apply`; failing property blocks apply.
7. 🔧 **Crew App** (bonus): per verified Crew docs, implement
   - heartbeat/cron job → `lethe sleep` (dry-run → gate → apply)
   - Lessons adapter → engrams (if storage format allows)
   - Crew hooks → `record`/inject
   - App manifest/registration; publish public repo URL for the bonus
   If Crew specifics differ from assumptions, ship the subset that works and describe it accurately.
8. 🔧 Dogfood start: run Lethe on its own `.kiro/steering` weekly; commit results.

**Exit gate:** Kiro agent can call all 4 tools; hooks fire on real events; dry-run default verified; Crew App demonstrably running (or documented reduced scope).

## Phase 4 — Web Studio & Sandbox (Day 17–25) 🎛️

Steering: `#04-design-system` (auto via fileMatch on `apps/web/**`). Spec only for sandbox data flow (`.kiro/specs/lethe-web-sandbox/`), vibe for composition.

Order:
1. Tokens + globals + fonts + app shell (grid areas, tiles).
2. Engine bridge + store + seeded workspace load (REQ-SBX-1..3).
3. Telemetry tile (live from scored data).
4. Canvas: custom nodes, radial layout, zone rings, spec nodes, edges.
5. Dock: scrubber + keyboard + Reset; wire recompute.
6. Séance: contradiction list, diff, in-browser fast-check run, exorcise animation.
7. REM Sleep sequence + Crypt drawer + Resurrect.
8. Guided tour (60 s script; captions; skip button) (REQ-SBX-4).
9. Optional: drop-your-own-steering mode (REQ-SBX-5).
10. Polish: reduced motion, focus, contrast script, mobile layout, perf pass (React Profiler, node memoization).
11. 🧪 Playwright smoke: load → scrub → exorcise → sleep → resurrect.

Vibe-mode discipline: one component per prompt, reference tokens by name, forbid new hex values, screenshot diffs after each. Log prompts that worked in `docs/kiro-writeup.md`.

**Exit gate:** hero sequence reproducible in < 60 s; Lighthouse a11y ≥ 95; no console errors; first load < 3 s on throttled 4G.

## Phase 5 — Dogfood, Demo, Write-up, Submission (Day 25–31)

1. Run Lethe on Lethe: capture before/after of the project's own steering with real numbers.
2. README: problem, formula, tier table, quick start (MCP + hooks), sandbox link, honest limitations (heuristic reinforcement, ontology-bounded detection).
3. **Demo video (< 3:00, public on YouTube, no copyrighted music).** Script:
   - 0:00–0:15 hook: rotting steering, scrub +60 days
   - 0:15–0:50 contradiction → Exorcise → live PBT passes → tokens −75%
   - 0:50–1:20 REM Sleep merges/buries; resurrect a tombstone
   - 1:20–2:05 real Kiro: MCP tools called by agent, hooks firing, ledger/state files
   - 2:05–2:40 PBT shrinking story: bug found, counterexample, fix
   - 2:40–3:00 Crew heartbeat + dogfooding numbers + URL
4. **Kiro write-up** (`docs/kiro-writeup.md` → Devpost): IDE vs CLI vs Crew experience; custom agents (if used); each hook and what it automated; spec structure and spec-vs-vibe comparison; steering strategy (fileMatch/manual/always and the token cost of the vault itself); MCP rationale; **PBT findings with real shrunk counterexamples**; powers (if used).
5. Bonus Blog: publish on Medium, mention Kiroween 2026; add URL.
6. Social Blitz: post starting with `#KiroweenHackathon26` (favorite thing about Kiro + how it changed your workflow); add URL.
7. Best Kiro Crew App: repo URL + description.
8. Final checks: license visible in About; `.kiro/` committed; `.gitignore` clean; fresh-clone test (`git clone` → install → test → dev) works; Vercel URL loads Sandbox without login.
9. Submit **at least 24 h before the deadline**; re-open the submission afterward and verify every link.

## Calendar (Target Dates)

| Dates (2026) | Phase |
|---|---|
| Nov 3–5 | 0 and 1 |
| Nov 6–13 | 2 |
| Nov 14–19 | 3 |
| Nov 20–27 | 4 |
| Nov 28–Dec 2 | 5 (video, write-up, bonuses) |
| Dec 3 | Buffer / submit |
| Dec 4 | Deadline (verify) |

## Risk Register

| Risk | Mitigation |
|---|---|
| Kiro/Crew behavior differs from assumptions | Phase 0 verification; degrade to IDE hooks + CLI |
| Credits run out | Spec mode for core only; vibe prompts batched and scoped; use other editor for non-Kiro tasks, but all specs/steering/hooks authored in Kiro |
| Contradiction detection viewed as "just regex" | Be explicit: deterministic ontology, extensible; show PBT proving exclusion; do not oversell semantics |
| Reinforcement attribution is heuristic | Label as estimated; document; ledger events are auditable |
| Over-scope on UI | Hero sequence first, polish later; cut REQ-SBX-5 first |
| Demo video too dense | Rehearse; record in segments; hard cap 2:50 |
| Originality challenge | First commit date after period start; no copied code; documented in README |
| WSL FS slowness | Work in native Linux FS |
