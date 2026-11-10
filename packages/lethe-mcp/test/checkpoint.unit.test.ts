// Unit tests for computeCheckpoint (pure). Refs: Req 23.1, Req 23.3, Req 23.7, Req 23.9
import { DEFAULT_CONFIG, sha256, type EngramNode, type EngramState } from "@lethe/core";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint, type CheckpointInput } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";

const node = (id: string, globs: string[] = []): EngramNode => ({
  id, file: "a.md", headingPath: [id], body: id, contentHash: id, tokens: 1, globs, specLinks: [], pinned: false,
  span: { start: 0, end: 1 },
});
const state = (id: string, extra: Partial<EngramState> = {}): EngramState => ({
  id, stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0, ...extra,
});
const line = (commit: number, files: string[] = ["x.ts"]): string =>
  `${JSON.stringify({ type: "task_passed", at: "2026-01-02T00:00:00.000Z", commit, filesTouched: files })}\n`;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const run = (text: string, over: Partial<CheckpointInput> = {}, cursor: LedgerCursor = ZERO_CURSOR) => {
  const bytes = enc(text);
  return computeCheckpoint({
    engrams: [node("a", ["*.ts"])], persisted: [state("a")], persistedCursor: cursor,
    ledger: parseLedger(bytes, cursor), ledgerBytes: bytes, specs: [], cfg: DEFAULT_CONFIG,
    nowCommit: 10, nowISO: "2026-01-03T00:00:00.000Z", archivedIds: [], anySteeringSkipped: false, ...over,
  });
};

describe("computeCheckpoint", () => {
  it("folds the prefix and advances the cursor to the last consumed line", () => {
    const l1 = line(1);
    const l2 = line(2);
    const r = run(l1 + l2);
    expect(r.foldedEvents).toBe(2);
    expect(r.states[0]?.reinforcements).toBe(2);
    expect(r.cursor).toEqual({ lines: 2, bytes: enc(l1 + l2).length, lastLineSha256: sha256(l2) });
  });

  it("stops at the first future commit and leaves later lines unconsumed", () => {
    const l1 = line(1);
    const r = run(l1 + line(50) + line(2));
    expect(r.foldedEvents).toBe(1);
    expect(r.cursor).toEqual({ lines: 1, bytes: enc(l1).length, lastLineSha256: sha256(l1) });
  });

  it("keeps the cursor when the first line is in the future", () => {
    const r = run(line(50));
    expect(r.cursor).toEqual(ZERO_CURSOR);
    expect(r.foldedEvents).toBe(0);
  });

  it("consumes blank and skipped lines", () => {
    const text = "\ngarbage\n" + line(1);
    const r = run(text);
    expect(r.cursor.lines).toBe(3);
    expect(r.foldedEvents).toBe(1);
  });

  it("hashes the last consumed line when resuming from a non-zero cursor", () => {
    const l1 = line(1);
    const l2 = line(2);
    const first = run(l1);
    const r = run(l1 + l2, { persisted: [...first.states] }, first.cursor);
    expect(r.foldedEvents).toBe(1);
    expect(r.cursor.lastLineSha256).toBe(sha256(l2));
    expect(r.states[0]?.reinforcements).toBe(2);
  });

  it("stamps engrams without state and applies no event to them", () => {
    const r = run(line(1), { engrams: [node("a", ["*.ts"]), node("b", ["*.ts"])] });
    const b = r.states.find((s) => s.id === "b");
    expect(r.stamped).toEqual(["b"]);
    expect(b).toEqual({ id: "b", stability: DEFAULT_CONFIG.s0, lastReinforcedCommit: 10, lastReinforcedAt: "2026-01-03T00:00:00.000Z", reinforcements: 0 });
  });

  it("prunes archived and unmatched ids", () => {
    const r = run("", { engrams: [node("a"), node("b")], persisted: [state("a"), state("b"), state("gone")], archivedIds: ["b"] });
    expect(r.pruned).toEqual(["b", "gone"]);
    expect(r.states.map((s) => s.id)).toEqual(["a"]);
  });

  it("prunes only archived ids when a steering file was skipped, carrying others unchanged", () => {
    const gone = state("gone", { stability: 7 });
    const r = run(line(1), { engrams: [node("a")], persisted: [state("a"), state("b"), gone], archivedIds: ["b"], anySteeringSkipped: true });
    expect(r.pruned).toEqual(["b"]);
    expect(r.states.find((s) => s.id === "gone")).toEqual(gone);
  });

  it("does not stamp archived engrams", () => {
    const r = run("", { engrams: [node("a"), node("z")], persisted: [state("a")], archivedIds: ["z"] });
    expect(r.stamped).toEqual([]);
  });

  it("re-anchors on a rewritten ledger without folding", () => {
    const l1 = line(1);
    const bad: LedgerCursor = { lines: 1, bytes: enc(l1).length, lastLineSha256: "deadbeef" };
    const text = l1 + line(2);
    const r = run(text, {}, bad);
    expect(r.foldedEvents).toBe(0);
    expect(r.states[0]?.reinforcements).toBe(0);
    expect(r.cursor).toEqual({ lines: 2, bytes: enc(text).length, lastLineSha256: sha256(line(2)) });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["LEDGER_REWRITTEN"]);
  });

  it("is deterministic and sorts states by code unit", () => {
    const engrams = [node("b"), node("B"), node("a")];
    const r1 = run("", { engrams, persisted: [] });
    const r2 = run("", { engrams: [...engrams].reverse(), persisted: [] });
    expect(r1.states.map((s) => s.id)).toEqual(["B", "a", "b"]);
    expect(r2).toEqual(r1);
  });
});
