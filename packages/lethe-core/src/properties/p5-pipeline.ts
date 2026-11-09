// P5 end-to-end half: run the REAL pipeline, re-score the APPLIED workspace and re-detect.
// Among surviving Hot/Warm engrams, every contradicting pair of real engrams must be
// `unresolvable` (both protected), and no unprotected Hot/Warm survivor may contradict an
// active spec side. Crypt-tier survivors (only possible for protected engrams) and budget
// demotion (not persisted) are ignored.
// Refs: REQ-CON-2, REQ-CON-4, REQ-CON-6, REQ-CRY-1, INV-5

import { anyWorkspaceInputArb } from "./arbitraries/adversarial.arb.js";
import { runConsolidation, scoreWorkspace } from "../consolidate/pipeline.js";
import type { PipelineInput } from "../consolidate/pipeline.js";
import { detectContradictions } from "../contradiction/detect.js";
import { SPEC_ID_PREFIX } from "../contradiction/spec-side.js";
import type { ContradictionReport, LetheConfig, ScoredEngram } from "../types.js";

function fail(msg: string): never {
  throw new Error(`P5 violated (end-to-end): ${msg}`);
}

function describeReport(r: ContradictionReport): string {
  return `[${r.axis}] ${r.a.id} (${r.a.stance}) vs ${r.b.id} (${r.b.stance}) ${JSON.stringify(r.resolution)}`;
}

function isSpec(id: string): boolean {
  return id.startsWith(SPEC_ID_PREFIX);
}

function checkReport(r: ContradictionReport, live: ReadonlyMap<string, ScoredEngram>): void {
  const a = live.get(r.a.id);
  const b = live.get(r.b.id);
  if (!isSpec(r.a.id) && !isSpec(r.b.id)) {
    if (a === undefined || b === undefined) return; // a side is in the crypt tier: unconstrained
    if (r.resolution.kind !== "unresolvable") fail(`coexisting pair after apply: ${describeReport(r)}`);
    return;
  }
  const real = isSpec(r.a.id) ? b : a;
  if (real === undefined || real.protected) return;
  if (r.resolution.kind === "resolved") {
    fail(`unprotected survivor "${real.node.id}" contradicts a spec: ${describeReport(r)}`);
  }
}

export function checkPipelineP5(input: PipelineInput): void {
  const res = runConsolidation(input);
  if (!res.ok) return fail(`runConsolidation failed: ${res.error.code} ${res.error.message}`);
  const rescored = scoreWorkspace({ ...input, workspace: res.value.applied.workspace });
  if (rescored.configError !== undefined) return fail(`re-score failed: ${rescored.configError.message}`);
  const reports = detectContradictions(rescored.scored, input.specs);
  if (!reports.ok) return fail(`re-detect failed: ${reports.error.code}`);
  const live = new Map(
    rescored.scored.filter((s) => s.tier !== "crypt").map((s) => [s.node.id, s] as const),
  );
  for (const r of reports.value) checkReport(r, live);
}

export function p5PipelineArb(cfg: LetheConfig) {
  return anyWorkspaceInputArb(cfg);
}
