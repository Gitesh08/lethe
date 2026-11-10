// Properties: stable-json round trip and insertion-order independence. Refs: Req 8.8, Req 10.12, NFR-3
import fc from "fast-check";
import { describe, it } from "vitest";
import { expect } from "vitest";
import { stableLine, stableStringify } from "../src/persist/stable-json.js";
import { runProperty } from "./support/pbt-runner.js";

/** Tree whose objects are entry lists, so insertion order is controlled by the test. */
type Tree = null | boolean | number | string | Tree[] | { readonly entries: ReadonlyArray<readonly [string, Tree]> };

const ADVERSARIAL_KEYS = ["__proto__", "constructor", "toString", "", "10", "2", "-1", "01", "é", "\u{1F47B}", "a\u0000b", "\u2028"];
const key = fc.oneof(fc.constantFrom(...ADVERSARIAL_KEYS), fc.string({ maxLength: 6 }), fc.fullUnicodeString({ maxLength: 4 }), fc.integer({ min: 0, max: 30 }).map(String));
const num = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(-0, 0, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 1e21, 1e-7, 2 ** 53),
  fc.integer(),
);
const leaf = fc.oneof(fc.constant(null), fc.boolean(), num, fc.string({ maxLength: 8 }), fc.fullUnicodeString({ maxLength: 6 }));

const tree: fc.Arbitrary<Tree> = fc.letrec<{ t: Tree }>((tie) => ({
  t: fc.oneof(
    { depthSize: "small", maxDepth: 3 },
    leaf,
    fc.array(tie("t"), { maxLength: 4 }),
    fc.uniqueArray(fc.tuple(key, tie("t")), { selector: (e) => e[0], maxLength: 5 }).map((entries) => ({ entries })),
  ),
})).t;

function isEntries(t: Tree): t is { readonly entries: ReadonlyArray<readonly [string, Tree]> } {
  return typeof t === "object" && t !== null && !Array.isArray(t);
}

/** Builds a plain value, inserting object keys in `pick(entries)` order (own data props, safe for __proto__). */
function build(t: Tree, pick: (e: ReadonlyArray<readonly [string, Tree]>) => ReadonlyArray<readonly [string, Tree]>): unknown {
  if (Array.isArray(t)) return t.map((x) => build(x, pick));
  if (!isEntries(t)) return t;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of pick(t.entries)) {
    Object.defineProperty(obj, k, { value: build(v, pick), enumerable: true, writable: true, configurable: true });
  }
  return obj;
}

/** Same as JSON round trip does: -0 becomes 0. */
function normalise(t: Tree): unknown {
  if (Array.isArray(t)) return t.map(normalise);
  if (typeof t === "number") return Object.is(t, -0) ? 0 : t;
  return t;
}

const forward = (e: ReadonlyArray<readonly [string, Tree]>): ReadonlyArray<readonly [string, Tree]> => e;
const reversed = (e: ReadonlyArray<readonly [string, Tree]>): ReadonlyArray<readonly [string, Tree]> => [...e].reverse();
const rotated = (e: ReadonlyArray<readonly [string, Tree]>): ReadonlyArray<readonly [string, Tree]> =>
  e.length === 0 ? e : [...e.slice(1), e[0] as readonly [string, Tree]];

/** Canonical comparison form: objects as sorted [key, value] pairs (avoids __proto__ pitfalls). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object" && v !== null) {
    return Object.keys(v)
      .sort()
      .map((k) => [k, canon((Object.getOwnPropertyDescriptor(v, k) as PropertyDescriptor).value)]);
  }
  return Object.is(v, -0) ? 0 : v;
}

describe("stable-json properties", () => {
  it("parse(stableStringify(v)) round trips and re-serialises byte-identically", () => {
    runProperty("stable-json round trip", fc.property(tree, (t) => {
      const value = build(t, forward);
      const text = stableStringify(value);
      const parsed: unknown = JSON.parse(text);
      expect(canon(parsed)).toEqual(canon(value));
      expect(stableStringify(parsed)).toBe(text);
      expect(text.endsWith("\n") && !text.endsWith("\n\n")).toBe(true);
      const line = stableLine(value);
      expect(line.indexOf("\n")).toBe(line.length - 1);
      expect(canon(JSON.parse(line))).toEqual(canon(value));
    }));
  });

  it("leaf numbers survive the round trip (-0 reads back as 0)", () => {
    runProperty("stable-json numbers", fc.property(num, (n) => {
      expect(JSON.parse(stableStringify(n))).toBe(normalise(n));
    }));
  });

  it("byte-identical output for deep-equal values built with different insertion orders", () => {
    runProperty("stable-json insertion order", fc.property(tree, (t) => {
      const a = stableStringify(build(t, forward));
      expect(stableStringify(build(t, reversed))).toBe(a);
      expect(stableStringify(build(t, rotated))).toBe(a);
      expect(stableLine(build(t, reversed))).toBe(stableLine(build(t, forward)));
    }));
  });
});
