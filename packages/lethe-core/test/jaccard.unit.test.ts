import { describe, it, expect } from "vitest";
import { jaccard, tokenize } from "../src/consolidate/jaccard.js";

// Validates: REQ-CRY-5, REQ-CRY-13
describe("jaccard", () => {
  it("identical => 1", () => {
    expect(jaccard("use vitest always", "use vitest always")).toBe(1);
  });

  it("disjoint => 0", () => {
    expect(jaccard("a b c", "x y z")).toBe(0);
  });

  it("known fraction", () => {
    expect(jaccard("a b c", "b c d")).toBe(0.5);
  });

  it("is case, punctuation and order insensitive", () => {
    expect(jaccard("Use TAILWIND, always!", "always use tailwind")).toBe(1);
  });

  it("hyphen and dot split tokens instead of fusing", () => {
    expect(jaccard("foo-bar", "foo bar")).toBe(1);
    expect([...tokenize("a.b")]).toEqual(["a", "b"]);
  });

  it("handles CJK", () => {
    expect(jaccard("使用 信号 状态", "状态 信号 使用")).toBe(1);
    const diff = jaccard("使用 信号 状态", "使用 钩子 状态");
    expect(diff).toBeLessThan(1);
    expect(diff).toBeGreaterThan(0);
    expect(jaccard("使用 信号", "钩子 缓存")).toBe(0);
    expect(tokenize("使用 信号").size).toBe(2);
  });

  it("handles Arabic and Hebrew", () => {
    expect(jaccard("استخدم الإشارات دائما", "دائما الإشارات استخدم")).toBe(1);
    expect(jaccard("השתמש באותות תמיד", "תמיד באותות השתמש")).toBe(1);
    expect(jaccard("استخدم الإشارات", "השתמש באותות")).toBe(0);
  });

  it("keeps combining marks inside tokens", () => {
    expect([...tokenize("हिन्दी")]).toEqual(["हिन्दी"]);
    expect([...tokenize("مَرْحَبًا")]).toEqual(["مَرْحَبًا"]);
  });

  it("NFC and NFD forms compare equal", () => {
    expect(jaccard("caf\u00e9 au lait", "cafe\u0301 au lait")).toBe(1);
  });

  it("ignores zero-width characters", () => {
    expect(jaccard("use\u200Bvitest", "usevitest")).toBe(1);
    expect(jaccard("a\uFEFF b", "a b")).toBe(1);
  });

  it("empty cases => 0", () => {
    expect(jaccard("", "")).toBe(0);
    expect(jaccard("", "a b")).toBe(0);
    expect(jaccard("a b", "")).toBe(0);
    expect(jaccard("   \n\t ", "  ")).toBe(0);
    expect(jaccard("!!! ...", "???")).toBe(0);
  });

  it("is exactly symmetric and within [0,1]", () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ["a b c d e", "c d e f"],
      ["使用 信号", "使用 钩子 缓存"],
      ["x", "x y z w"],
      ["", "a"],
      ["Use Redux, never Context!", "never use redux"],
    ];
    for (const [a, b] of pairs) {
      const ab = jaccard(a, b);
      expect(ab).toBe(jaccard(b, a));
      expect(ab).toBeGreaterThanOrEqual(0);
      expect(ab).toBeLessThanOrEqual(1);
    }
  });

  it("only tokenises the first 100k chars", () => {
    const head = "a ".repeat(50_000);
    expect(jaccard(head + " zzz", head)).toBe(1);
  });

  it("very long input is handled (timing bound in jaccard.perf.test.ts)", () => {
    const long = "word-token ".repeat(20_000); // ~220k chars
    expect(jaccard(long, long + " extra")).toBeGreaterThan(0);
  });
});
