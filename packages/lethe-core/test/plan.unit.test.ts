// Unit tests for planConsolidation. Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-5, REQ-CRY-6, INV-1, INV-4, INV-6
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { planConsolidation } from "../src/consolidate/plan.js";
import type { ContradictionReport, LetheConfig, ScoredEngram, Tier } from "../src/types.js";

interface Opts {
  readonly tokens?: number;
  readonly retention?: number;
  readonly tier?: Tier;
  readonly protected?: boolean;
  readonly body?: string;
}

function mk(id: string, o: Opts = {}): ScoredEngram {
  const retention = o.retention ?? 0.7;
  return {
    node: {
      id, file: "f.md", headingPath: [id], body: o.body ?? `unique${id} words${id}`, contentHash: id,
      tokens: o.tokens ?? 10, globs: [], specLinks: [], pinned: false, span: { start: 0, end: 1 },
    },
    state: { id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    deltaC: 0, weight: 1, retention, rawRetention: retention,
    tier: o.tier ?? "hot", status: "active", protected: o.protected ?? false,
  };
}

function lost(loser: string, winner: string): ContradictionReport {
  return {
    axis: "x",
    a: { id: winner, stance: "s1", evidence: "e" },
    b: { id: loser, stance: "s2", evidence: "e" },
    severity: "high",
    resolution: { kind: "resolved", winner, loser, reason: "id" },
  };
}

const cfg = (budgetTokens: number): LetheConfig => ({ ...DEFAULT_CONFIG, budgetTokens });
const big = cfg(100_000);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const x = a[i] as T;
    a[i] = a[j] as T;
    a[j] = x;
  }
  return a;
}

describe("planConsolidation: archive", () => {
  it("archives decayed engrams with reason decayed", () => {
    const p = planConsolidation([mk("a", { retention: 0.1 }), mk("b")], [], big);
    expect(p.toArchive.map((x) => [x.engram.node.id, x.reason])).toEqual([["a", "decayed"]]);
    expect(p.toArchive[0]).not.toHaveProperty("defeatedBy");
  });

  it("does not archive retention exactly equal to cryptMax", () => {
    const p = planConsolidation([mk("a", { retention: DEFAULT_CONFIG.cryptMax })], [], big);
    expect(p.toArchive).toEqual([]);
  });

  it("archives defeated engrams with contradiction reason and smallest winner", () => {
    const reports = [lost("a", "w2"), lost("a", "w1")];
    const p = planConsolidation([mk("a"), mk("w1"), mk("w2")], reports, big);
    expect(p.toArchive).toHaveLength(1);
    expect(p.toArchive[0]?.reason).toBe("contradiction");
    expect(p.toArchive[0]?.defeatedBy).toBe("w1");
  });

  it("never archives protected engrams (decayed or contradicted)", () => {
    const s = [mk("a", { retention: 0.01, protected: true }), mk("b", { protected: true })];
    const unresolvable: ContradictionReport = {
      ...lost("b", "a"),
      resolution: { kind: "unresolvable", reason: "both-protected" },
    };
    expect(planConsolidation(s, [lost("a", "z"), unresolvable], big).toArchive).toEqual([]);
  });

  it("sorts toArchive by id", () => {
    const p = planConsolidation([mk("c", { retention: 0 }), mk("a", { retention: 0 }), mk("b", { retention: 0 })], [], big);
    expect(p.toArchive.map((x) => x.engram.node.id)).toEqual(["a", "b", "c"]);
  });
});

describe("planConsolidation: merge", () => {
  it("merges identical bodies and excludes the drop from toArchive", () => {
    const s = [mk("a", { body: "use vitest for tests", retention: 0.9 }), mk("b", { body: "use vitest for tests", retention: 0.8 })];
    const p = planConsolidation(s, [], big);
    expect(p.toMerge.map((m) => [m.keep.node.id, m.drop.node.id])).toEqual([["a", "b"]]);
    expect(p.toArchive).toEqual([]);
  });

  it("does not merge disjoint bodies", () => {
    expect(planConsolidation([mk("a"), mk("b")], [], big).toMerge).toEqual([]);
  });

  it("an engram both decayed and duplicate appears only in toArchive", () => {
    const s = [mk("a", { body: "same text here", retention: 0.9 }), mk("b", { body: "same text here", retention: 0.1 })];
    const p = planConsolidation(s, [], big);
    expect(p.toArchive.map((x) => x.engram.node.id)).toEqual(["b"]);
    expect(p.toMerge).toEqual([]);
  });

  it("resolves a duplicate chain greedily (each id dropped at most once)", () => {
    const body = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const s = [mk("a", { body, retention: 0.9 }), mk("b", { body, retention: 0.8 }), mk("c", { body, retention: 0.7 })];
    const p = planConsolidation(s, [], big);
    const drops = p.toMerge.map((m) => m.drop.node.id);
    expect(new Set(drops).size).toBe(drops.length);
    expect(drops.sort()).toEqual(["b", "c"]);
  });
});

