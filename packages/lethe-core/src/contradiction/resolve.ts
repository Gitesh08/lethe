// Contradiction resolution: pick a winner/loser and a severity for one conflicting pair.
// Refs: REQ-CON-3, REQ-CON-4, REQ-CON-6, P11

import type { ContradictionReport, ScoredEngram } from "../types.js";

/**
 * Retentions closer than this are treated as equal (REQ-CON-4 permits a tolerance
 * for this comparison only). Note: an epsilon tie rule is not transitive
 * (0, 0.8e-12, 1.6e-12), so it must only be applied to one pair at a time; the
 * comparison itself is symmetric in its two operands, which is all P11 needs.
 */
export const RETENTION_TIE_EPSILON = 1e-12;

type Side = { readonly e: ScoredEngram; readonly stance: string; readonly evidence: string };
type Resolution = ContradictionReport["resolution"];

function lt(x: string, y: string): boolean {
  return x < y;
}

/** Total order on sides: node.id, then stance, then evidence. */
function sideBefore(x: Side, y: Side): boolean {
  if (x.e.node.id !== y.e.node.id) return lt(x.e.node.id, y.e.node.id);
  if (x.stance !== y.stance) return lt(x.stance, y.stance);
  return lt(x.evidence, y.evidence);
}

function resolved(winner: Side, loser: Side, reason: "spec" | "retention" | "recency" | "id"): Resolution {
  return { kind: "resolved", winner: winner.e.node.id, loser: loser.e.node.id, reason };
}

function pickWinner(first: Side, second: Side): Resolution {
  const p1 = first.e.protected;
  const p2 = second.e.protected;
  if (p1 && p2) return { kind: "unresolvable", reason: "both-protected" };
  if (p1) return resolved(first, second, "spec");
  if (p2) return resolved(second, first, "spec");

  const diff = first.e.retention - second.e.retention;
  if (Math.abs(diff) > RETENTION_TIE_EPSILON) {
    return diff > 0 ? resolved(first, second, "retention") : resolved(second, first, "retention");
  }
  const c1 = first.e.state.lastReinforcedCommit;
  const c2 = second.e.state.lastReinforcedCommit;
  if (c1 !== c2) return c1 > c2 ? resolved(first, second, "recency") : resolved(second, first, "recency");
  // `first` already has the lexicographically smaller (or equal) id.
  return resolved(first, second, "id");
}

function severityOf(x: ScoredEngram, y: ScoredEngram): ContradictionReport["severity"] {
  if (x.protected || y.protected) return "high";
  return x.tier === "hot" && y.tier === "hot" ? "medium" : "low";
}

/**
 * Resolve one contradicting pair.
 *
 * `stanceA`/`evidenceA` describe engram `a`, and `stanceB`/`evidenceB` describe
 * engram `b`, exactly as passed in; they are only used to fill the report.
 * The result is symmetric: swapping the (a, stanceA, evidenceA) and
 * (b, stanceB, evidenceB) groups yields a deep-equal report. Sides are ordered
 * by node.id (lower id => report.a) before any decision is made.
 */
export function resolveContradiction(
  a: ScoredEngram,
  b: ScoredEngram,
  axisId: string,
  stanceA: string,
  stanceB: string,
  evidenceA: string,
  evidenceB: string,
): ContradictionReport {
  const sa: Side = { e: a, stance: stanceA, evidence: evidenceA };
  const sb: Side = { e: b, stance: stanceB, evidence: evidenceB };
  const [first, second] = sideBefore(sb, sa) ? [sb, sa] : [sa, sb];
  return {
    axis: axisId,
    a: { id: first.e.node.id, stance: first.stance, evidence: first.evidence },
    b: { id: second.e.node.id, stance: second.stance, evidence: second.evidence },
    severity: severityOf(first.e, second.e),
    resolution: pickWinner(first, second),
  };
}
