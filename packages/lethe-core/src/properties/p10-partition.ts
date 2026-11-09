// P10: every engram is in exactly one tier, and the tier agrees with retention.
// Exact threshold comparisons (no epsilon) are the documented exception in 03-rules.
// Refs: REQ-DEC-11, INV-2, REQ-PBT-1

import fc from "fast-check";
import { anyScoreInputArb } from "./arbitraries/workspace.arb.js";
import { score } from "../decay/score.js";
import type { LetheConfig, ScoredEngram, Tier } from "../types.js";

export const P10_ID = "P10";

function fail(msg: string): never {
  throw new Error(`${P10_ID} violated: ${msg}`);
}

const TIERS: readonly Tier[] = ["hot", "warm", "crypt"];

function isTier(t: unknown): t is Tier {
  return t === "hot" || t === "warm" || t === "crypt";
}

function expectedTier(retention: number, cfg: LetheConfig): Tier {
  if (retention >= cfg.hotMin) return "hot";
  if (retention >= cfg.cryptMax) return "warm";
  return "crypt";
}

function countIds(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

function assertSameIds(inIds: readonly string[], outIds: readonly string[]): void {
  if (outIds.length !== inIds.length) {
    fail(`output has ${outIds.length} engrams, input has ${inIds.length}`);
  }
  const want = countIds(inIds);
  const got = countIds(outIds);
  for (const [id, n] of want) {
    if (got.get(id) !== n) fail(`id "${id}" appears ${got.get(id) ?? 0}x in output, ${n}x in input`);
  }
  for (const [id, n] of got) {
    if (!want.has(id)) fail(`output contains unknown id "${id}" (${n}x)`);
  }
}

function assertEngram(s: ScoredEngram, cfg: LetheConfig): void {
  const id = s.node.id;
  if (!isTier(s.tier)) fail(`"${id}" has invalid tier ${String(s.tier)}`);
  if (!Number.isFinite(s.retention)) fail(`"${id}" retention is not finite (${s.retention})`);
  if (!(s.rawRetention <= s.retention)) {
    fail(`"${id}" rawRetention ${s.rawRetention} > retention ${s.retention} (floor only raises)`);
  }
  const want = expectedTier(s.retention, cfg);
  if (s.tier !== want) {
    fail(`"${id}" retention=${s.retention} tier="${s.tier}" but thresholds (hotMin=${cfg.hotMin}, cryptMax=${cfg.cryptMax}) imply "${want}"`);
  }
}

function assertDisjointPartition(out: readonly ScoredEngram[]): void {
  const subsets = TIERS.map((t) => out.filter((s) => s.tier === t));
  const total = subsets.reduce((n, sub) => n + sub.length, 0);
  if (total !== out.length) fail(`tier sizes sum to ${total}, expected ${out.length}`);
  const seen = new Set<ScoredEngram>();
  for (const sub of subsets) {
    for (const s of sub) {
      if (seen.has(s)) fail(`"${s.node.id}" is in more than one tier subset`);
      seen.add(s);
    }
  }
}

export function p10Partition(cfg: LetheConfig) {
  return fc.property(anyScoreInputArb(cfg), (input) => {
    const out = score(input);
    assertSameIds(
      input.engrams.map((e) => e.id),
      out.map((s) => s.node.id),
    );
    for (const s of out) assertEngram(s, input.cfg);
    assertDisjointPartition(out);
  });
}
