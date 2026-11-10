// Shared runner for lethe-mcp *.pbt.test.ts files.
// Never passes a fixed seed and never calls fc.configureGlobal (rules section 5).

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

/** Runs a (sync or async-free) property; on failure logs id, seed and counterexample, then rethrows. */
export function runProperty(
  id: string,
  property: fc.IPropertyWithHooks<unknown[]> | fc.IRawProperty<unknown>,
): void {
  try {
    fc.assert(property, { numRuns: numRuns() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const seed = extract(message, /seed:\s*(-?\d+)/);
    const counterexample = extract(message, /Counterexample:\s*([^\n]*)/);
    console.error(`[PBT FAIL] ${id}\n  seed: ${seed}\n  counterexample: ${counterexample}`);
    throw e;
  }
}

/** Async variant for properties built with fc.asyncProperty. */
export async function runAsyncProperty(
  id: string,
  property: fc.IAsyncPropertyWithHooks<unknown[]> | fc.IRawProperty<unknown, true>,
): Promise<void> {
  try {
    await fc.assert(property, { numRuns: numRuns() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const seed = extract(message, /seed:\s*(-?\d+)/);
    const counterexample = extract(message, /Counterexample:\s*([^\n]*)/);
    console.error(`[PBT FAIL] ${id}\n  seed: ${seed}\n  counterexample: ${counterexample}`);
    throw e;
  }
}
