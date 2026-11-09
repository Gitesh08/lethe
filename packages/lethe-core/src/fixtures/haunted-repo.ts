// Deterministic "haunted repo" fixture for the judge sandbox. Refs: REQ-SBX-1, REQ-SBX-2
//
// DEVIATION FROM THE TASK TEXT (17.2): the task says `generateHauntedRepo(...): VirtualWorkspace`.
// A workspace alone cannot carry the history the sandbox needs (saved states, active specs, the
// task ledger, the clock), so this returns a `HauntedRepo` -- a superset that is structurally a
// `PipelineInput`. The sandbox can call `runConsolidation(repo)` / `scoreWorkspace(repo)` directly.
//
// DETERMINISM: pure. The only variation is a seeded LCG
// (`state = (Math.imul(1664525, state) + 1013904223) >>> 0`); timestamps derive from a fixed epoch.
// Same (seed, cfg) => byte-identical output. No unseeded randomness, no wall clock, no IO.
//
// STRUCTURE (holds for EVERY seed; the seed only varies wording, ordering and state jitter):
//  - 47 engrams over 6 steering files, 3 active specs, a ~59-event ledger (150 commits / 60 days).
//  - 4 planted contradictions: state-management (RxJS vs signals; loser is stale, winner protected),
//    css-approach (Tailwind vs pure CSS), module-system (CommonJS vs ESM), error-handling
//    (exceptions vs Result types). Every winner is protected; losers are unprotected.
//  - 8 stale unprotected engrams (retention << cryptMax), 3 near-duplicate pairs (Jaccard >= 0.85),
//    10 protected engrams (7 reinforced to Hot, 3 held at the 0.50 floor).
//
// DEMO METRIC (PRD section 10, "Hot tokens ~4,800 before sleep -> <= 1,300 after"), defined in
// haunted-metrics.ts as `measureTokens`: fileTokens = tokens of ALL engrams currently in the
// files (what an always-included steering setup injects); hotAfterSleep = hot-tier tokens of the
// survivors after `runConsolidation` (plan.tokensAfter); savedPercent = (fileTokens - hotAfterSleep)
// / fileTokens * 100, one decimal. The Warm tier is kept in the files but is not injected.
import { DEFAULT_CONFIG } from "../config.js";
import type { EngramState, LedgerEvent, LetheConfig, SpecInvariant, VirtualWorkspace } from "../types.js";
import { NOW_COMMIT, advanceISO, isoAtCommit } from "./haunted-clock.js";
import { ARCHITECTURE_ENTRIES, PRODUCT_ENTRIES } from "./haunted-content-product.js";
import { DESIGN_ENTRIES, RULES_ENTRIES } from "./haunted-content-rules.js";
import { MEMORY_ENTRIES, WORKFLOW_ENTRIES } from "./haunted-content-ops.js";
import { entryId } from "./haunted-entry.js";
import type { Entry } from "./haunted-entry.js";
import { STEERING_FILES, buildFiles } from "./haunted-files.js";
import { buildLedger } from "./haunted-ledger.js";
import { createRng } from "./haunted-rng.js";
import { HAUNTED_SPEC_NAMES, hauntedSpecs } from "./haunted-specs.js";
import { buildStates } from "./haunted-states.js";

export interface HauntedRepo {
  readonly workspace: VirtualWorkspace;
  readonly states: readonly EngramState[];
  readonly specs: readonly SpecInvariant[];
  readonly ledger: readonly LedgerEvent[];
  readonly nowCommit: number;
  readonly nowISO: string;
  readonly cfg: LetheConfig;
}

/** The documented default demo seed. */
export const DEMO_SEED = 1;

const ALL_ENTRIES: readonly Entry[] = [
  ...PRODUCT_ENTRIES,
  ...ARCHITECTURE_ENTRIES,
  ...RULES_ENTRIES,
  ...DESIGN_ENTRIES,
  ...WORKFLOW_ENTRIES,
  ...MEMORY_ENTRIES,
];

function idOf(entry: Entry): string {
  return entryId(STEERING_FILES[entry.file - 1]?.path ?? "", entry);
}

/** Ids of the unprotected Hot engrams that the ledger pins explicitly (manual_pin events). */
function pinTargets(): readonly string[] {
  const wanted = new Set(["Sandbox demo script", "Path guard"]);
  return ALL_ENTRIES.filter((e) => wanted.has(e.heading)).map(idOf);
}

export function generateHauntedRepo(seed: number, cfg: LetheConfig = DEFAULT_CONFIG): HauntedRepo {
  const rng = createRng(seed);
  const files = buildFiles(ALL_ENTRIES, rng);
  const states = buildStates(ALL_ENTRIES, idOf, cfg, rng).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ledger = buildLedger(rng, HAUNTED_SPEC_NAMES, pinTargets());
  return {
    workspace: { files, tombstones: [] },
    states,
    specs: hauntedSpecs(),
    ledger,
    nowCommit: NOW_COMMIT,
    nowISO: isoAtCommit(NOW_COMMIT),
    cfg,
  };
}

/**
 * Advance the clock by `commitsAhead` fixture commits (60/150 days each). Everything else is
 * untouched, so the web scrubber (+0..+150) only ever re-scores the same repo at a later time.
 */
export function scrubTo(repo: HauntedRepo, commitsAhead: number): HauntedRepo {
  const ahead = Number.isFinite(commitsAhead) ? Math.max(0, commitsAhead) : 0;
  return { ...repo, nowCommit: repo.nowCommit + ahead, nowISO: advanceISO(repo.nowISO, ahead) };
}
