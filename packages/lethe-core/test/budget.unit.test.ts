// Unit tests for computeBudget. Refs: REQ-CRY-2, INV-1, INV-6
import { describe, expect, it } from "vitest";
import { computeBudget } from "../src/consolidate/budget.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { LetheConfig, ScoredEngram, Tier } from "../src/types.js";

interface Opts {
  readonly tokens: number;
  readonly retention?: number;
  readonly tier?: Tier;
  readonly protected?: boolean;
}

function mk(id: string, o: Opts): ScoredEngram {
  return {
    node: {
      id, file: "f.md", headingPath: [id], body: id, contentHash: id, tokens: o.tokens,
      globs: [], specLinks: [], pinned: false, span: { start: 0, end: 1 },
    },
    state: { id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    deltaC: 0, weight: 1, retention: o.retention ?? 0.7, rawRetention: o.retention ?? 0.7,
    tier: o.tier ?? "hot", status: "active", protected: o.protected ?? false,
  };
}

const cfg = (budgetTokens: number): LetheConfig => ({ ...DEFAULT_CONFIG, budgetTokens });
const none: ReadonlySet<string> = new Set();

describe("computeBudget", () => {
  it("is ok with no demotion under budget", () => {
    const r = computeBudget([mk("a", { tokens: 10 }), mk("b", { tokens: 20 })], none, cfg(100));
    expect(r).toEqual({ status: "ok", demotion: [], tokensBefore: 30, tokensAfter: 30 });
  });

  it("demotes lowest retention first and stops once under budget", () => {
    const s = [
      mk("a", { tokens: 40, retention: 0.9 }),
      mk("b", { tokens: 40, retention: 0.62 }),
      mk("c", { tokens: 40, retention: 0.7 }),
    ];
    const r = computeBudget(s, none, cfg(80));
    expect(r.demotion).toEqual(["b"]);
    expect(r.tokensAfter).toBe(80);
    expect(computeBudget(s, none, cfg(50)).demotion).toEqual(["b", "c"]);
  });

  it("breaks retention ties by ascending id", () => {
    const s = [mk("z", { tokens: 10 }), mk("a", { tokens: 10 }), mk("m", { tokens: 10 })];
    expect(computeBudget(s, none, cfg(20)).demotion).toEqual(["a"]);
    expect(computeBudget(s, none, cfg(10)).demotion).toEqual(["a", "m"]);
  });

  it("excludes removed ids from the hot count but not from tokensBefore", () => {
    const s = [mk("a", { tokens: 60 }), mk("b", { tokens: 60 })];
    const r = computeBudget(s, new Set(["a"]), cfg(70));
    expect(r).toEqual({ status: "ok", demotion: [], tokensBefore: 120, tokensAfter: 60 });
  });

  it("never demotes protected engrams", () => {
    const s = [
      mk("p", { tokens: 50, retention: 0.1, protected: true }),
      mk("q", { tokens: 50, retention: 0.9 }),
    ];
    const r = computeBudget(s, none, cfg(60));
    expect(r.demotion).toEqual(["q"]);
    expect(r.tokensAfter).toBe(50);
  });

  it("ignores removal of protected engrams defensively", () => {
    const s = [mk("p", { tokens: 50, protected: true })];
    expect(computeBudget(s, new Set(["p"]), cfg(100)).tokensAfter).toBe(50);
  });

  it("reports budget_infeasible with empty demotion when protected alone exceeds budget", () => {
    const s = [
      mk("p", { tokens: 80, protected: true }),
      mk("q", { tokens: 30, retention: 0.1 }),
      mk("r", { tokens: 30, retention: 0.2 }),
    ];
    const r = computeBudget(s, new Set(["r"]), cfg(50));
    expect(r).toEqual({ status: "budget_infeasible", demotion: [], tokensBefore: 140, tokensAfter: 110 });
  });

  it("treats exactly the budget as ok and budget+1 as demoting", () => {
    const s = [mk("a", { tokens: 50 }), mk("b", { tokens: 50 })];
    expect(computeBudget(s, none, cfg(100)).demotion).toEqual([]);
    expect(computeBudget(s, none, cfg(99)).demotion).toEqual(["a"]);
  });

  it("skips zero-token engrams", () => {
    const s = [mk("z", { tokens: 0, retention: 0.1 }), mk("a", { tokens: 30, retention: 0.8 })];
    expect(computeBudget(s, none, cfg(10)).demotion).toEqual(["a"]);
  });

  it("ignores warm and crypt engrams", () => {
    const s = [
      mk("w", { tokens: 500, tier: "warm" }),
      mk("c", { tokens: 500, tier: "crypt" }),
      mk("h", { tokens: 10 }),
    ];
    expect(computeBudget(s, none, cfg(20))).toEqual({ status: "ok", demotion: [], tokensBefore: 10, tokensAfter: 10 });
  });

  it("does not mutate frozen inputs", () => {
    const s = Object.freeze([mk("a", { tokens: 60 }), mk("b", { tokens: 60, retention: 0.61 })]);
    const rem: ReadonlySet<string> = new Set<string>();
    expect(computeBudget(s, rem, cfg(70)).demotion).toEqual(["b"]);
    expect(s.map((e) => e.node.id)).toEqual(["a", "b"]);
  });

  it("is independent of input order", () => {
    const s = [
      mk("a", { tokens: 30, retention: 0.8 }),
      mk("b", { tokens: 30, retention: 0.6 }),
      mk("c", { tokens: 30, retention: 0.6 }),
      mk("d", { tokens: 30, retention: 0.7, protected: true }),
    ];
    const base = computeBudget(s, none, cfg(70));
    expect(computeBudget([...s].reverse(), none, cfg(70))).toEqual(base);
    expect(computeBudget([s[2] as ScoredEngram, s[0] as ScoredEngram, s[3] as ScoredEngram, s[1] as ScoredEngram], none, cfg(70))).toEqual(base);
  });

  it("holds invariants over 200 deterministic pseudo-random sets", () => {
    let seed = 12345;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const tiers: readonly Tier[] = ["hot", "hot", "warm", "crypt"];
    for (let i = 0; i < 200; i++) {
      const count = next(12);
      const s: ScoredEngram[] = [];
      for (let j = 0; j < count; j++) {
        s.push(mk(`e${j}`, {
          tokens: next(60), retention: next(100) / 100 + 0.001,
          tier: tiers[next(4)] as Tier, protected: next(5) === 0,
        }));
      }
      const removed = new Set(s.filter(() => next(6) === 0).map((e) => e.node.id));
      const budget = next(200);
      const r = computeBudget(s, removed, cfg(budget));
      const protectedIds = new Set(s.filter((e) => e.protected).map((e) => e.node.id));
      if (r.status === "ok") expect(r.tokensAfter).toBeLessThanOrEqual(budget);
      else expect(r.demotion).toEqual([]);
      for (const id of r.demotion) expect(protectedIds.has(id)).toBe(false);
    }
  });
});
