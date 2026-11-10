// Property: config/ontology parse -> serialise -> parse round trip and byte determinism.
// **Validates: Requirements 10.4, 10.5, 10.12** (design Property 2)
import { validateConfig } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { configFileSchema } from "../src/load/config-file.js";
import { ontologyFileSchema } from "../src/load/ontology-file.js";
import { KEY_ORDERS, stableStringify } from "../src/persist/stable-json.js";
import { runProperty } from "./support/pbt-runner.js";

const dbl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** Valid by construction against core's validateConfig ranges. */
const fullConfig = fc
  .record({
    s0: dbl(0.1, 50),
    sMinus: dbl(0, 100),
    sMin: dbl(0.01, 5),
    beta: dbl(0, 3),
    alpha: dbl(0, 3),
    wDefault: dbl(1, 3),
    wPlus: dbl(0, 5),
    specFloor: dbl(0.01, 0.99),
    cryptMax: dbl(0.01, 0.5),
    hotMin: dbl(0.51, 0.99),
    budgetTokens: fc.integer({ min: 1, max: 100000 }),
    dedupeJaccard: dbl(0.01, 1),
    granularity: fc.constantFrom("section" as const, "bullet" as const),
    activeSpecs: fc.array(fc.string(), { maxLength: 4 }),
  })
  .map((r) => ({
    version: 1 as const,
    s0: r.s0, sMax: r.s0 + r.sMinus, sMin: r.sMin, beta: r.beta, alpha: r.alpha,
    wDefault: r.wDefault, wSpec: r.wDefault + r.wPlus, specFloor: r.specFloor,
    hotMin: r.hotMin, cryptMax: r.cryptMax, budgetTokens: r.budgetTokens,
    dedupeJaccard: r.dedupeJaccard, granularity: r.granularity, activeSpecs: r.activeSpecs,
  }));

/** Config files with a random subset of keys present (version always). */
const configFile = fullConfig.chain((c) =>
  fc.subarray(Object.keys(c).filter((k) => k !== "version")).map((keep) =>
    Object.fromEntries(Object.entries(c).filter(([k]) => k === "version" || keep.includes(k))),
  ),
);

const stanceArb = fc.record({
  id: fc.string(), label: fc.string(), patterns: fc.array(fc.string(), { maxLength: 3 }), negationAware: fc.boolean(),
});
const axisArb = fc.record({
  id: fc.string(), description: fc.string(), stances: fc.array(stanceArb, { maxLength: 3 }),
});
const ontologyFile = fc.record({ version: fc.constant(1 as const), axes: fc.array(axisArb, { maxLength: 3 }) });

/** Same value with object keys inserted in reverse order, recursively. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
  }
  return v;
}

describe("config/ontology round trip (property)", () => {
  it("full configs satisfy validateConfig by construction", () => {
    runProperty("config-generator-valid", fc.property(fullConfig, (c) => {
      const { version: _v, activeSpecs: _a, ...rest } = c;
      expect(validateConfig(rest).ok).toBe(true);
    }));
  });

  it("config: parse(serialise(v)) equals v, and bytes ignore insertion order", () => {
    runProperty("config-roundtrip", fc.property(configFile, (v) => {
      const text = stableStringify(v, KEY_ORDERS.config);
      const back = configFileSchema.parse(JSON.parse(text));
      expect(back).toEqual(v);
      expect(stableStringify(back, KEY_ORDERS.config)).toBe(text);
      expect(stableStringify(reverseKeys(v), KEY_ORDERS.config)).toBe(text);
      expect(text.endsWith("\n")).toBe(true);
    }));
  });

  it("ontology: parse(serialise(v)) equals v, and bytes ignore insertion order", () => {
    runProperty("ontology-roundtrip", fc.property(ontologyFile, (v) => {
      const text = stableStringify(v, KEY_ORDERS.ontology);
      const back = ontologyFileSchema.parse(JSON.parse(text));
      expect(back).toEqual(v);
      expect(stableStringify(back, KEY_ORDERS.ontology)).toBe(text);
      expect(stableStringify(reverseKeys(v), KEY_ORDERS.ontology)).toBe(text);
    }));
  });
});
