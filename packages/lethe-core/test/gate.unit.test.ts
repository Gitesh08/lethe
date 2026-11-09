// PBT gate: never throws, sequential P1..P12, reproducible failures, pbt-failures.json text helpers.
// Refs: REQ-PBT-1, REQ-PBT-3, REQ-PBT-5
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  PROPERTY_IDS,
  appendPbtFailure,
  pbtFailureEntry,
  runGate,
  runPbtGate,
  toJsonSafe,
} from "../src/properties/index.js";
import type { PbtFailure } from "../src/properties/index.js";

const failing: PbtFailure = {
  status: "failed",
  propertyId: "P3",
  seed: 42,
  counterexample: { b: 1, a: [2] },
  message: "boom",
};

describe("runPbtGate", () => {
  it("passes with ran === 12 and reports progress in order", async () => {
    const seen: Array<readonly [string, number, number]> = [];
    const res = await runPbtGate(DEFAULT_CONFIG, {
      numRuns: 5,
      onProgress: (id, i, total) => seen.push([id, i, total]),
    });
    expect(res).toEqual({ status: "passed", ran: 12, numRuns: 5 });
    expect(seen).toHaveLength(12);
    expect(seen.map((s) => s[0])).toEqual([...PROPERTY_IDS]);
    expect(seen.map((s) => s[1])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seen.every((s) => s[2] === 12)).toBe(true);
  });

  it("never throws for a degenerate config", async () => {
    const bad = { ...DEFAULT_CONFIG, sMin: 0, s0: -1, beta: Number.NaN };
    const res = await runPbtGate(bad, { numRuns: 3 });
    expect(["passed", "failed"]).toContain(res.status);
  });
});

describe("runGate failure injection", () => {
  it("reports propertyId, numeric seed, shaped counterexample, and the seed reproduces", async () => {
    const prop = fc.property(fc.nat(), (n) => n < 5);
    const res = await runGate(
      [
        { id: "OK", factory: () => fc.property(fc.nat(), () => true) },
        { id: "BAD", factory: () => prop },
        { id: "NEVER", factory: () => fc.property(fc.nat(), () => true) },
      ],
      50,
    );
    expect(res.status).toBe("failed");
    if (res.status !== "failed") return;
    expect(res.propertyId).toBe("BAD");
    expect(typeof res.seed).toBe("number");
    expect(res.counterexample).toBe(5);
    expect(() => fc.assert(prop, { seed: res.seed, numRuns: 50 })).toThrow();
  });

  it("converts a throwing factory into a failed result", async () => {
    const res = await runGate([{ id: "X", factory: () => { throw new Error("factory exploded"); } }], 1);
    expect(res).toMatchObject({ status: "failed", propertyId: "X" });
    if (res.status === "failed") expect(res.message).toContain("factory exploded");
  });
});

describe("toJsonSafe", () => {
  it("handles cycles, BigInt and long strings", () => {
    const cyc: Record<string, unknown> = { n: 1n, s: "x".repeat(5000) };
    cyc["self"] = cyc;
    const out = JSON.stringify(toJsonSafe(cyc));
    expect(out).toContain("[Circular]");
    expect(out).toContain("1n");
    expect(out.length).toBeLessThan(2300);
  });
});

describe("pbt-failures.json text helpers", () => {
  const at = "2026-11-10T00:00:00.000Z";
  const entry = pbtFailureEntry(failing, at);

  it("builds an entry with stable key order and sorted counterexample keys", () => {
    expect(Object.keys(entry)).toEqual(["propertyId", "seed", "counterexample", "failedAt"]);
    expect(JSON.stringify(entry.counterexample)).toBe('{"a":[2],"b":1}');
  });

  it("creates a fresh file for undefined or malformed input", () => {
    const expected = `${JSON.stringify({ failures: [entry] }, null, 2)}\n`;
    expect(appendPbtFailure(undefined, entry)).toBe(expected);
    expect(appendPbtFailure("{not json", entry)).toBe(expected);
    expect(appendPbtFailure('{"failures":"nope"}', entry)).toBe(expected);
  });

  it("appends to a valid file, keeping existing entries", () => {
    const first = appendPbtFailure(undefined, entry);
    const second = appendPbtFailure(first, { ...entry, propertyId: "P9" });
    const parsed = JSON.parse(second) as { failures: Array<{ propertyId: string }> };
    expect(parsed.failures.map((f) => f.propertyId)).toEqual(["P3", "P9"]);
    expect(second.endsWith("}\n")).toBe(true);
    expect(appendPbtFailure(second, { ...entry, propertyId: "P9" })).toBe(
      appendPbtFailure(second, { ...entry, propertyId: "P9" }),
    );
  });
});
