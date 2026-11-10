// Unit tests: stable-json key order, indentation, trailing newline. Refs: Req 8.8, Req 10.12
import { describe, expect, it } from "vitest";
import { KEY_ORDERS, stableLine, stableStringify } from "../src/persist/stable-json.js";

describe("stableStringify", () => {
  it("sorts unlisted keys ascending, 2-space indent, trailing newline", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it("ends with exactly one newline and never uses CR", () => {
    const text = stableStringify({ x: ["a\r\nb"] });
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.includes("\r")).toBe(false);
  });

  it("puts listed keys first in listed order, then appends unlisted sorted", () => {
    const text = stableStringify({ zzz: 1, aaa: 2, commit: 3, version: 1, at: "t" }, KEY_ORDERS.state);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["version", "commit", "at", "aaa", "zzz"]);
  });

  it("applies nested orders (ledger cursor, engram state map)", () => {
    const value = {
      engrams: { b: { reinforcements: 1, stability: 5 }, a: { stability: 2, reinforcements: 0 } },
      ledger: { lastLineSha256: null, bytes: 0, lines: 0 },
      version: 1,
    };
    const parsed = JSON.parse(stableStringify(value, KEY_ORDERS.state)) as typeof value;
    expect(Object.keys(parsed)).toEqual(["version", "ledger", "engrams"]);
    expect(Object.keys(parsed.ledger)).toEqual(["lines", "bytes", "lastLineSha256"]);
    expect(Object.keys(parsed.engrams)).toEqual(["a", "b"]);
    expect(Object.keys(parsed.engrams.b)).toEqual(["stability", "reinforcements"]);
  });

  it("omits undefined properties, renders undefined array items as null, empties compactly", () => {
    expect(stableStringify({ a: undefined, b: [undefined], c: {}, d: [] })).toBe(
      '{\n  "b": [\n    null\n  ],\n  "c": {},\n  "d": []\n}\n',
    );
  });

  it("writes -0 as 0 and rejects non-finite numbers", () => {
    expect(stableStringify(-0)).toBe("0\n");
    expect(() => stableStringify(Number.NaN)).toThrow(TypeError);
    expect(() => stableStringify({ a: Infinity })).toThrow(TypeError);
    expect(() => stableStringify(10n)).toThrow(TypeError);
  });

  it("orders integer-like keys by code unit, not numerically", () => {
    expect(stableLine({ "10": 1, "2": 2, b: 3 })).toBe('{"10":1,"2":2,"b":3}\n');
  });
});

describe("stableLine", () => {
  it("is one compact line ending in a single newline, listed order first", () => {
    const line = stableLine({ cited: ["x"], commit: 4, type: "task_passed", at: "t" }, KEY_ORDERS.ledgerLine);
    expect(line).toBe('{"type":"task_passed","at":"t","commit":4,"cited":["x"]}\n');
    expect(line.indexOf("\n")).toBe(line.length - 1);
  });
});
