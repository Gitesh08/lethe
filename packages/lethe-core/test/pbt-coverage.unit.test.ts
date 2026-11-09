// Proves the PBT run counts are real (fc.check details), that FC_NUM_RUNS is honoured at test time,
// and that shrinking + seed reporting work through runProperty.
// Validates: REQ-PBT-1 (>= 1,000 runs in CI, 100 locally), REQ-PBT-3 (shrinking, seed printed)
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  p10Partition, p11Symmetric, p12Serialize, p1Range, p2Monotonic, p3Reinforce,
  p4Protected, p5Contradiction, p6Budget, p7Roundtrip, p8Idempotent, p9Determinism,
} from "../src/properties/index.js";
import { numRuns, runProperty } from "./pbt-runner.js";

const cfg = DEFAULT_CONFIG;
const FACTORIES: ReadonlyArray<readonly [string, () => fc.IRawProperty<unknown>]> = [
  ["P1", () => p1Range(cfg)], ["P2", () => p2Monotonic(cfg)], ["P3", () => p3Reinforce(cfg)],
  ["P4", () => p4Protected(cfg)], ["P5", () => p5Contradiction(cfg)], ["P6", () => p6Budget(cfg)],
  ["P7", () => p7Roundtrip(cfg)], ["P8", () => p8Idempotent(cfg)], ["P9", () => p9Determinism(cfg)],
  ["P10", () => p10Partition(cfg)], ["P11", () => p11Symmetric(cfg)], ["P12", () => p12Serialize(cfg)],
];

describe("numRuns() honours FC_NUM_RUNS", () => {
  const original = process.env["FC_NUM_RUNS"];
  afterEach(() => {
    if (original === undefined) delete process.env["FC_NUM_RUNS"];
    else process.env["FC_NUM_RUNS"] = original;
  });

  it("reads process.env at call time", () => {
    process.env["FC_NUM_RUNS"] = "7";
    expect(numRuns()).toBe(7);
    process.env["FC_NUM_RUNS"] = "1000";
    expect(numRuns()).toBe(1000);
    delete process.env["FC_NUM_RUNS"];
    expect(numRuns()).toBe(100);
    process.env["FC_NUM_RUNS"] = "abc";
    expect(numRuns()).toBe(100);
  });
});

describe("every property really executes numRuns() cases", () => {
  it("reports numRuns, numSkips and timing per property", () => {
    const want = numRuns();
    const rows: string[] = [`FC_NUM_RUNS=${process.env["FC_NUM_RUNS"] ?? "(unset)"} requested=${want}`, "id\tnumRuns\tnumSkips\tms"];
    for (const [id, factory] of FACTORIES) {
      const t0 = performance.now();
      const details = fc.check(factory(), { numRuns: want });
      const ms = Math.round(performance.now() - t0);
      if (details instanceof Promise) throw new Error(`${id} is async`);
      rows.push(`${id}\t${details.numRuns}\t${details.numSkips}\t${ms}`);
      expect(details.failed, `${id} failed (seed ${details.seed})`).toBe(false);
      expect(details.numRuns, id).toBe(want);
      expect(details.numSkips, id).toBeLessThanOrEqual(Math.floor(want * 0.2));
    }
    console.info(rows.join("\n"));
  }, 300_000);
});

describe("shrinking and seed reporting through runProperty", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shrinks to a minimal counterexample and prints the seed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = fc.property(fc.array(fc.nat()), (a) => a.length < 3);
    let thrown: unknown;
    try {
      runProperty("INJECTED", failing);
    } catch (e: unknown) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Counterexample: \[\[0,0,0\]\]/);
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/seed:\s*-?\d+/);
    expect(logged).toContain("counterexample: [[0,0,0]]");
  });

  it("fc.check reports a shrunk counterexample of length 3 with zeros", () => {
    const details = fc.check(fc.property(fc.array(fc.nat()), (a) => a.length < 3), { numRuns: 200 });
    if (details instanceof Promise) throw new Error("async");
    expect(details.failed).toBe(true);
    expect(details.numShrinks).toBeGreaterThanOrEqual(0);
    expect(details.counterexample).toEqual([[0, 0, 0]]);
  });
});
