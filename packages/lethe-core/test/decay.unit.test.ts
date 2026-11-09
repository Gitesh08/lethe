import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { computeDeltaC } from "../src/decay/delta.js";
import { computeRetention } from "../src/decay/retention.js";
import { computeWeight } from "../src/decay/weight.js";
import { reinforce } from "../src/decay/reinforce.js";
import type { EngramNode, EngramState, LedgerEvent, SpecInvariant } from "../src/types.js";

const cfg = DEFAULT_CONFIG;

function node(over: Partial<EngramNode> = {}): EngramNode {
  return {
    id: "a.md#x",
    file: "a.md",
    headingPath: ["x"],
    body: "body",
    contentHash: "h",
    tokens: 1,
    globs: [],
    specLinks: [],
    pinned: false,
    span: { start: 0, end: 4 },
    ...over,
  };
}

function spec(specName: string, active: boolean): SpecInvariant {
  return { specName, active, requirementIds: [], stances: [] };
}

function state(over: Partial<EngramState> = {}): EngramState {
  return {
    id: "a.md#x",
    stability: 5,
    lastReinforcedCommit: 100,
    lastReinforcedAt: "2026-01-01T00:00:00Z",
    reinforcements: 0,
    ...over,
  };
}

function event(over: Partial<LedgerEvent> = {}): LedgerEvent {
  return { type: "task_passed", at: "2026-01-02T00:00:00Z", commit: 110, ...over };
}

describe("DEFAULT_CONFIG", () => {
  it("has the canonical decay constants", () => {
    expect(cfg.s0).toBe(5);
    expect(cfg.sMax).toBe(120);
    expect(cfg.beta).toBe(0.5);
    expect(cfg.alpha).toBe(0.25);
    expect(cfg.wDefault).toBe(1);
    expect(cfg.wSpec).toBe(4);
    expect(cfg.specFloor).toBe(0.5);
    expect(cfg.hotMin).toBe(0.6);
    expect(cfg.cryptMax).toBe(0.25);
    expect(cfg.budgetTokens).toBe(4000);
  });
});

