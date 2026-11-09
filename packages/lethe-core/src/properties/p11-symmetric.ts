// P11: detect(a,b) and detect(b,a) report the same pair; output is order-independent and canonical.
// Refs: REQ-CON-3, INV-5, REQ-PBT-1

import fc from "fast-check";
import { contradictionInputArb, contradictionPairArb } from "./arbitraries/contradiction.arb.js";
import { detectContradictions } from "../contradiction/detect.js";
import type { ContradictionReport, LetheConfig, ScoredEngram, SpecInvariant } from "../types.js";

export const P11_ID = "P11";

function fail(msg: string): never {
  throw new Error(`${P11_ID} violated: ${msg}`);
}

type Reports = readonly ContradictionReport[];

function run(scored: readonly ScoredEngram[], specs: readonly SpecInvariant[], label: string): Reports {
  const r = detectContradictions(scored, specs);
  if (!r.ok) return fail(`detectContradictions failed on ${label}: ${r.error.code} ${r.error.message}`);
  return r.value;
}

function firstDiff(x: Reports, y: Reports): string {
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = JSON.stringify(x[i]);
    const q = JSON.stringify(y[i]);
    if (p !== q) return `report #${i}: ${p ?? "<missing>"} vs ${q ?? "<missing>"}`;
  }
  return "<none>";
}

function rotated<T>(xs: readonly T[], k: number): readonly T[] {
  if (xs.length === 0) return xs;
  const s = k % xs.length;
  return [...xs.slice(s), ...xs.slice(0, s)];
}

function cmp(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function assertCanonical(reports: Reports, ctx: string): void {
  const seen = new Set<string>();
  reports.forEach((r, i) => {
    if (!(r.a.id < r.b.id)) fail(`${ctx}: a.id must be < b.id (${r.a.id} / ${r.b.id})`);
    if (r.a.id === r.b.id) fail(`${ctx}: self-pair ${r.a.id}`);
    const key = JSON.stringify([r.axis, r.a.id, r.b.id]);
    if (seen.has(key)) fail(`${ctx}: duplicate report for ${key}`);
    seen.add(key);
    const prev = reports[i - 1];
    if (prev !== undefined && (cmp(prev.axis, r.axis) || cmp(prev.a.id, r.a.id) || cmp(prev.b.id, r.b.id)) > 0) {
      fail(`${ctx}: output not sorted by (axis, a.id, b.id) at #${i}`);
    }
  });
}

function check(scored: readonly ScoredEngram[], specs: readonly SpecInvariant[]): void {
  const base = run(scored, specs, "original");
  assertCanonical(base, "original");
  const variants: ReadonlyArray<readonly [string, readonly ScoredEngram[]]> = [
    ["reversed", [...scored].reverse()],
    ["rotated", rotated(scored, 1 + (scored.length > 2 ? 1 : 0))],
  ];
  for (const [label, perm] of variants) {
    const other = run(perm, specs, label);
    assertCanonical(other, label);
    if (JSON.stringify(base) !== JSON.stringify(other)) {
      fail(`${label} permutation changed output; first diff ${firstDiff(base, other)}`);
    }
  }
}

export function p11Symmetric(cfg: LetheConfig) {
  return fc.property(fc.oneof(contradictionPairArb(cfg), contradictionInputArb(cfg)), ({ scored, specs }) => {
    check(scored, specs);
  });
}
