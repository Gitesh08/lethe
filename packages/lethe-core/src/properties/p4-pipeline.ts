// P4 end-to-end half: the REAL pipeline (parse -> score -> detect -> plan -> apply) must
// never bury, merge away or demote a protected engram, and must keep its text.
// Refs: REQ-CRY-1, REQ-DEC-4, REQ-DEC-7, INV-1

import fc from "fast-check";
import {
  allSpecLinkedWorkspaceArb,
  anyWorkspaceInputArb,
} from "./arbitraries/adversarial.arb.js";
import { runConsolidation } from "../consolidate/pipeline.js";
import type { PipelineInput, PipelineResult } from "../consolidate/pipeline.js";
import type { LetheConfig, ScoredEngram } from "../types.js";

export interface E2ECase {
  readonly input: PipelineInput;
  readonly allLinked: boolean;
}

function fail(msg: string): never {
  throw new Error(`P4 violated (end-to-end): ${msg}`);
}

export function e2eCaseArb(cfg: LetheConfig): fc.Arbitrary<E2ECase> {
  return fc.oneof(
    anyWorkspaceInputArb(cfg).map((input): E2ECase => ({ input, allLinked: false })),
    allSpecLinkedWorkspaceArb(cfg).map((input): E2ECase => ({ input, allLinked: true })),
  );
}

function checkPlan(r: PipelineResult, protectedIds: ReadonlySet<string>, allLinked: boolean): void {
  const { plan } = r;
  for (const a of plan.toArchive) {
    if (protectedIds.has(a.engram.node.id)) fail(`protected "${a.engram.node.id}" is in plan.toArchive`);
  }
  for (const m of plan.toMerge) {
    if (protectedIds.has(m.drop.node.id)) fail(`protected "${m.drop.node.id}" is plan.toMerge drop`);
  }
  for (const id of plan.toDemote) {
    if (protectedIds.has(id)) fail(`protected "${id}" is in plan.toDemote`);
  }
  checkSkipped(r, allLinked);
}

function checkSkipped(r: PipelineResult, allLinked: boolean): void {
  const { plan } = r;
  for (const s of r.applied.skipped) {
    if (s.reason === "protected") fail(`planner leaked protected "${s.id}"; applyPlan had to skip it`);
  }
  if (allLinked && (plan.toArchive.length > 0 || plan.toMerge.length > 0)) {
    fail(`all-protected workspace: toArchive=${plan.toArchive.length}, toMerge=${plan.toMerge.length}`);
  }
}

function checkEngram(s: ScoredEngram, input: PipelineInput, r: PipelineResult, cfg: LetheConfig): void {
  const id = s.node.id;
  if (!(s.retention >= cfg.specFloor)) fail(`protected "${id}" retention ${s.retention} < specFloor ${cfg.specFloor}`);
  const before = input.workspace.files.get(s.node.file);
  const after = r.applied.workspace.files.get(s.node.file);
  if (before === undefined || after === undefined) fail(`protected "${id}": file ${s.node.file} missing`);
  const raw = before.slice(s.node.span.start, s.node.span.end);
  if (!after.includes(raw)) fail(`protected "${id}": original text no longer present in ${s.node.file}`);
  if (r.applied.workspace.tombstones.some((t) => t.id === id)) fail(`tombstone exists for protected "${id}"`);
}

export function checkEndToEnd(c: E2ECase, cfg: LetheConfig): void {
  const res = runConsolidation(c.input);
  if (!res.ok) fail(`runConsolidation failed: ${res.error.code} ${res.error.message}`);
  const prot = res.value.scoredWorkspace.scored.filter((s) => s.protected);
  checkPlan(res.value, new Set(prot.map((s) => s.node.id)), c.allLinked);
  for (const s of prot) checkEngram(s, c.input, res.value, cfg);
}
