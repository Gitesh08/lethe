// Shared runner for *.pbt.test.ts files.
// Never passes a fixed seed and never calls fc.configureGlobal (core rule 5).
// Persisting failures to .kiro/lethe/pbt-failures.json is IO and is deferred to lethe-mcp.
// Refs: REQ-PBT-1, REQ-PBT-4

import fc from "fast-check";

/** FC_NUM_RUNS as a positive integer; 100 when absent, non-numeric or < 1. */
export function numRuns(): number {
  const raw = process.env["FC_NUM_RUNS"];
  if (raw === undefined) return 100;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 100;
}

function extract(message: string, re: RegExp): string {
  const m = re.exec(message);
  return m?.[1]?.trim() ?? "<unavailable>";
}

/** Runs a property; on failure logs id, seed, shrunk counterexample, then rethrows. */
export function runProperty(id: string, property: fc.IPropertyWithHooks<unknown[]> | fc.IRawProperty<unknown>): void {
  try {
    fc.assert(property, { numRuns: numRuns(), verbose: 1 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const seed = extract(message, /seed:\s*(-?\d+)/);
    const counterexample = extract(message, /Counterexample:\s*([^\n]*)/);
    console.error(`[PBT FAIL] ${id}\n  seed: ${seed}\n  counterexample: ${counterexample}`);
    throw e;
  }
}