describe("planConsolidation: budget", () => {
  it("demotes lowest retention first and computes token arithmetic", () => {
    const s = [mk("a", { tokens: 40, retention: 0.9 }), mk("b", { tokens: 40, retention: 0.62 }), mk("c", { tokens: 40, retention: 0.7 })];
    const p = planConsolidation(s, [], cfg(80));
    expect(p.toDemote).toEqual(["b"]);
    expect(p.budgetStatus).toBe("ok");
    expect(p.tokensBefore).toBe(120);
    expect(p.tokensAfter).toBe(80);
  });

  it("removed engrams free budget", () => {
    const s = [mk("a", { tokens: 50, retention: 0.1 }), mk("b", { tokens: 50 })];
    const p = planConsolidation(s, [], cfg(60));
    expect(p.toDemote).toEqual([]);
    expect(p.tokensBefore).toBe(100);
    expect(p.tokensAfter).toBe(50);
  });

  it("reports budget_infeasible when protected hot tokens alone exceed budget", () => {
    const s = [mk("p", { tokens: 90, protected: true }), mk("q", { tokens: 20 })];
    const p = planConsolidation(s, [], cfg(50));
    expect(p.budgetStatus).toBe("budget_infeasible");
    expect(p.toDemote).toEqual([]);
    expect(p.toArchive).toEqual([]);
  });
});

describe("planConsolidation: invariants", () => {
  const sample = (): ScoredEngram[] => [
    mk("a", { tokens: 40, retention: 0.9, body: "dup body words here" }),
    mk("b", { tokens: 40, retention: 0.8, body: "dup body words here" }),
    mk("c", { tokens: 40, retention: 0.1 }),
    mk("d", { tokens: 40, retention: 0.65 }),
    mk("e", { tokens: 40, retention: 0.7 }),
    mk("f", { tokens: 40 }),
  ];

  it("is idempotent for archive+merge and stable for demotion", () => {
    const reports = [lost("f", "a")];
    const c = cfg(70);
    const first = planConsolidation(sample(), reports, c);
    expect(first.toArchive.length).toBeGreaterThan(0);
    expect(first.toMerge.length).toBeGreaterThan(0);
    const gone = new Set([...first.toArchive.map((x) => x.engram.node.id), ...first.toMerge.map((m) => m.drop.node.id)]);
    const second = planConsolidation(sample().filter((e) => !gone.has(e.node.id)), reports, c);
    expect(second.toArchive).toEqual([]);
    expect(second.toMerge).toEqual([]);
    expect(second.toDemote).toEqual(first.toDemote);
    expect(second.budgetStatus).toBe(first.budgetStatus);
  });

  it("is independent of input order", () => {
    const reports = [lost("f", "a")];
    const base = planConsolidation(sample(), reports, cfg(70));
    const rnd = lcg(42);
    for (let i = 0; i < 25; i += 1) {
      expect(planConsolidation(shuffle(sample(), rnd), shuffle(reports, rnd), cfg(70))).toEqual(base);
    }
  });

  it("does not mutate frozen inputs", () => {
    const s = sample().map((e) => Object.freeze(e));
    const reports = [Object.freeze(lost("f", "a"))];
    Object.freeze(s);
    Object.freeze(reports);
    expect(() => planConsolidation(s, reports, cfg(70))).not.toThrow();
    expect(s.every((e) => e.status === "active")).toBe(true);
  });

  it("returns an empty ok plan for empty input", () => {
    expect(planConsolidation([], [], DEFAULT_CONFIG)).toEqual({
      toArchive: [], toMerge: [], toDemote: [], budgetStatus: "ok", tokensBefore: 0, tokensAfter: 0,
    });
  });
});
