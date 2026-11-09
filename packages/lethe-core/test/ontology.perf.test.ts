// ReDoS timing bounds for ontology patterns and the scanner. Runs in the serial `perf` pass.
import { describe, it, expect } from "vitest";
import { DEFAULT_AXES } from "../src/contradiction/default-ontology.js";
import { validateOntology } from "../src/contradiction/validate-ontology.js";
import { scanEngram } from "../src/contradiction/scan.js";

const allStances = DEFAULT_AXES.flatMap((a) => a.stances);

describe("ontology (perf)", () => {
  it("resists ReDoS on adversarial 8192-char inputs (< 50 ms each)", () => {
    const inputs = ["a".repeat(8192), " ".repeat(8192), "use ".repeat(2048)];
    for (const s of allStances) {
      for (const p of s.patterns) {
        const re = new RegExp(p, "i");
        for (const input of inputs) {
          const t0 = performance.now();
          re.test(input);
          expect(performance.now() - t0, `${s.id} ${p}`).toBeLessThan(50);
        }
      }
    }
  });

  it("scanEngram is fast on adversarial 8192-char bodies (< 100 ms)", () => {
    const res = validateOntology(DEFAULT_AXES);
    if (!res.ok) throw new Error("default ontology invalid");
    for (const body of ["use ".repeat(2048), "a".repeat(8192)]) {
      const t0 = performance.now();
      scanEngram(body, res.value);
      expect(performance.now() - t0).toBeLessThan(100);
    }
  });
});
