// Wall-clock bound for jaccard on very long input. Runs in the serial `perf` pass.
import { describe, it, expect } from "vitest";
import { jaccard } from "../src/consolidate/jaccard.js";

// Validates: REQ-CRY-5, REQ-CRY-13
describe("jaccard (perf)", () => {
  it("very long input finishes in < 100 ms", () => {
    const long = "word-token ".repeat(20_000); // ~220k chars
    const start = performance.now();
    const r = jaccard(long, long + " extra");
    const elapsed = performance.now() - start;
    expect(r).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });
});
