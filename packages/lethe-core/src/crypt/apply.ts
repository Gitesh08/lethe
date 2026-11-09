// applyPlan: materialize a ConsolidationPlan into a new VirtualWorkspace.
// Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-6, INV-1, INV-3, INV-7
//
// Deliberate deviations from the architecture-doc signature
// `applyPlan(workspace, plan) => { workspace, tombstones }`:
//  1. Extra parameters `nowCommit`, `nowISO` (no clock in core) and `cfg`: each file is
//     re-parsed (granularity!) to compute `position.index` / `neighborBefore` from the
//     PRE-apply engram list and to detect stale plans.
//  2. The result carries `skipped`: stale or inconsistent plan entries are reported
//     (file-missing, span-mismatch, parse-failed, duplicate-entry, protected) instead
//     of being silently ignored or thrown. Core is total; errors are returned.
//
// Semantics:
//  - Buried: every `toArchive` entry (its reason/defeatedBy) and every `toMerge.drop`
//    (reason "duplicate", defeatedBy = keep id). `toDemote` changes nothing in files:
//    tiers are derived from scores, never stored in the text.
//  - An id seen twice in the plan is buried once; repeats are "duplicate-entry".
//  - INV-1 safety net: a `protected` engram is never buried ("protected").
//  - Inputs are never mutated; `files` is a new Map. Existing tombstones are kept even
//    if an id repeats; resurrect operates on the exact record it is handed.
//  - Returned `tombstones` = only the new records, sorted by (buriedAtCommit, id).
import type {
  ConsolidationPlan, LetheConfig, TombstoneRecord, VirtualWorkspace,
} from "../types.js";
import { processFile } from "./apply-file.js";
import type { BuryEntry, Skipped, SkipReason } from "./apply-file.js";
import { sortTombstones } from "./tombstone-json.js";

export type { SkipReason, Skipped } from "./apply-file.js";

export interface ApplyResult {
  readonly workspace: VirtualWorkspace;
  readonly tombstones: readonly TombstoneRecord[];
  readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: SkipReason }>;
}

function flatten(plan: ConsolidationPlan): BuryEntry[] {
  const out: BuryEntry[] = [];
  for (const a of plan.toArchive) {
    out.push(
      a.defeatedBy === undefined
        ? { scored: a.engram, reason: a.reason }
        : { scored: a.engram, reason: a.reason, defeatedBy: a.defeatedBy },
    );
  }
  for (const m of plan.toMerge) {
    out.push({ scored: m.drop, reason: "duplicate", defeatedBy: m.keep.node.id });
  }
  return out;
}

/** Drop repeats and protected engrams; group the rest by file in plan order. */
function groupByFile(entries: readonly BuryEntry[]): { groups: Map<string, BuryEntry[]>; skipped: Skipped[] } {
  const groups = new Map<string, BuryEntry[]>();
  const skipped: Skipped[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id = e.scored.node.id;
    if (seen.has(id)) {
      skipped.push({ id, reason: "duplicate-entry" });
      continue;
    }
    seen.add(id);
    if (e.scored.protected) {
      skipped.push({ id, reason: "protected" });
      continue;
    }
    const list = groups.get(e.scored.node.file) ?? [];
    list.push(e);
    groups.set(e.scored.node.file, list);
  }
  return { groups, skipped };
}

export function applyPlan(
  workspace: VirtualWorkspace,
  plan: ConsolidationPlan,
  nowCommit: number,
  nowISO: string,
  cfg: LetheConfig,
): ApplyResult {
  const { groups, skipped } = groupByFile(flatten(plan));
  const files = new Map(workspace.files);
  const created: TombstoneRecord[] = [];
  const allSkipped: Skipped[] = [...skipped];
  for (const [file, entries] of groups) {
    const outcome = processFile(file, workspace.files.get(file), entries, nowCommit, nowISO, cfg);
    if (workspace.files.has(file)) files.set(file, outcome.text);
    created.push(...outcome.tombstones);
    allSkipped.push(...outcome.skipped);
  }
  return {
    workspace: { files, tombstones: sortTombstones([...workspace.tombstones, ...created]) },
    tombstones: sortTombstones(created),
    skipped: allSkipped,
  };
}
