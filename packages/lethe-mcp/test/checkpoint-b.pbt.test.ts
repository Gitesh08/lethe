// Property (b): checkpoint idempotence. Refs: Req 23.8, Req 23.10, INV-4
// Re-running computeCheckpoint on its own output (same nowCommit/nowISO, same ledger bytes, new cursor)
// changes nothing: states, cursor equal; stamped/foldedEvents/pruned empty; no checkpoint diagnostics.
// Ledger-read diagnostics (torn tail, skipped lines) are parseLedger's, not the checkpoint's, and are not asserted.
import { DEFAULT_CONFIG, parseDocument, sha256, type EngramNode } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";
import { runProperty } from "./support/pbt-runner.js";

const NOW_ISO = "2026-06-01T00:00:00.000Z";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const section = (i: number, kind: number, glob: string): string => {
  const ann = kind === 1 ? `<!-- lethe: pin=true -->` : kind === 2 ? `<!-- lethe: globs=${glob} -->` : "";
  return `## Rule ${i}\n${ann}\nBody text for rule ${i}.\n`;
};

const docArb: fc.Arbitrary<ReadonlyArray<EngramNode>> = fc
  .array(fc.tuple(fc.constantFrom(0, 1, 2), fc.constantFrom("*.ts", "src/**", "*.md")), { maxLength: 6 })
  .map((parts) => {
    const text = parts.map(([k, g], i) => section(i, k, g)).join("\n");
    const r = parseDocument("a.md", `# Doc\n\n${text}`, DEFAULT_CONFIG);
    return r.ok ? r.value.engrams : [];
  });

const lineArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ c: fc.integer({ min: 0, max: 120 }), f: fc.constantFrom("a.ts", "src/x.ts", "r.md"), t: fc.constantFrom("task_passed", "manual_pin") })
      .map((x) => `${JSON.stringify({ type: x.t, at: "2026-02-01T00:00:00.000Z", commit: x.c, filesTouched: [x.f] })}\n`) },
  { weight: 1, arbitrary: fc.constant("\n") },
  { weight: 1, arbitrary: fc.constantFrom("garbage\n", "{\"type\":\n", "\r\n") },
);

const scenarioArb = fc.record({
  engrams: docArb,
  extraIds: fc.array(fc.constantFrom("ghost-1", "ghost-2", "zz"), { maxLength: 3 }),
  pick: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  archivePick: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  lines: fc.array(lineArb, { maxLength: 8 }),
  torn: fc.constantFrom("", "", "{\"type\":\"task_pa"),
  cursorKind: fc.constantFrom("zero", "valid", "bad"),
  cursorAt: fc.nat({ max: 8 }),
  nowCommit: fc.integer({ min: 0, max: 100 }),
  skipped: fc.boolean(),
});

function cursorFor(kind: string, at: number, lines: ReadonlyArray<string>): LedgerCursor {
  const k = Math.min(at, lines.length);
  if (kind === "zero" || k === 0) return kind === "bad" ? { lines: 3, bytes: 7, lastLineSha256: "deadbeef" } : ZERO_CURSOR;
  const taken = lines.slice(0, k);
  const last = taken[k - 1] ?? "";
  const bytes = enc(taken.join("")).length;
  return kind === "bad" ? { lines: k, bytes, lastLineSha256: "deadbeef" } : { lines: k, bytes, lastLineSha256: sha256(last) };
}

describe("checkpoint idempotence (property b)", () => {
  it("computeCheckpoint on its own output is a no-op", () => {
    runProperty(
      "checkpoint-b",
      fc.property(scenarioArb, (s) => {
        const persisted = [...s.engrams.map((e) => e.id), ...s.extraIds]
          .filter((_, i) => s.pick[i % 6] === true)
          .map((id) => ({ id, stability: 5 + (id.length % 7), lastReinforcedCommit: id.length, lastReinforcedAt: "2026-03-01T00:00:00.000Z", reinforcements: id.length % 3 }));
        const archivedIds = s.engrams.filter((_, i) => s.archivePick[i] === true).map((e) => e.id);
        const bytes = enc(s.lines.join("") + s.torn);
        const cursor = cursorFor(s.cursorKind, s.cursorAt, s.lines);
        const base = { engrams: s.engrams, specs: [], cfg: DEFAULT_CONFIG, nowCommit: s.nowCommit, nowISO: NOW_ISO, archivedIds, anySteeringSkipped: s.skipped, ledgerBytes: bytes };
        const r1 = computeCheckpoint({ ...base, persisted, persistedCursor: cursor, ledger: parseLedger(bytes, cursor) });
        const r2 = computeCheckpoint({ ...base, persisted: r1.states, persistedCursor: r1.cursor, ledger: parseLedger(bytes, r1.cursor) });
        expect(r2.states).toEqual(r1.states);
        expect(r2.cursor).toEqual(r1.cursor);
        expect(r2.stamped).toEqual([]);
        expect(r2.foldedEvents).toBe(0);
        expect(r2.pruned).toEqual([]);
        expect(r2.diagnostics).toEqual([]);
      }),
    );
  });
});
