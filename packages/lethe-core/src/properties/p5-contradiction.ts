// P5: after consolidation, no contradicting pair coexists in the Hot/Warm sets
// (unless flagged `unresolvable`, i.e. both sides protected).
//
// Two halves:
//  - DEFECT half (always runs): for arbitrary scored sets + specs it checks the
//    detection/defeat level of INV-5:
//      * detectContradictions succeeds;
//      * resolved report: winner !== loser, the loser is never protected and is
//        "defeated" after applyDefeats (spec-side losers cannot occur);
//        reason "spec" implies a protected winner;
//      * unresolvable report: both sides protected, neither defeated;
//      * no protected engram is ever "defeated";
//      * "defeated" <=> loser of >= 1 resolved report (non-spec loser id);
//      * survivors (still "active" after applyDefeats), re-detected with
//        specs = [], yield only unresolvable reports. This holds because a
//        survivor pair was reported in the first run; if it had been resolved,
//        its non-protected loser would be defeated, hence not a survivor.
//  - CALLBACK half (optional): pass `consolidate`, mapping (scored, reports) to a
//    post-consolidation scored set. Among engrams still in Hot/Warm,
//    re-detection must yield only unresolvable reports.
//  - END-TO-END half (always runs, p5-pipeline.ts): the real runConsolidation, then
//    re-score + re-detect on the APPLIED workspace; surviving Hot/Warm real-engram
//    pairs must be unresolvable and no unprotected survivor contradicts a spec.
//
// INV-5 is fully covered end-to-end.
// Refs: REQ-CON-2, REQ-CON-4, REQ-CON-6, INV-5

import fc from "fast-check";
import { contradictionInputArb } from "./arbitraries/contradiction.arb.js";
import { applyDefeats } from "../contradiction/defeat.js";
import { detectContradictions } from "../contradiction/detect.js";
import { SPEC_ID_PREFIX } from "../contradiction/spec-side.js";
import { checkPipelineP5, p5PipelineArb } from "./p5-pipeline.js";
import type { ContradictionReport, LetheConfig, ScoredEngram, SpecInvariant } from "../types.js";

export const P5_ID = "P5";

type Consolidate = (
  scored: readonly ScoredEngram[],
  reports: readonly ContradictionReport[],
) => readonly ScoredEngram[];

function fail(msg: string): never {
  throw new Error(`${P5_ID} violated: ${msg}`);
}

function detect(scored: readonly ScoredEngram[], specs: readonly SpecInvariant[], label: string): readonly ContradictionReport[] {
  const r = detectContradictions(scored, specs);
  if (!r.ok) return fail(`${label}: detectContradictions failed with ${r.error.code}: ${r.error.message}`);
  return r.value;
}

function describe(r: ContradictionReport): string {
  return `[${r.axis}] ${r.a.id} (${r.a.stance}) vs ${r.b.id} (${r.b.stance})`;
}

function byId(list: readonly ScoredEngram[]): ReadonlyMap<string, ScoredEngram> {
  return new Map(list.map((e) => [e.node.id, e] as const));
}

function checkWinner(
  r: ContradictionReport,
  res: { readonly winner: string; readonly reason: string },
  orig: ReadonlyMap<string, ScoredEngram>,
  after: ReadonlyMap<string, ScoredEngram>,
): void {
  const winner = orig.get(res.winner);
  if (res.reason === "spec" && winner !== undefined && !winner.protected && !res.winner.startsWith(SPEC_ID_PREFIX)) {
    fail(`reason "spec" but winner "${res.winner}" is unprotected (${describe(r)})`);
  }
  if (winner?.protected === true && after.get(res.winner)?.status === "defeated") {
    fail(`protected winner "${res.winner}" is defeated (${describe(r)})`);
  }
}

function checkResolved(r: ContradictionReport, orig: ReadonlyMap<string, ScoredEngram>, after: ReadonlyMap<string, ScoredEngram>): void {
  const res = r.resolution;
  if (res.kind !== "resolved") return;
  if (res.winner === res.loser) fail(`winner === loser for ${describe(r)}`);
  const loser = orig.get(res.loser);
  if (loser === undefined) return fail(`loser "${res.loser}" is not an input engram (${describe(r)})`);
  if (loser.protected) fail(`protected loser "${res.loser}" in resolved report ${describe(r)}`);
  if (after.get(res.loser)?.status !== "defeated") fail(`loser "${res.loser}" not defeated for ${describe(r)}`);
  checkWinner(r, res, orig, after);
}

function checkUnresolvable(r: ContradictionReport, orig: ReadonlyMap<string, ScoredEngram>, after: ReadonlyMap<string, ScoredEngram>): void {
  if (r.resolution.kind !== "unresolvable") return;
  for (const id of [r.a.id, r.b.id]) {
    const e = orig.get(id);
    if (e === undefined) {
      if (!id.startsWith(SPEC_ID_PREFIX)) fail(`unknown side "${id}" in ${describe(r)}`);
      continue;
    }
    if (!e.protected) fail(`unresolvable report with unprotected side "${id}" (${describe(r)})`);
    if (after.get(id)?.status === "defeated") fail(`side "${id}" of unresolvable report is defeated (${describe(r)})`);
  }
}

function checkDefeatedExactly(
  reports: readonly ContradictionReport[],
  defeated: readonly ScoredEngram[],
): void {
  const losers = new Set<string>();
  for (const r of reports) {
    if (r.resolution.kind === "resolved" && !r.resolution.loser.startsWith(SPEC_ID_PREFIX)) {
      losers.add(r.resolution.loser);
    }
  }
  for (const e of defeated) {
    if (e.protected && e.status === "defeated") fail(`protected engram "${e.node.id}" is defeated`);
    const isDefeated = e.status === "defeated";
    if (isDefeated !== losers.has(e.node.id)) {
      fail(`"${e.node.id}" status=${e.status} but loser-of-resolved-report=${losers.has(e.node.id)}`);
    }
  }
}

/** Every report among `set` (specs = []) must be unresolvable. */
function checkOnlyUnresolvable(set: readonly ScoredEngram[], label: string): void {
  for (const r of detect(set, [], label)) {
    if (r.resolution.kind !== "unresolvable") {
      fail(`${label}: contradicting pair still coexists: ${describe(r)} (${JSON.stringify(r.resolution)})`);
    }
  }
}

function checkDefects(scored: readonly ScoredEngram[], specs: readonly SpecInvariant[]): readonly ContradictionReport[] {
  const reports = detect(scored, specs, "initial");
  const defeated = applyDefeats(scored, reports);
  const orig = byId(scored);
  const after = byId(defeated);
  for (const r of reports) {
    checkResolved(r, orig, after);
    checkUnresolvable(r, orig, after);
  }
  checkDefeatedExactly(reports, defeated);
  checkOnlyUnresolvable(defeated.filter((e) => e.status === "active"), "survivors");
  return reports;
}

/** Defect half + end-to-end half (always both; see p5-pipeline.ts) + optional callback. */
export function p5Contradiction(cfg: LetheConfig, consolidate?: Consolidate) {
  return fc.property(contradictionInputArb(cfg), p5PipelineArb(cfg), ({ scored, specs }, input) => {
    const reports = checkDefects(scored, specs);
    if (consolidate !== undefined) {
      const result = consolidate(scored, reports);
      checkOnlyUnresolvable(result.filter((e) => e.tier !== "crypt"), "consolidated Hot/Warm");
    }
    checkPipelineP5(input);
  });
}
