// Hot-tier token budget analysis: decides which Hot engrams to demote.
// Refs: REQ-CRY-2, INV-1, INV-6
import type { LetheConfig, ScoredEngram } from "../types.js";

export interface BudgetAnalysis {
  readonly status: "ok" | "budget_infeasible";
  readonly demotion: readonly string[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

function sumTokens(items: readonly ScoredEngram[]): number {
  let total = 0;
  for (const e of items) total += e.node.tokens;
  return total;
}

/** Total order: ascending retention, then ascending id (plain `<`). */
function compareDemotion(a: ScoredEngram, b: ScoredEngram): number {
  if (a.retention < b.retention) return -1;
  if (a.retention > b.retention) return 1;
  if (a.node.id < b.node.id) return -1;
  if (a.node.id > b.node.id) return 1;
  return 0;
}

/**
 * Computes which Hot engrams must be demoted so Hot tokens fit `cfg.budgetTokens`.
 *
 * `removed` holds ids that leave the Hot tier by being archived OR merged away;
 * they no longer count toward the Hot total. Defensively, removals of protected
 * engrams are ignored (protected engrams are never removed, INV-1).
 *
 * - tokensBefore: Hot tokens over all scored engrams, before any removal.
 * - If protected Hot tokens alone exceed the budget: `budget_infeasible`,
 *   nothing is demoted, tokensAfter is the Hot total after removal.
 * - Otherwise non-protected, non-removed Hot engrams are demoted in ascending
 *   (retention, id) order, the minimal prefix that fits. Zero-token engrams
 *   are skipped since demoting them cannot help.
 * Pure and total; inputs are never mutated.
 */
export function computeBudget(
  scored: readonly ScoredEngram[],
  removed: ReadonlySet<string>,
  cfg: LetheConfig,
): BudgetAnalysis {
  const hot = scored.filter((e) => e.tier === "hot");
  const tokensBefore = sumTokens(hot);
  const remaining = hot.filter((e) => e.protected || !removed.has(e.node.id));
  const hotAfterRemoval = sumTokens(remaining);
  const protectedHot = sumTokens(remaining.filter((e) => e.protected));
  if (protectedHot > cfg.budgetTokens) {
    return { status: "budget_infeasible", demotion: [], tokensBefore, tokensAfter: hotAfterRemoval };
  }
  if (hotAfterRemoval <= cfg.budgetTokens) {
    return { status: "ok", demotion: [], tokensBefore, tokensAfter: hotAfterRemoval };
  }
  const candidates = remaining
    .filter((e) => !e.protected && e.node.tokens > 0)
    .sort(compareDemotion);
  const demotion: string[] = [];
  let left = hotAfterRemoval;
  for (const e of candidates) {
    if (left <= cfg.budgetTokens) break;
    demotion.push(e.node.id);
    left -= e.node.tokens;
  }
  return { status: "ok", demotion, tokensBefore, tokensAfter: left };
}
