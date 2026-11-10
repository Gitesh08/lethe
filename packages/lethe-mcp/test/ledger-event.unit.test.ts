// Direct tests for the LedgerEvent guard. Refs: Req 10.8, Req 10.9
import { describe, expect, it } from "vitest";
import { toLedgerEvent } from "../src/load/ledger-event.js";

const base = { type: "task_passed", at: "2026-11-20T10:00:00Z", commit: 3 };

describe("toLedgerEvent", () => {
  it("accepts a minimal event", () => {
    expect(toLedgerEvent(base)).toEqual(base);
  });

  it("keeps optional arrays and drops unknown keys", () => {
    const out = toLedgerEvent({ ...base, type: "spec_cited", filesTouched: ["a.ts"], cited: ["x"], extra: 1 });
    expect(out).toEqual({ ...base, type: "spec_cited", filesTouched: ["a.ts"], cited: ["x"] });
  });

  it.each([
    ["non-object", 5],
    ["null", null],
    ["array", [base]],
    ["unknown type", { ...base, type: "nope" }],
    ["empty at", { ...base, at: "" }],
    ["unparseable at", { ...base, at: "not a date" }],
    ["negative commit", { ...base, commit: -1 }],
    ["fractional commit", { ...base, commit: 1.5 }],
    ["string commit", { ...base, commit: "3" }],
    ["bad filesTouched", { ...base, filesTouched: [1] }],
    ["non-array cited", { ...base, cited: "x" }],
  ])("rejects %s", (_name, input) => {
    expect(toLedgerEvent(input)).toBeNull();
  });
});
