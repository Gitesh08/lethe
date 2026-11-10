// Property: state.json parse/serialise round trip. Refs: Req 10.6, Req 10.12, NFR-3
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseStateText } from "../src/load/state-file.js";
import type { LedgerCursor } from "../src/persist/ledger-cursor.js";
import { serializeState } from "../src/persist/state-serialize.js";
import type { StateFileData } from "../src/persist/state-serialize.js";
import { runProperty } from "./support/pbt-runner.js";

const pad = (n: number, w: number): string => String(n).padStart(w, "0");

const instant = fc
  .record({
    y: fc.integer({ min: 0, max: 9999 }),
    mo: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
    h: fc.integer({ min: 0, max: 23 }),
    mi: fc.integer({ min: 0, max: 59 }),
    s: fc.integer({ min: 0, max: 59 }),
    ms: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined }),
    zone: fc.oneof(
      fc.constant("Z"),
      fc.tuple(fc.constantFrom("+", "-"), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(
        ([sg, h, m]) => `${sg}${pad(h, 2)}:${pad(m, 2)}`,
      ),
    ),
  })
  .map((p) => {
    const frac = p.ms === undefined ? "" : `.${pad(p.ms, 3)}`;
    return `${pad(p.y, 4)}-${pad(p.mo, 2)}-${pad(p.d, 2)}T${pad(p.h, 2)}:${pad(p.mi, 2)}:${pad(p.s, 2)}${frac}${p.zone}`;
  });

const count = fc.oneof(
  fc.constantFrom(0, 1, 2, 10, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1),
  fc.integer({ min: 0, max: 100000 }),
  fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
);

const stability = fc.oneof(
  fc.constantFrom(5e-324, Number.MIN_VALUE, Number.EPSILON, 1e-7, 1e21, 1e300, Number.MAX_VALUE, 0.1, 120),
  fc.double({ min: 5e-324, max: Number.MAX_VALUE, noNaN: true, noDefaultInfinity: true }).filter((n) => n > 0),
  fc.double({ min: 0.001, max: 200, noNaN: true }),
);

const engramId = fc.oneof(
  fc.constantFrom("__proto__", "constructor", "toString", "hasOwnProperty", "10", "2", "a b", "#", "a/b#c", "é", "日本語", "😀", " "),
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 6 }),
  fc.nat({ max: 50 }).map(String),
);

const hex = fc.array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 64, maxLength: 64 }).map((a) => a.join(""));

const cursor: fc.Arbitrary<LedgerCursor> = fc.oneof(
  fc.record({ lines: fc.constant(0), bytes: count, lastLineSha256: fc.constant(null) }),
  fc.record({ lines: count.filter((n) => n > 0), bytes: count, lastLineSha256: hex }),
);

const engram = fc.record({
  id: engramId,
  stability,
  lastReinforcedCommit: count,
  lastReinforcedAt: instant,
  reinforcements: count,
});

const stateData: fc.Arbitrary<StateFileData> = fc.record({
  commit: count,
  at: instant,
  ledger: cursor,
  engrams: fc.uniqueArray(engram, { selector: (e) => e.id, maxLength: 12 }),
});

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe("state.json round trip (PBT)", () => {
  it("parse(serialize(d)) equals d and serialize(parse(text)) is byte-identical", () => {
    runProperty(
      "state-roundtrip",
      fc.property(stateData, (d) => {
        const text = serializeState(d);
        const r = parseStateText(text);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const sorted = [...d.engrams].sort((a, b) => byCodeUnit(a.id, b.id));
        expect(r.value.states).toEqual(sorted);
        expect(r.value.cursor).toEqual(d.ledger);
        expect(r.value.commit).toBe(d.commit);
        expect(r.value.at).toBe(d.at);
        const again = serializeState({ commit: d.commit, at: d.at, ledger: r.value.cursor, engrams: r.value.states });
        expect(again).toBe(text);
      }),
    );
  });

  it("output is byte-identical regardless of engram supply order", () => {
    runProperty(
      "state-order-independent",
      fc.property(stateData, (d) => {
        const reversed = serializeState({ ...d, engrams: [...d.engrams].reverse() });
        expect(reversed).toBe(serializeState(d));
        const rotated = d.engrams.length === 0 ? [] : [...d.engrams.slice(1), d.engrams[0]!];
        expect(serializeState({ ...d, engrams: rotated })).toBe(serializeState(d));
      }),
    );
  });

  it("serialised text is valid JSON with exactly one trailing newline", () => {
    runProperty(
      "state-text-shape",
      fc.property(stateData, (d) => {
        const text = serializeState(d);
        expect(() => JSON.parse(text)).not.toThrow();
        expect(text.endsWith("\n")).toBe(true);
        expect(text.endsWith("\n\n")).toBe(false);
        expect(Object.keys(JSON.parse(text).engrams as object).length).toBe(d.engrams.length);
      }),
    );
  });

  it("regression: an engram id of __proto__ survives the round trip", () => {
    const e = { id: "__proto__", stability: 2, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00Z", reinforcements: 1 };
    const text = serializeState({ commit: 1, at: "2026-01-01T00:00:00Z", ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams: [e] });
    const r = parseStateText(text);
    expect(r.ok && r.value.states).toEqual([e]);
  });
});
