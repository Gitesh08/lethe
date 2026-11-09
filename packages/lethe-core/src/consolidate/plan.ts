// Consolidation planner: describes what a "sleep" would archive, merge and demote.
// Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-5, REQ-CRY-6, INV-1, INV-4, INV-6
//
// DRY-RUN GUARANTEE: pure function. No I/O, no clock, no mutation of inputs.
// Nothing is deleted here; the plan only describes.
//
// DEMOTION CAVEAT: demotion (hot -> warm) is derived from the retention score
// and is NOT persisted anywhere by applyPlan (tier is recomputed by score()).
// After applying a plan, a re-score puts demoted engrams back in Hot and a
// re-plan lists the same demotions again. Idempotency (INV-4 / P8) therefore
// holds for archive + merge (they become empty) and the workspace is unchanged,
// while `toDemote` is STABLE (identical) rather than empty. This conflicts with
// requirement 4.7's wording "empty demote array".
import { applyDefeats } from "../contradiction/defeat.js";
import type {
  ConsolidationPlan,
  ContradictionReport,
  LetheConfig,
  ScoredEngram,
} from "../types.js";
import { computeBudget } from "./budget.js";
import { findDuplicates } from "./dedupe.js";

type ArchiveEntry = ConsolidationPlan["toArchive"][number];

function byNodeId(a: ScoredEngram, b: ScoredEngram): number {
  return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
}

/** Lexicographically smallest winner among resolved reports where `id` lost. */
function smallestWinner(id: string, reports: readonly ContradictionReport[]): string | undefined {
  let best: string | undefined;
  for (const r of reports) {
    if (r.resolution.kind !== "resolved" || r.resolution.loser !== id) continue;
    const w = r.resolution.winner;
    if (best === undefined || w < best) best = w;
  }
  return best;
}

function archiveEntry(e: ScoredEngram, reports: readonly ContradictionReport[]): ArchiveEntry {
  if (e.status !== "defeated") return { engram: e, reason: "decayed" };
  const defeatedBy = smallestWinner(e.node.id, reports);
  return defeatedBy === undefined
    ? { engram: e, reason: "contradiction" }
    : { engram: e, reason: "contradiction", defeatedBy };
}

function selectArchive(
  withDefeats: readonly ScoredEngram[],
  reports: readonly ContradictionReport[],
  cfg: LetheConfig,
): readonly ArchiveEntry[] {
  return withDefeats
    .filter((e) => !e.protected && (e.retention < cfg.cryptMax || e.status === "defeated"))
    .slice()
    .sort(byNodeId)
    .map((e) => archiveEntry(e, reports));
}

export function planConsolidation(
  scored: readonly ScoredEngram[],
  reports: readonly ContradictionReport[],
  cfg: LetheConfig,
): ConsolidationPlan {
  const withDefeats = applyDefeats(scored, reports);
  const toArchive = selectArchive(withDefeats, reports, cfg);
  const archived = new Set(toArchive.map((a) => a.engram.node.id));
  const candidates = withDefeats.filter((e) => !archived.has(e.node.id));
  const toMerge = findDuplicates(candidates, cfg).map((p) => ({ keep: p.keep, drop: p.drop }));
  const removed = new Set<string>(archived);
  for (const m of toMerge) removed.add(m.drop.node.id);
  const analysis = computeBudget(withDefeats, removed, cfg);
  return {
    toArchive,
    toMerge,
    toDemote: analysis.demotion,
    budgetStatus: analysis.status,
    tokensBefore: analysis.tokensBefore,
    tokensAfter: analysis.tokensAfter,
  };
}
