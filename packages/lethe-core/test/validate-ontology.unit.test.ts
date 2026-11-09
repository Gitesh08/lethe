import { describe, expect, it } from "vitest";
import { DEFAULT_AXES } from "../src/contradiction/default-ontology.js";
import { mergeOntology } from "../src/contradiction/merge-ontology.js";
import { validateOntology } from "../src/contradiction/validate-ontology.js";
import type { Axis } from "../src/types.js";

const st = (id: string, patterns: readonly string[]) => ({
  id,
  label: id,
  patterns,
  negationAware: true,
});
const ax = (id: string, stances: Axis["stances"], description = `d-${id}`): Axis => ({
  id,
  description,
  stances,
});

function deepFreeze<T>(o: T): T {
  if (typeof o === "object" && o !== null) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

describe("validateOntology", () => {
  it("compiles DEFAULT_AXES preserving order and ids", () => {
    const r = validateOntology(DEFAULT_AXES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((a) => a.id)).toEqual(DEFAULT_AXES.map((a) => a.id));
    DEFAULT_AXES.forEach((a, i) => {
      expect(r.value[i]?.stances.map((s) => s.id)).toEqual(a.stances.map((s) => s.id));
    });
  });

  it("reports invalid regex with exact detail", () => {
    const r = validateOntology([ax("a", [st("s", ["ok", "("])])]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
    expect(r.error.detail).toEqual({ axis: "a", stance: "s", pattern: "(" });
  });

  it("returns the first failure in axis/stance/pattern order", () => {
    const r = validateOntology([
      ax("a", [st("s1", ["x"]), st("s2", ["(", "["])]),
      ax("b", [st("s3", ["("])]),
    ]);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.detail).toEqual({ axis: "a", stance: "s2", pattern: "(" });
  });

  it("validates all axes before success (last axis invalid)", () => {
    const r = validateOntology([ax("a", [st("s", ["x"])]), ax("b", [st("t", ["y"])]), ax("c", [st("u", ["["])])]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate axis ids", () => {
    const r = validateOntology([ax("a", [st("s", ["x"])]), ax("a", [st("t", ["y"])])]);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate stance ids", () => {
    expect(validateOntology([ax("a", [st("s", ["x"]), st("s", ["y"])])]).ok).toBe(false);
  });

  it("rejects stances with zero patterns", () => {
    expect(validateOntology([ax("a", [st("s", [])])]).ok).toBe(false);
  });

  it("rejects empty axis and stance ids", () => {
    expect(validateOntology([ax("", [st("s", ["x"])])]).ok).toBe(false);
    expect(validateOntology([ax("a", [st("", ["x"])])]).ok).toBe(false);
  });

  it("rejects patterns matching the empty string", () => {
    const r = validateOntology([ax("a", [st("s", ["a*"])])]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
  });

  it("rejects over-long patterns", () => {
    expect(validateOntology([ax("a", [st("s", ["a".repeat(513)])])]).ok).toBe(false);
    expect(validateOntology([ax("a", [st("s", ["a".repeat(512)])])]).ok).toBe(true);
  });

  it("compiles with the i flag and without g/y", () => {
    const r = validateOntology(DEFAULT_AXES);
    if (!r.ok) throw new Error("expected ok");
    for (const a of r.value) {
      for (const s of a.stances) {
        for (const re of s.regexes) {
          expect(re.flags).toContain("i");
          expect(re.flags).not.toMatch(/[gy]/);
        }
      }
    }
  });
});

describe("mergeOntology", () => {
  const base = deepFreeze([
    ax("a", [st("s1", ["one"]), st("s2", ["two"])], "base-a"),
    ax("b", [st("s3", ["three"])]),
  ]);

  it("replaces a same-id stance and keeps the base description", () => {
    const ext = deepFreeze([ax("a", [st("s2", ["TWO"])], "")]);
    const m = mergeOntology(base, ext);
    expect(m[0]?.description).toBe("base-a");
    expect(m[0]?.stances.map((s) => s.patterns)).toEqual([["one"], ["TWO"]]);
  });

  it("extension description wins and new stances append", () => {
    const m = mergeOntology(base, deepFreeze([ax("a", [st("s9", ["nine"])], "new-desc")]));
    expect(m[0]?.description).toBe("new-desc");
    expect(m[0]?.stances.map((s) => s.id)).toEqual(["s1", "s2", "s9"]);
  });

  it("appends new axes after base order", () => {
    const m = mergeOntology(base, deepFreeze([ax("z", [st("sz", ["z"])]), ax("y", [st("sy", ["y"])])]));
    expect(m.map((a) => a.id)).toEqual(["a", "b", "z", "y"]);
  });

  it("returns an equal copy for undefined or empty extension", () => {
    for (const ext of [undefined, []] as const) {
      const m = mergeOntology(base, ext);
      expect(m).toEqual(base);
      expect(m).not.toBe(base);
    }
  });

  it("is deterministic and does not mutate (frozen inputs)", () => {
    const ext = deepFreeze([ax("a", [st("s1", ["X"])]), ax("n", [st("sn", ["n"])])]);
    expect(mergeOntology(base, ext)).toEqual(mergeOntology(base, ext));
    expect(base[0]?.stances[0]?.patterns).toEqual(["one"]);
  });
});
