// Extra invalid-shape cases for state.json parsing. Refs: Req 10.6
import { describe, expect, it } from "vitest";
import { parseStateText } from "../src/load/state-file.js";

const AT = "2026-11-20T10:00:00Z";
const ZERO = { lines: 0, bytes: 0, lastLineSha256: null };
const ENG = { stability: 1, lastReinforcedCommit: 0, lastReinforcedAt: AT, reinforcements: 0 };
const doc = (over: Record<string, unknown>): string =>
  JSON.stringify({ version: 1, commit: 1, at: AT, ledger: ZERO, engrams: {}, ...over });

function pathOf(text: string): unknown {
  const r = parseStateText(text);
  expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
  return !r.ok && (r.error.detail as { path: string }).path;
}

describe("parseStateText invalid shapes", () => {
  it("rejects an unknown top-level key", () => {
    expect(parseStateText(doc({ extra: 1 })).ok).toBe(false);
  });
  it("rejects an unknown engram key", () => {
    expect(pathOf(doc({ engrams: { x: { ...ENG, extra: 1 } } }))).toBeDefined();
  });
  it("rejects a negative commit and names it", () => {
    expect(pathOf(doc({ commit: -1 }))).toBe("commit");
  });
  it("rejects a bad sha length", () => {
    expect(pathOf(doc({ ledger: { lines: 1, bytes: 1, lastLineSha256: "ab" } }))).toBe("ledger.lastLineSha256");
  });
  it("rejects a non-ISO instant and zero stability", () => {
    expect(pathOf(doc({ at: "yesterday" }))).toBe("at");
    expect(pathOf(doc({ engrams: { x: { ...ENG, stability: 0 } } }))).toBe("engrams.x.stability");
  });
  it("rejects an empty engram id", () => {
    expect(parseStateText(doc({ engrams: { "": ENG } })).ok).toBe(false);
  });
});
