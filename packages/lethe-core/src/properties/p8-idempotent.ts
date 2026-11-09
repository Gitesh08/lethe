// P8: consolidate(consolidate(w)) = consolidate(w) (INV-4). Demotion is derived, not persisted,
// so the second plan has EMPTY toArchive/toMerge, the SAME budgetStatus and a STABLE toDemote,
// and the workspace (files + tombstones) is unchanged. Also checks determinism of one run.
// Refs: REQ-CRY-4, INV-4, REQ-PBT-1

import fc from "fast-check";
import { anyWorkspaceInputArb } from "./arbitraries/adversarial.arb.js";
import { duplicateHeavyWorkspaceArb } from "./arbitraries/duplicate-heavy.arb.js";
import { consolidateOnce, runConsolidation } from "../consolidate/pipeline.js";
import type { PipelineInput, PipelineResult } from "../consolidate/pipeline.js";
import { serializeTombstones } from "../crypt/tombstone-json.js";
import type { LetheConfig, VirtualWorkspace } from "../types.js";

export const P8_ID = "P8";

export interface P8RunStats {
  readonly buried: number;
  readonly merged: number;
  readonly demoted: number;
}

function fail(msg: string): never {
  throw new Error(`${P8_ID} violated: ${msg}`);
}

function run(input: PipelineInput, label: string): PipelineResult {
  const r = runConsolidation(input);
  if (!r.ok) fail(`${label}: runConsolidation failed: ${r.error.code} ${r.error.message}`);
  return r.value;
}

/** Canonical byte form of a workspace: sorted [path,text] pairs + serialized tombstones. */
function wsBytes(ws: VirtualWorkspace): string {
  const files = [...ws.files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify([files, serializeTombstones(ws.tombstones)]);
}

function checkSecond(r1: PipelineResult, r2: PipelineResult, in2: PipelineInput, label: string): void {
  if (r2.plan.toArchive.length !== 0) fail(`${label}: toArchive not empty (${r2.plan.toArchive.length})`);
  if (r2.plan.toMerge.length !== 0) fail(`${label}: toMerge not empty (${r2.plan.toMerge.length})`);
  if (r2.plan.budgetStatus !== r1.plan.budgetStatus) {
    fail(`${label}: budgetStatus ${r1.plan.budgetStatus} -> ${r2.plan.budgetStatus}`);
  }
  if (JSON.stringify(r2.plan.toDemote) !== JSON.stringify(r1.plan.toDemote)) {
    fail(`${label}: toDemote unstable ${JSON.stringify(r1.plan.toDemote)} -> ${JSON.stringify(r2.plan.toDemote)}`);
  }
  if (r2.applied.skipped.length !== 0) fail(`${label}: applied.skipped not empty`);
  if (r2.applied.tombstones.length !== 0) fail(`${label}: new tombstones created`);
  if (wsBytes(r2.applied.workspace) !== wsBytes(in2.workspace)) fail(`${label}: workspace changed`);
}

function checkParseErrorsUntouched(input: PipelineInput, r: PipelineResult): void {
  for (const pe of r.scoredWorkspace.parseErrors) {
    if (r.applied.workspace.files.get(pe.file) !== input.workspace.files.get(pe.file)) {
      fail(`file with parse error was modified: ${pe.file}`);
    }
  }
}

export function checkIdempotent(input: PipelineInput): P8RunStats {
  const r1 = run(input, "run 1");
  if (wsBytes(run(input, "run 1 repeat").applied.workspace) !== wsBytes(r1.applied.workspace)) {
    fail("determinism: two runs on the same input differ");
  }
  checkParseErrorsUntouched(input, r1);
  const in2: PipelineInput = { ...input, workspace: r1.applied.workspace };
  const r2 = run(in2, "run 2");
  checkSecond(r1, r2, in2, "run 2");
  checkParseErrorsUntouched(in2, r2);
  const in3: PipelineInput = { ...in2, workspace: r2.applied.workspace };
  checkSecond(r1, run(in3, "run 3"), in3, "run 3");
  const once = consolidateOnce(input);
  if (!once.ok || wsBytes(once.value.workspace) !== wsBytes(r1.applied.workspace)) {
    fail("consolidateOnce disagrees with runConsolidation");
  }
  return { buried: r1.plan.toArchive.length, merged: r1.plan.toMerge.length, demoted: r1.plan.toDemote.length };
}

function budgetCaseArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc
    .integer({ min: 1, max: 400 })
    .chain((budgetTokens) => anyWorkspaceInputArb({ ...cfg, budgetTokens }));
}

/** Sub-property: duplicate-heavy workspaces so the merge path is really exercised. */
export function p8IdempotentDuplicates(cfg: LetheConfig, onRun?: (stats: P8RunStats) => void) {
  return fc.property(
    fc.integer({ min: 1, max: 400 }).chain((budgetTokens) => duplicateHeavyWorkspaceArb({ ...cfg, budgetTokens })),
    (input) => {
      const stats = checkIdempotent(input);
      if (onRun !== undefined) onRun(stats);
    },
  );
}

export function p8Idempotent(cfg: LetheConfig, onRun?: (stats: P8RunStats) => void) {
  return fc.property(budgetCaseArb(cfg), (input) => {
    const stats = checkIdempotent(input);
    if (onRun !== undefined) onRun(stats);
  });
}
