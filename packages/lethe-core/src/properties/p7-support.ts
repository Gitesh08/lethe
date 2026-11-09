// P7 helpers: failure helper, structural equality, single-entry plans, fresh-state check.
// Refs: REQ-CRY-3, INV-3

import { applyPlan } from "../crypt/apply.js";
import type { PipelineInput, PipelineResult } from "../consolidate/pipeline.js";
import type {
  ConsolidationPlan, EngramNode, EngramState, ScoredEngram, TombstoneRecord, VirtualWorkspace,
} from "../types.js";

export const P7_ID = "P7";

export function fail(msg: string): never {
  throw new Error(`${P7_ID} violated: ${msg}`);
}

/** Structural equality: same keys (order-insensitive), Object.is on primitives. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).sort();
  const kb = Object.keys(rb).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual(ra[k], rb[k]));
}

export function show(v: unknown): string {
  return JSON.stringify(v);
}

/** A plan that buries exactly `scored`, with the reason / defeatedBy of tombstone `t`. */
export function singlePlan(scored: ScoredEngram, t: TombstoneRecord): ConsolidationPlan {
  const entry =
    t.defeatedBy === undefined
      ? { engram: scored, reason: t.reason }
      : { engram: scored, reason: t.reason, defeatedBy: t.defeatedBy };
  return {
    toArchive: [entry], toMerge: [], toDemote: [], budgetStatus: "ok", tokensBefore: 0, tokensAfter: 0,
  };
}

/** Bury only `scored` in the ORIGINAL workspace; exactly one record must result. */
export function buryAlone(
  input: PipelineInput,
  scored: ScoredEngram,
  t: TombstoneRecord,
): { workspace: VirtualWorkspace; record: TombstoneRecord } {
  const r = applyPlan(input.workspace, singlePlan(scored, t), input.nowCommit, input.nowISO, input.cfg);
  const record = r.tombstones[0];
  if (r.tombstones.length !== 1 || record === undefined || r.skipped.length > 0) {
    fail(`single archive of ${t.id} gave ${r.tombstones.length} records, skipped ${show(r.skipped)}`);
  }
  return { workspace: r.workspace, record };
}

/** Resurrect's returned state must be the fresh one (REQ 4.11). */
export function assertFreshState(state: EngramState, id: string, input: PipelineInput): void {
  const ok =
    state.id === id &&
    state.stability === input.cfg.s0 &&
    state.reinforcements === 0 &&
    state.lastReinforcedCommit === input.nowCommit &&
    state.lastReinforcedAt === input.nowISO;
  if (!ok) fail(`resurrected state of ${id} is not fresh: ${show(state)}`);
}

export interface Original {
  readonly node: EngramNode;
  readonly scored: ScoredEngram;
  readonly text: string;
  /** Index of the engram within its file and number of engrams in that file. */
  readonly index: number;
  readonly inFile: number;
}

/** Look up the original engram / scored engram / file text behind a tombstone. */
export function originalOf(res: PipelineResult, input: PipelineInput, t: TombstoneRecord): Original {
  const { engrams, scored } = res.scoredWorkspace;
  const node = engrams.find((g) => g.id === t.id);
  const s = scored.find((g) => g.node.id === t.id);
  const text = input.workspace.files.get(t.file);
  if (node === undefined || s === undefined || text === undefined) fail(`no original for tombstone ${t.id}`);
  const sameFile = engrams.filter((g) => g.file === node.file);
  return { node, scored: s, text, index: sameFile.indexOf(node), inFile: sameFile.length };
}
