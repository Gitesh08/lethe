import { describe, it, expect } from "vitest";
import { findDuplicates } from "../src/consolidate/dedupe.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { LetheConfig, ScoredEngram } from "../src/types.js";

// Validates: REQ-CRY-5
function eng(
  id: string,
  body: string,
  opts: { retention?: number; protected?: boolean } = {},
): ScoredEngram {
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
    retention: opts.retention ?? 0.5,
    rawRetention: opts.retention ?? 0.5,
    tier: "warm",
    status: "active",
    protected: opts.protected ?? false,
  });
}

const cfg: LetheConfig = DEFAULT_CONFIG;
const words = (n: number, prefix = "w"): string =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

const ids = (ps: ReturnType<typeof findDuplicates>): string[] =>
  ps.map((p) => `${p.keep.node.id}>${p.drop.node.id}`);

describe("findDuplicates", () => {
  it("returns [] when nothing is similar", () => {
    expect(findDuplicates([eng("a", "x y z"), eng("b", "p q r")], cfg)).toEqual([]);
    expect(findDuplicates([], cfg)).toEqual([]);
  });

  it("exact duplicates: higher retention is kept", () => {
    const r = findDuplicates([eng("a", "use vitest", { retention: 0.3 }), eng("b", "use vitest", { retention: 0.7 })], cfg);
    expect(ids(r)).toEqual(["b>a"]);
    expect(r[0]?.similarity).toBe(1);
  });

  it("retention tie: smaller id is kept", () => {
    const r = findDuplicates([eng("z", "use vitest"), eng("m", "use vitest")], cfg);
    expect(ids(r)).toEqual(["m>z"]);
  });

  it("similarity exactly equal to the threshold counts as duplicate", () => {
    const shared = words(17, "s");
    const a = eng("a", `${shared} onlya`);
    const b = eng("b", `${shared} onlyb1 onlyb2`); // 17 / 20 = 0.85
    expect(ids(findDuplicates([a, b], cfg))).toEqual(["a>b"]);
    const c = eng("c", `${shared} onlyc1 onlyc2 onlyc3`); // 17/21 < 0.85
    expect(findDuplicates([a, c], cfg)).toEqual([]);
  });

  it("transitive chain resolves deterministically, survivors contain no similar pair", () => {
    const loose: LetheConfig = { ...cfg, dedupeJaccard: 0.6 };
    const a = eng("a", "t1 t2 t3 t4 t5 t6", { retention: 0.9 });
    const b = eng("b", "t2 t3 t4 t5 t6 t7", { retention: 0.5 });
    const c = eng("c", "t3 t4 t5 t6 t7 t8", { retention: 0.4 });
    const r = findDuplicates([c, b, a], loose);
    expect(ids(r)).toEqual(["a>b"]);
    expect(findDuplicates([a, c], loose)).toEqual([]);
  });

  it("a protected engram absorbs an unprotected duplicate even with lower retention", () => {
    const p = eng("p", "same body here", { retention: 0.1, protected: true });
    const u = eng("u", "same body here", { retention: 0.9 });
    expect(ids(findDuplicates([u, p], cfg))).toEqual(["p>u"]);
  });

  it("protected is never dropped; both protected is ignored", () => {
    const p1 = eng("a", "same body here", { protected: true });
    const p2 = eng("b", "same body here", { protected: true });
    expect(findDuplicates([p1, p2], cfg)).toEqual([]);
    for (const p of findDuplicates([p1, eng("c", "same body here")], cfg)) {
      expect(p.drop.protected).toBe(false);
    }
  });

  it("never pairs an engram with a same-id twin", () => {
    expect(findDuplicates([eng("a", "x y z"), eng("a", "x y z")], cfg)).toEqual([]);
  });

  it("skips engrams with no tokens", () => {
    expect(findDuplicates([eng("a", "!!!"), eng("b", "...")], cfg)).toEqual([]);
  });

  it("detects CJK duplicates", () => {
    const r = findDuplicates([eng("a", "使用 信号 状态"), eng("b", "状态 使用 信号")], cfg);
    expect(ids(r)).toEqual(["a>b"]);
  });

  it("is independent of input order and does not mutate inputs", () => {
    const base = [
      eng("a", words(10), { retention: 0.2 }),
      eng("b", words(10), { retention: 0.8 }),
      eng("c", `${words(10)} extra`, { retention: 0.5 }),
      eng("d", words(10, "q")),
      eng("e", words(10, "q"), { retention: 0.9 }),
      eng("f", "unrelated words only"),
    ];
    const frozen = Object.freeze([...base]);
    const expected = ids(findDuplicates(frozen, { ...cfg, dedupeJaccard: 0.8 }));
    expect(expected.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(ids(findDuplicates(shuffle(base, seed), { ...cfg, dedupeJaccard: 0.8 }))).toEqual(expected);
    }
  });

  // Wall-clock bound lives in dedupe.perf.test.ts (runs serially).
  it("handles 500 engrams with 5 injected duplicates", () => {
    const all: ScoredEngram[] = [];
    for (let i = 0; i < 500; i += 1) {
      all.push(eng(`e${String(i).padStart(3, "0")}`, words(60, `u${i}_`), { retention: 0.5 }));
    }
    for (let k = 0; k < 5; k += 1) {
      const src = all[k * 10];
      if (src === undefined) throw new Error("fixture");
      const body = src.node.body.replace(/\S+$/u, "changed");
      all.push(eng(`dup${k}`, body, { retention: 0.1 }));
    }
    const r = findDuplicates(all, cfg);
    expect(r).toHaveLength(5);
    expect(r.every((p) => p.drop.node.id.startsWith("dup"))).toBe(true);
  });
});
