import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { findDuplicates } from "../src/consolidate/dedupe.js";
import { jaccardSets, tokenize } from "../src/consolidate/jaccard.js";
import type { LetheConfig, ScoredEngram } from "../src/types.js";

// Validates: REQ-CRY-5 (indexed candidate generation is bit-identical to the O(n^2) scan)

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function eng(id: string, body: string, retention: number, prot: boolean): ScoredEngram {
  return {
    node: {
      id, file: "f.md", headingPath: [id], body, contentHash: id, tokens: 1,
      globs: [], specLinks: [], pinned: false, span: { start: 0, end: body.length },
    },
    state: { id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    deltaC: 0, weight: 1, retention, rawRetention: retention, tier: "warm", status: "active", protected: prot,
  };
}

/** Straight O(n^2) transcription of the documented algorithm. */
function reference(scored: readonly ScoredEngram[], threshold: number) {
  const entries = scored
    .map((e) => ({ e, set: tokenize(e.node.body) }))
    .filter((x) => x.set.size > 0)
    .sort((x, y) => (x.e.node.id < y.e.node.id ? -1 : x.e.node.id > y.e.node.id ? 1 : 0));
  const cands: Array<{ a: (typeof entries)[number]; b: (typeof entries)[number]; similarity: number }> = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (a === undefined || b === undefined || a.e.node.id === b.e.node.id) continue;
      if (a.e.protected && b.e.protected) continue;
      const similarity = jaccardSets(a.set, b.set);
      if (similarity >= threshold) cands.push({ a, b, similarity });
    }
  }
  cands.sort((x, y) => {
    if (x.similarity !== y.similarity) return x.similarity > y.similarity ? -1 : 1;
    if (x.a.e.node.id !== y.a.e.node.id) return x.a.e.node.id < y.a.e.node.id ? -1 : 1;
    return x.b.e.node.id < y.b.e.node.id ? -1 : x.b.e.node.id > y.b.e.node.id ? 1 : 0;
  });
  const dropped = new Set<string>();
  const out: Array<{ keep: string; drop: string; similarity: number }> = [];
  for (const c of cands) {
    if (dropped.has(c.a.e.node.id) || dropped.has(c.b.e.node.id)) continue;
    const x = c.a.e;
    const y = c.b.e;
    const aKeeps = x.protected !== y.protected ? x.protected : x.retention !== y.retention ? x.retention > y.retention : x.node.id < y.node.id;
    const [keep, drop] = aKeeps ? [x, y] : [y, x];
    dropped.add(drop.node.id);
    out.push({ keep: keep.node.id, drop: drop.node.id, similarity: c.similarity });
  }
  return out;
}

describe("findDuplicates equals the brute-force reference", () => {
  it("matches on 200 LCG-generated sets (pairs, order, similarity)", () => {
    const vocab = Array.from({ length: 14 }, (_, i) => `t${i}`);
    for (let seed = 1; seed <= 200; seed += 1) {
      const rnd = lcg(seed * 7919);
      const n = 2 + Math.floor(rnd() * 24);
      const set: ScoredEngram[] = [];
      for (let k = 0; k < n; k += 1) {
        const len = Math.floor(rnd() * 9);
        const body = Array.from({ length: len }, () => vocab[Math.floor(rnd() * vocab.length)] ?? "t0").join(" ");
        const id = `e${String(Math.floor(rnd() * (n + 2))).padStart(2, "0")}`; // ids may repeat
        set.push(eng(id, body, Math.floor(rnd() * 4) / 4, rnd() < 0.2));
      }
      const threshold = [0.3, 0.5, 0.85][seed % 3] ?? 0.85;
      const cfg: LetheConfig = { ...DEFAULT_CONFIG, dedupeJaccard: threshold };
      const actual = findDuplicates(set, cfg).map((p) => ({ keep: p.keep.node.id, drop: p.drop.node.id, similarity: p.similarity }));
      expect(actual, `seed ${seed}`).toEqual(reference(set, threshold));
    }
  });
});
