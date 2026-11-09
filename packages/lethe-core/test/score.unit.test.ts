import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { globMatch } from "../src/decay/glob.js";
import { eventMatches } from "../src/decay/match-event.js";
import { score, scoreChecked, type ScoreInput } from "../src/decay/score.js";
import { tierOf } from "../src/decay/tier.js";
import type { EngramNode, EngramState, LedgerEvent } from "../src/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

function node(id: string, extra: Partial<EngramNode> = {}): EngramNode {
  return {
    id,
    file: "a.md",
    headingPath: [id],
    body: id,
    contentHash: id,
    tokens: 1,
    globs: [],
    specLinks: [],
    pinned: false,
    span: { start: 0, end: 1 },
    ...extra,
  };
}

function state(id: string, commit: number, stability = 5): EngramState {
  return { id, stability, lastReinforcedCommit: commit, lastReinforcedAt: NOW, reinforcements: 0 };
}

function input(over: Partial<ScoreInput>): ScoreInput {
  return { engrams: [], states: [], specs: [], ledger: [], nowCommit: 100, nowISO: NOW, cfg: DEFAULT_CONFIG, ...over };
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe("globMatch", () => {
  it("handles wildcards", () => {
    expect(globMatch("*.ts", "a.ts")).toBe(true);
    expect(globMatch("*.ts", "src/a.ts")).toBe(false);
    expect(globMatch("**", "a/b/c.ts")).toBe(true);
    expect(globMatch("**/*.ts", "a.ts")).toBe(true);
    expect(globMatch("**/*.ts", "a/b/c.ts")).toBe(true);
    expect(globMatch("src/**/*.{ts,tsx}", "src/a/b.tsx")).toBe(true);
    expect(globMatch("src/**/*.{ts,tsx}", "src/b.ts")).toBe(true);
    expect(globMatch("src/**/*.{ts,tsx}", "src/b.js")).toBe(false);
    expect(globMatch("a?c", "abc")).toBe(true);
    expect(globMatch("a?c", "a/c")).toBe(false);
  });
  it("handles classes, escapes, case and path normalisation", () => {
    expect(globMatch("[abc].ts", "b.ts")).toBe(true);
    expect(globMatch("[a-c].ts", "d.ts")).toBe(false);
    expect(globMatch("[!a].ts", "b.ts")).toBe(true);
    expect(globMatch("a\\*b", "a*b")).toBe(true);
    expect(globMatch("a\\*b", "axb")).toBe(false);
    expect(globMatch("a.b", "axb")).toBe(false);
    expect(globMatch("A.ts", "a.ts")).toBe(false);
    expect(globMatch("src/**/*.ts", "src\\x\\y.ts")).toBe(true);
    expect(globMatch("./src/*.ts", "./src/a.ts")).toBe(true);
  });
  it("is total on invalid or oversized input", () => {
    expect(globMatch("[abc", "a")).toBe(false);
    expect(globMatch("{a,b", "a")).toBe(false);
    expect(globMatch("[z-a]", "a")).toBe(false);
    expect(globMatch("a".repeat(513), "a".repeat(513))).toBe(false);
    expect(globMatch("*", "a".repeat(1025))).toBe(false);
  });
});

describe("eventMatches", () => {
  const n = node("n1", { globs: ["src/**/*.ts"], specLinks: ["core"] });
  const base = { at: NOW, commit: 1 } as const;
  it("task_passed matches via globs, id, or specLinks", () => {
    expect(eventMatches(n, { ...base, type: "task_passed", filesTouched: ["src/a/b.ts"] })).toBe(true);
    expect(eventMatches(n, { ...base, type: "task_passed", cited: ["n1"] })).toBe(true);
    expect(eventMatches(n, { ...base, type: "task_passed", cited: ["core"] })).toBe(true);
    expect(eventMatches(n, { ...base, type: "task_passed", filesTouched: ["x.md"] })).toBe(false);
    expect(eventMatches(n, { ...base, type: "task_passed" })).toBe(false);
  });
  it("spec_cited and manual_pin never match via globs", () => {
    for (const type of ["spec_cited", "manual_pin"] as const) {
      expect(eventMatches(n, { ...base, type, filesTouched: ["src/a.ts"] })).toBe(false);
      expect(eventMatches(n, { ...base, type, cited: ["n1"] })).toBe(true);
      expect(eventMatches(n, { ...base, type, cited: ["core"] })).toBe(true);
    }
  });
});

describe("tierOf", () => {
  it("uses exact thresholds", () => {
    expect(tierOf(0.6, DEFAULT_CONFIG)).toBe("hot");
    expect(tierOf(0.5999999999999999, DEFAULT_CONFIG)).toBe("warm");
    expect(tierOf(0.25, DEFAULT_CONFIG)).toBe("warm");
    expect(tierOf(0.2499999999999999, DEFAULT_CONFIG)).toBe("crypt");
  });
});

describe("score", () => {
  it("synthesises missing state with retention exactly 1", () => {
    const [r] = score(input({ engrams: [node("a")] }));
    expect(r?.retention).toBe(1);
    expect(r?.deltaC).toBe(0);
    expect(r?.state.stability).toBe(DEFAULT_CONFIG.s0);
    expect(r?.tier).toBe("hot");
  });
  it("ignores future ledger events and applies past ones", () => {
    const n = node("a", { globs: ["*.ts"] });
    const ev = (commit: number): LedgerEvent => ({ type: "task_passed", at: NOW, commit, filesTouched: ["x.ts"] });
    const future = score(input({ engrams: [n], states: [state("a", 0)], ledger: [ev(101)] }));
    expect(future[0]?.state.reinforcements).toBe(0);
    const past = score(input({ engrams: [n], states: [state("a", 0)], ledger: [ev(50)] }));
    expect(past[0]?.state.reinforcements).toBe(1);
    expect(past[0]?.state.lastReinforcedCommit).toBe(50);
  });
  it("floors protected engrams at specFloor", () => {
    const [r] = score(input({ engrams: [node("p", { pinned: true })], states: [state("p", 0, 0.5)] }));
    expect(r?.rawRetention).toBeLessThan(DEFAULT_CONFIG.specFloor);
    expect(r?.retention).toBe(DEFAULT_CONFIG.specFloor);
    expect(r?.protected).toBe(true);
    expect(r?.weight).toBe(DEFAULT_CONFIG.wSpec);
  });
  it("sorts by tier, retention desc, then id, independent of input order", () => {
    const engrams = ["d", "c", "b", "a"].map((id) => node(id));
    const states = [state("a", 100), state("b", 100), state("c", 60), state("d", 0)];
    const out = score(input({ engrams, states })).map((s) => s.node.id);
    expect(out).toEqual(["a", "b", "c", "d"]);
    expect(score(input({ engrams: [...engrams].reverse(), states })).map((s) => s.node.id)).toEqual(out);
  });
  it("does not mutate frozen inputs", () => {
    const i = deepFreeze(
      input({
        engrams: [node("a", { globs: ["*.ts"] })],
        states: [state("a", 0)],
        ledger: [{ type: "task_passed", at: NOW, commit: 5, filesTouched: ["x.ts"] }],
      }),
    );
    expect(() => score(i)).not.toThrow();
  });
});

describe("scoreChecked", () => {
  it("rejects invalid cfg and bad nowCommit", () => {
    const bad = scoreChecked(input({ cfg: { ...DEFAULT_CONFIG, s0: -1 } }));
    expect(!bad.ok && bad.error.code).toBe("CONFIG_INVALID");
    const neg = scoreChecked(input({ nowCommit: -1 }));
    expect(!neg.ok && neg.error.code).toBe("CONFIG_INVALID");
    const nan = scoreChecked(input({ nowCommit: Number.NaN }));
    expect(!nan.ok && nan.error.code).toBe("CONFIG_INVALID");
  });
  it("scores on valid input", () => {
    const r = scoreChecked(input({ engrams: [node("a")] }));
    expect(r.ok && r.value.length).toBe(1);
  });
});
