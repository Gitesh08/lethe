// Wall-clock bound for findDuplicates. Runs in the serial `perf` pass (see vitest.config.ts).
import { describe, it, expect } from "vitest";
import { findDuplicates } from "../src/consolidate/dedupe.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ScoredEngram } from "../src/types.js";

// Validates: REQ-CRY-5
function eng(id: string, body: string, retention: number): ScoredEngram {
  return Object.freeze({
    node: Object.freeze({
      id,
      file: "f.md",
      headingPath: Object.freeze([id]),
      body,
      contentHash: id,
      tokens: Math.ceil(body.length / 4),
      globs: Object.freeze([]),
      specLinks: Object.freeze([]),
      pinned: false,
      span: Object.freeze({ start: 0, end: body.length }),
    }),
    state: Object.freeze({
      id,
      stability: 5,
      lastReinforcedCommit: 0,
      lastReinforcedAt: "2026-01-01T00:00:00.000Z",
      reinforcements: 0,
    }),
    deltaC: 0,
    weight: 1,
    retention,
    rawRetention: retention,
    tier: "warm",
    status: "active",
    protected: false,
  });
}

const words = (n: number, prefix: string): string =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

describe("findDuplicates (perf)", () => {
  it("handles 500 engrams with 5 injected duplicates in < 500 ms", () => {
    const all: ScoredEngram[] = [];
    for (let i = 0; i < 500; i += 1) {
      all.push(eng(`e${String(i).padStart(3, "0")}`, words(60, `u${i}_`), 0.5));
    }
    for (let k = 0; k < 5; k += 1) {
      const src = all[k * 10];
      if (src === undefined) throw new Error("fixture");
      all.push(eng(`dup${k}`, src.node.body.replace(/\S+$/u, "changed"), 0.1));
    }
    const start = performance.now();
    const r = findDuplicates(all, DEFAULT_CONFIG);
    const elapsed = performance.now() - start;
    expect(r).toHaveLength(5);
    expect(elapsed).toBeLessThan(500);
  });
});