describe("computeRetention", () => {
  it("matches exp(-dc/(S*W)) exactly", () => {
    expect(computeRetention(10, 5, 1, 0.5)).toBe(Math.exp(-2));
  });

  it("returns exactly 1 when deltaC is 0", () => {
    expect(computeRetention(0, 5, 1, 0.5)).toBe(1);
  });

  it("decays slower with W=4 than W=1", () => {
    expect(computeRetention(10, 5, 4, 0.5)).toBeGreaterThan(computeRetention(10, 5, 1, 0.5));
  });

  it("clamps S below sMin to sMin", () => {
    expect(computeRetention(10, 0.01, 1, 0.5)).toBe(computeRetention(10, 0.5, 1, 0.5));
  });

  it("stays in (0, 1] for huge deltaC", () => {
    const r = computeRetention(1e9, 5, 1, 0.5);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it("treats negative deltaC as 0", () => {
    expect(computeRetention(-50, 5, 1, 0.5)).toBe(1);
  });
});

describe("computeWeight", () => {
  it("pinned => wSpec, protected, specFloor", () => {
    expect(computeWeight(node({ pinned: true }), [], cfg)).toEqual({
      W: cfg.wSpec,
      isProtected: true,
      floor: cfg.specFloor,
    });
  });

  it("linked to an active spec is protected", () => {
    const r = computeWeight(node({ specLinks: ["s"] }), [spec("s", true)], cfg);
    expect(r).toEqual({ W: cfg.wSpec, isProtected: true, floor: cfg.specFloor });
  });

  it("linked to an inactive spec is not protected", () => {
    const r = computeWeight(node({ specLinks: ["s"] }), [spec("s", false)], cfg);
    expect(r).toEqual({ W: cfg.wDefault, isProtected: false, floor: 0 });
  });

  it("pinned AND spec-linked gets wSpec once, not squared", () => {
    const r = computeWeight(node({ pinned: true, specLinks: ["s"] }), [spec("s", true)], cfg);
    expect(r.W).toBe(cfg.wSpec);
  });

  it("unprotected => wDefault, false, 0", () => {
    expect(computeWeight(node(), [spec("s", true)], cfg)).toEqual({
      W: cfg.wDefault,
      isProtected: false,
      floor: 0,
    });
  });
});

describe("computeDeltaC", () => {
  it("combines commits and alpha-weighted days (10 commits + 4 days => 11)", () => {
    const s = state({ lastReinforcedCommit: 100, lastReinforcedAt: "2026-01-01T00:00:00Z" });
    expect(computeDeltaC(s, 110, "2026-01-05T00:00:00Z", cfg.alpha)).toBe(11);
  });

  it("clamps negative gaps to 0", () => {
    const s = state({ lastReinforcedCommit: 100, lastReinforcedAt: "2026-01-10T00:00:00Z" });
    expect(computeDeltaC(s, 50, "2026-01-01T00:00:00Z", cfg.alpha)).toBe(0);
  });

  it("does not produce NaN for an invalid ISO string", () => {
    const s = state();
    const a = computeDeltaC(s, 105, "not-a-date", cfg.alpha);
    const b = computeDeltaC(state({ lastReinforcedAt: "garbage" }), 105, "2026-01-05T00:00:00Z", cfg.alpha);
    expect(Number.isNaN(a)).toBe(false);
    expect(Number.isNaN(b)).toBe(false);
    expect(a).toBe(5);
    expect(b).toBe(5);
  });
});

describe("reinforce", () => {
  it("multiplies stability by 1+beta (5 -> 7.5)", () => {
    expect(reinforce(state({ stability: 5 }), event(), cfg).stability).toBe(7.5);
  });

  it("caps at sMax (100 -> 120 -> 120)", () => {
    const once = reinforce(state({ stability: 100 }), event(), cfg);
    expect(once.stability).toBe(120);
    expect(reinforce(once, event(), cfg).stability).toBe(120);
  });

  it("never lowers stability even when input exceeds sMax", () => {
    expect(reinforce(state({ stability: 500 }), event(), cfg).stability).toBe(500);
  });

  it("updates last-reinforced fields and increments reinforcements", () => {
    const out = reinforce(state({ reinforcements: 2 }), event({ commit: 150, at: "2026-02-01T00:00:00Z" }), cfg);
    expect(out.lastReinforcedCommit).toBe(150);
    expect(out.lastReinforcedAt).toBe("2026-02-01T00:00:00Z");
    expect(out.reinforcements).toBe(3);
  });

  it("does not mutate a frozen input", () => {
    const s = Object.freeze(state());
    const out = reinforce(s, event(), cfg);
    expect(out).not.toBe(s);
    expect(s.stability).toBe(5);
    expect(s.reinforcements).toBe(0);
  });

  it("P3 regression: older event timestamp does not move lastReinforcedAt back", () => {
    // Shrunk counterexample: R dropped 1 -> 3.02e-14 at the same instant.
    const s = state({
      stability: 69.14566028517173,
      lastReinforcedCommit: 4167,
      lastReinforcedAt: "2026-09-14T22:53:08.348Z",
    });
    const out = reinforce(s, event({ commit: 0, at: "1991-05-06T19:24:18.122Z" }), cfg);
    expect(out.lastReinforcedAt).toBe("2026-09-14T22:53:08.348Z");
    const now = "2026-09-14T22:53:08.348Z";
    const dBefore = computeDeltaC(s, 4167, now, cfg.alpha);
    const dAfter = computeDeltaC(out, 4167, now, cfg.alpha);
    expect(dAfter).toBeLessThanOrEqual(dBefore);
  });

  it("keeps the later commit when the event is older", () => {
    const out = reinforce(state({ lastReinforcedCommit: 200 }), event({ commit: 150 }), cfg);
    expect(out.lastReinforcedCommit).toBe(200);
  });
});

describe("floor application (composed)", () => {
  it("protected engram is lifted to specFloor; unprotected is not", () => {
    const raw = computeRetention(1000, 5, computeWeight(node({ pinned: true }), [], cfg).W, cfg.sMin);
    const w = computeWeight(node({ pinned: true }), [], cfg);
    expect(raw).toBeLessThan(cfg.specFloor);
    expect(Math.max(raw, w.floor)).toBe(cfg.specFloor);

    const wu = computeWeight(node(), [], cfg);
    const rawU = computeRetention(1000, 5, wu.W, cfg.sMin);
    expect(Math.max(rawU, wu.floor)).toBe(rawU);
  });
});
