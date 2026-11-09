// Sanity checks: each adversarial arbitrary really produces what it advertises, and the
// general one is not vacuous (plans actually archive things). Refs: REQ-PBT-4
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runConsolidation, scoreWorkspace } from "../src/consolidate/pipeline.js";
import type { PipelineInput, PipelineResult } from "../src/consolidate/pipeline.js";
import {
  allSpecLinkedWorkspaceArb,
  anyWorkspaceInputArb,
  burstyLedgerWorkspaceArb,
  duplicateIdWorkspaceArb,
  emptyWorkspaceArb,
  longIdleWorkspaceArb,
  unicodeCrlfWorkspaceArb,
  workspaceInputArb,
} from "../src/properties/arbitraries/adversarial.arb.js";

const cfg = DEFAULT_CONFIG;
const N = 100;

function result(input: PipelineInput): PipelineResult {
  const r = runConsolidation(input);
  if (!r.ok) throw new Error(`pipeline failed: ${r.error.message}`);
  return r.value;
}

function pct(count: number): string {
  return `${((100 * count) / N).toFixed(0)}%`;
}

describe("adversarial arbitraries", () => {
  it("workspaceInputArb: plans archive something in >= 5% of samples (non-vacuity)", () => {
    const samples = fc.sample(workspaceInputArb(cfg), N);
    const results = samples.map(result);
    const archiving = results.filter((r) => r.plan.toArchive.length > 0).length;
    const merging = results.filter((r) => r.plan.toMerge.length > 0).length;
    const contradictions = results.filter((r) => r.reports.length > 0).length;
    const defeated = results.filter((r) => r.plan.toArchive.some((a) => a.reason === "contradiction")).length;
    const protectedStale = results.filter((r) => r.scoredWorkspace.scored.some((s) => s.protected && s.rawRetention < cfg.cryptMax)).length;
    console.info(
      `[non-vacuity] archive=${pct(archiving)} merge=${pct(merging)} contradictionReports=${pct(contradictions)} ` +
        `contradictionLosers=${pct(defeated)} protectedButDecayed=${pct(protectedStale)}`,
    );
    expect(archiving).toBeGreaterThanOrEqual(0.05 * N);
  });

  it("anyWorkspaceInputArb: also archives in >= 5% of samples and never fails config checks", () => {
    const samples = fc.sample(anyWorkspaceInputArb(cfg), N);
    const archiving = samples.map(result).filter((r) => r.plan.toArchive.length > 0).length;
    console.info(`[non-vacuity] anyWorkspaceInputArb archive=${pct(archiving)}`);
    expect(archiving).toBeGreaterThanOrEqual(0.05 * N);
  });

  it("allSpecLinkedWorkspaceArb: every scored engram is protected", () => {
    const samples = fc.sample(allSpecLinkedWorkspaceArb(cfg), N);
    let total = 0;
    for (const s of samples) {
      const sw = scoreWorkspace(s);
      total += sw.scored.length;
      expect(sw.scored.every((e) => e.protected)).toBe(true);
    }
    expect(total).toBeGreaterThan(0);
  });

  it("duplicateIdWorkspaceArb: produces PARSE_DUPLICATE_ID parse errors", () => {
    const samples = fc.sample(duplicateIdWorkspaceArb(cfg), N);
    const withErrors = samples.filter((s) => scoreWorkspace(s).parseErrors.some((p) => p.error.code === "PARSE_DUPLICATE_ID"));
    console.info(`[duplicateId] samples with PARSE_DUPLICATE_ID=${pct(withErrors.length)}`);
    expect(withErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("burstyLedgerWorkspaceArb: >= 20 events within 5 commits", () => {
    for (const s of fc.sample(burstyLedgerWorkspaceArb(cfg), N)) {
      const commits = s.ledger.map((e) => e.commit);
      expect(commits.length).toBeGreaterThanOrEqual(20);
      expect(Math.max(...commits) - Math.min(...commits)).toBeLessThanOrEqual(5);
    }
  });

  it("longIdleWorkspaceArb: no ledger and deltaC >= 500 for every scored engram", () => {
    let total = 0;
    for (const s of fc.sample(longIdleWorkspaceArb(cfg), N)) {
      expect(s.ledger).toEqual([]);
      const sw = scoreWorkspace(s);
      total += sw.scored.length;
      expect(sw.scored.every((e) => e.deltaC >= 500)).toBe(true);
    }
    expect(total).toBeGreaterThan(0);
  });

  it("emptyWorkspaceArb: never yields an engram", () => {
    for (const s of fc.sample(emptyWorkspaceArb(cfg), N)) {
      expect(scoreWorkspace(s).engrams).toEqual([]);
    }
  });

  it("unicodeCrlfWorkspaceArb: yields non-ASCII text, CRLF and files without trailing newline", () => {
    const texts = fc.sample(unicodeCrlfWorkspaceArb(cfg), N).flatMap((s) => [...s.workspace.files.values()]);
    expect(texts.some((t) => /[^\u0000-\u007f]/.test(t))).toBe(true);
    expect(texts.some((t) => t.includes("\r\n"))).toBe(true);
    expect(texts.some((t) => t.includes("\r\n") && /[^\r]\n/.test(t))).toBe(true);
    expect(texts.some((t) => !t.endsWith("\n"))).toBe(true);
  });
});
