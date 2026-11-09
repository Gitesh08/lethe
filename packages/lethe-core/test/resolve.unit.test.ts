import { describe, expect, it } from "vitest";
import { RETENTION_TIE_EPSILON, resolveContradiction } from "../src/contradiction/resolve.js";
import type { ScoredEngram, Tier } from "../src/types.js";

interface Opts {
  retention?: number;
  commit?: number;
  prot?: boolean;
  tier?: Tier;
}

function eg(id: string, o: Opts = {}): ScoredEngram {
  const retention = o.retention ?? 0.5;
  return {
    node: {
      id, file: "a.md", headingPath: [id], body: id, contentHash: id, tokens: 1,
      globs: [], specLinks: [], pinned: false, span: { start: 0, end: 1 },
    },
    state: { id, stability: 5, lastReinforcedCommit: o.commit ?? 10, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    deltaC: 0, weight: 1, retention, rawRetention: retention,
    tier: o.tier ?? "warm", status: "active", protected: o.prot ?? false,
  };
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

function both(x: ScoredEngram, y: ScoredEngram) {
  const fwd = resolveContradiction(x, y, "ax", "sx", "sy", "ex", "ey");
  const rev = resolveContradiction(y, x, "ax", "sy", "sx", "ey", "ex");
  expect(rev).toEqual(fwd);
  return fwd;
}

describe("resolveContradiction", () => {
  it("level 1: exactly one protected wins even with lower retention", () => {
    const r = both(eg("a", { retention: 0.9 }), eg("b", { retention: 0.1, prot: true }));
    expect(r.resolution).toEqual({ kind: "resolved", winner: "b", loser: "a", reason: "spec" });
  });

  it("both protected is unresolvable", () => {
    const r = both(eg("a", { prot: true }), eg("b", { prot: true }));
    expect(r.resolution).toEqual({ kind: "unresolvable", reason: "both-protected" });
  });

  it("level 2: higher retention wins", () => {
    const r = both(eg("a", { retention: 0.3 }), eg("b", { retention: 0.7 }));
    expect(r.resolution).toEqual({ kind: "resolved", winner: "b", loser: "a", reason: "retention" });
  });

  it("level 3: tie within epsilon falls through to recency", () => {
    const r = both(eg("a", { retention: 0.5, commit: 3 }), eg("b", { retention: 0.5 + RETENTION_TIE_EPSILON / 2, commit: 9 }));
    expect(r.resolution).toEqual({ kind: "resolved", winner: "b", loser: "a", reason: "recency" });
  });

  it("level 4: equal retention and commit -> smaller id wins", () => {
    const r = both(eg("zed"), eg("alpha"));
    expect(r.resolution).toEqual({ kind: "resolved", winner: "alpha", loser: "zed", reason: "id" });
  });

  it("severity matrix", () => {
    expect(both(eg("a", { prot: true }), eg("b")).severity).toBe("high");
    expect(both(eg("a", { tier: "hot" }), eg("b", { tier: "hot" })).severity).toBe("medium");
    expect(both(eg("a", { tier: "hot" }), eg("b", { tier: "warm" })).severity).toBe("low");
    expect(both(eg("a", { tier: "crypt" }), eg("b", { tier: "warm" })).severity).toBe("low");
  });

  it("lower id is always report.a and stance/evidence travel with it", () => {
    const r = resolveContradiction(eg("m"), eg("c"), "ax", "sm", "sc", "em", "ec");
    expect(r.a).toEqual({ id: "c", stance: "sc", evidence: "ec" });
    expect(r.b).toEqual({ id: "m", stance: "sm", evidence: "em" });
    expect(r.axis).toBe("ax");
  });

  it("equal ids order by stance then evidence, symmetrically", () => {
    const x = eg("same");
    const f = resolveContradiction(x, x, "ax", "s2", "s1", "e", "e");
    const g = resolveContradiction(x, x, "ax", "s1", "s2", "e", "e");
    expect(f).toEqual(g);
    expect(f.a.stance).toBe("s1");
  });

  it("does not mutate frozen inputs", () => {
    const x = deepFreeze(eg("a", { retention: 0.2 }));
    const y = deepFreeze(eg("b", { retention: 0.8 }));
    expect(() => resolveContradiction(x, y, "ax", "s", "t", "e", "f")).not.toThrow();
  });
});
