// P6: Hot tokens <= K after consolidation, or `budget_infeasible` is reported with
// protected engrams intact. Everything is recomputed independently from the scored
// engrams and the applied workspace; plan.tokensAfter is only cross-checked.
// Refs: REQ-CRY-2, INV-1, INV-6

import fc from "fast-check";
import {
  allSpecLinkedWorkspaceArb,
  anyWorkspaceInputArb,
  longIdleWorkspaceArb,
} from "./arbitraries/adversarial.arb.js";
import { runConsolidation } from "../consolidate/pipeline.js";
import type { PipelineInput, PipelineResult } from "../consolidate/pipeline.js";
import type { LetheConfig, ScoredEngram } from "../types.js";

export const P6_ID = "P6";

function fail(msg: string): never {
  throw new Error(`${P6_ID} violated: ${msg}`);
}

function sum(items: readonly ScoredEngram[]): number {
  let total = 0;
  for (const e of items) total += e.node.tokens;
  return total;
}

/** Ids that really left the files: tombstones created by applyPlan (skipped entries stay). */
function removedIds(r: PipelineResult): ReadonlySet<string> {
  const planned = new Set<string>(r.plan.toArchive.map((a) => a.engram.node.id));
  for (const m of r.plan.toMerge) planned.add(m.drop.node.id);
  return new Set(r.applied.tombstones.map((t) => t.id).filter((id) => planned.has(id)));
}

function checkDemotionSet(r: PipelineResult, removed: ReadonlySet<string>): void {
  const byId = new Map(r.scoredWorkspace.scored.map((e) => [e.node.id, e] as const));
  const seen = new Set<string>();
  for (const id of r.plan.toDemote) {
    const e = byId.get(id);
    if (e === undefined) fail(`demoted id "${id}" is not a scored engram`);
    if (seen.has(id)) fail(`demoted id "${id}" listed twice`);
    seen.add(id);
    if (e.protected) fail(`protected engram "${id}" demoted`);
    if (e.tier !== "hot") fail(`demoted engram "${id}" has tier ${e.tier}, not hot`);
    if (removed.has(id)) fail(`demoted engram "${id}" was also removed`);
  }
}

function checkNoProtectedRemoved(r: PipelineResult): void {
  const protectedIds = new Set(
    r.scoredWorkspace.scored.filter((e) => e.protected).map((e) => e.node.id),
  );
  for (const t of r.applied.tombstones) {
    if (protectedIds.has(t.id)) fail(`protected engram "${t.id}" was archived or merged away`);
  }
  for (const a of r.plan.toArchive) {
    if (a.engram.protected) fail(`protected engram "${a.engram.node.id}" planned for archive`);
  }
}

function checkProtectedIntact(r: PipelineResult): void {
  const buried = new Set(r.applied.tombstones.map((t) => t.id));
  for (const e of r.scoredWorkspace.scored) {
    if (!e.protected || e.tier !== "hot") continue;
    const text = r.applied.workspace.files.get(e.node.file);
    if (buried.has(e.node.id)) fail(`protected hot engram "${e.node.id}" has a tombstone`);
    if (text === undefined || !text.includes(e.node.body)) {
      fail(`protected hot engram "${e.node.id}" is missing from ${e.node.file}`);
    }
  }
}

function checkOk(r: PipelineResult, hotAfter: number, budget: number, demoted: ReadonlySet<string>): void {
  if (hotAfter > budget) fail(`hot tokens ${hotAfter} > budget ${budget} with status ok`);
  if (hotAfter !== r.plan.tokensAfter) {
    fail(`independent hot tokens ${hotAfter} !== plan.tokensAfter ${r.plan.tokensAfter}`);
  }
  const lastId = r.plan.toDemote[r.plan.toDemote.length - 1];
  if (lastId === undefined) return;
  const last = r.scoredWorkspace.scored.find((e) => e.node.id === lastId);
  if (last === undefined || last.node.tokens === 0) return;
  if (hotAfter + last.node.tokens <= budget && demoted.has(lastId)) {
    fail(`demotion not minimal: re-adding "${lastId}" (${last.node.tokens} tok) still fits ${budget}`);
  }
}

function checkResult(input: PipelineInput, r: PipelineResult): void {
  const budget = input.cfg.budgetTokens;
  const scored = r.scoredWorkspace.scored;
  const removed = removedIds(r);
  const demoted = new Set(r.plan.toDemote);
  const hot = scored.filter((e) => e.tier === "hot");
  if (r.plan.tokensBefore !== sum(hot)) fail(`tokensBefore ${r.plan.tokensBefore} !== ${sum(hot)}`);
  checkDemotionSet(r, removed);
  checkNoProtectedRemoved(r);
  const hotAfter = sum(hot.filter((e) => !removed.has(e.node.id) && !demoted.has(e.node.id)));
  if (r.plan.budgetStatus === "ok") return checkOk(r, hotAfter, budget, demoted);
  const protectedHot = sum(hot.filter((e) => e.protected && !removed.has(e.node.id)));
  if (!(protectedHot > budget)) fail(`budget_infeasible but protected hot ${protectedHot} <= ${budget}`);
  if (r.plan.toDemote.length !== 0) fail(`budget_infeasible but demoted ${r.plan.toDemote.length} engrams`);
  checkProtectedIntact(r);
}

function workspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc.integer({ min: 1, max: 80 }).chain((budgetTokens) => {
    const c: LetheConfig = { ...cfg, budgetTokens };
    return fc.oneof(anyWorkspaceInputArb(c), allSpecLinkedWorkspaceArb(c), longIdleWorkspaceArb(c));
  });
}

export function p6Budget(cfg: LetheConfig) {
  return fc.property(workspaceArb(cfg), (input) => {
    const result = runConsolidation(input);
    if (!result.ok) return fail(`runConsolidation failed: ${result.error.code}: ${result.error.message}`);
    checkResult(input, result.value);
  });
}
