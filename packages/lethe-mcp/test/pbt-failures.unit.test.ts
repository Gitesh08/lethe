// Task 6.11 — pbt-failures persistence. Refs: Req 14.4, Req 9.1
import { describe, expect, it } from "vitest";
import { appendPbtFailure, pbtFailureEntry } from "@lethe/core/properties";
import { LOCK_PATH } from "../src/io/lock.js";
import { PBT_FAILURES_REL, recordPbtFailure, writePbtFailure, type GateFailure } from "../src/persist/pbt-failures.js";
import { createMemoryFs } from "./support/memory-fs.js";

const core = { pbtFailureEntry, appendPbtFailure };
const fail = (seed: number): GateFailure => ({ status: "failed", propertyId: "P8", seed, counterexample: { a: [1] }, message: "m" });
const NOW = "2026-11-20T10:00:00Z";
const dec = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);

describe("writePbtFailure", () => {
  it("creates an absent file exactly as core's helpers produce it", async () => {
    const fs = createMemoryFs();
    const r = await writePbtFailure(fs, core, fail(1), NOW);
    expect(r.ok).toBe(true);
    expect(dec(fs.files.get(PBT_FAILURES_REL))).toBe(appendPbtFailure(undefined, pbtFailureEntry(fail(1), NOW)));
  });

  it("appends to an existing file and preserves earlier entries", async () => {
    const fs = createMemoryFs();
    await writePbtFailure(fs, core, fail(1), NOW);
    await writePbtFailure(fs, core, fail(2), NOW);
    const parsed = JSON.parse(dec(fs.files.get(PBT_FAILURES_REL))) as { failures: { seed: number }[] };
    expect(parsed.failures.map((f) => f.seed)).toEqual([1, 2]);
  });

  it("replaces a malformed existing file as core specifies", async () => {
    const fs = createMemoryFs();
    fs.files.set(PBT_FAILURES_REL, new TextEncoder().encode("{not json"));
    await writePbtFailure(fs, core, fail(3), NOW);
    expect(dec(fs.files.get(PBT_FAILURES_REL))).toBe(appendPbtFailure(undefined, pbtFailureEntry(fail(3), NOW)));
  });

  it("writes through writeAtomic only", async () => {
    const fs = createMemoryFs();
    let atomic = 0;
    const orig = fs.writeAtomic.bind(fs);
    fs.writeAtomic = (rel, c) => (atomic++, orig(rel, c));
    await writePbtFailure(fs, core, fail(1), NOW);
    expect(atomic).toBe(1);
  });
});

describe("recordPbtFailure", () => {
  it("holds the lock while writing and releases it afterwards", async () => {
    const fs = createMemoryFs();
    let lockedDuringWrite = false;
    const orig = fs.writeAtomic.bind(fs);
    fs.writeAtomic = (rel, c) => {
      if (rel === PBT_FAILURES_REL) lockedDuringWrite = fs.files.has(LOCK_PATH);
      return orig(rel, c);
    };
    const r = await recordPbtFailure(fs, { signals: { on: () => undefined, off: () => undefined } }, core, fail(4), NOW);
    expect(r.ok).toBe(true);
    expect(lockedDuringWrite).toBe(true);
    expect(fs.files.has(LOCK_PATH)).toBe(false);
    expect(fs.files.has(PBT_FAILURES_REL)).toBe(true);
  });
});
