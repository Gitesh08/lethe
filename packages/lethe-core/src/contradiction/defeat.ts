/**
 * Realises REQ-CON-3.6 ("loser status = defeated"): detectContradictions returns
 * only reports (02-architecture signature), so callers apply defeats here.
 * Pure: returns new objects for defeated engrams, never mutates inputs.
 */
import type { ContradictionReport, ScoredEngram } from "../types.js";
import { SPEC_ID_PREFIX } from "./spec-side.js";

export function applyDefeats(
  scored: readonly ScoredEngram[],
  reports: readonly ContradictionReport[],
): readonly ScoredEngram[] {
  const losers = new Set<string>();
  for (const r of reports) {
    if (r.resolution.kind !== "resolved") continue;
    if (r.resolution.loser.startsWith(SPEC_ID_PREFIX)) continue;
    losers.add(r.resolution.loser);
  }
  return scored.map((e) =>
    losers.has(e.node.id) && !e.protected ? { ...e, status: "defeated" as const } : e,
  );
}
