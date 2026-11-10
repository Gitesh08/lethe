// Property (e): cursor-mismatch handling. Refs: Req 23.7
// A corrupted cursor makes a read-only view ignore every event (LEDGER_REWRITTEN) and a checkpoint
// re-anchor the cursor at the end of the ledger without folding anything.
import { DEFAULT_CONFIG, sha256, type EngramNode, type EngramState } from "@lethe/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";
import { computeCheckpoint } from "../src/persist/checkpoint.js";
import { ZERO_CURSOR, type LedgerCursor } from "../src/persist/ledger-cursor.js";
import { runProperty } from "./support/pbt-runner.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

interface Built {
  readonly terminated: ReadonlyArray<string>; // each line including its terminator
  readonly torn: string; // unterminated tail ("" when none)
}

const node: EngramNode = {
  id: "a", file: "a.md", headingPath: ["a"], body: "a", contentHash: "a", tokens: 1, globs: ["*.ts"], specLinks: [], pinned: false,
  span: { start: 0, end: 1 },
};
const state: EngramState = {
  id: "a", stability: 5, lastReinforcedCommit: 0, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0,
};

const eventLine = (i: number, term: string): string =>
  JSON.stringify({ type: "task_passed", at: "2026-01-02T00:00:00.000Z", commit: i + 1, filesTouched: ["x.ts"] }) + term;

// Every line is unique (commit index / numbered garbage), so two different lines never hash equal.
const builtArb: fc.Arbitrary<Built> = fc
  .record({
    kinds: fc.array(fc.record({ garbage: fc.boolean(), crlf: fc.boolean() }), { minLength: 1, maxLength: 12 }),
    torn: fc.boolean(),
  })
  .map(({ kinds, torn }) => ({
    terminated: kinds.map((k, i) => (k.garbage ? `garbage-${i}` + (k.crlf ? "\r\n" : "\n") : eventLine(i, k.crlf ? "\r\n" : "\n"))),
    torn: torn ? '{"type":"task_pa' : "",
  }));

const textOf = (b: Built): string => b.terminated.join("") + b.torn;

/** Cursor after the first `k` lines, computed independently of parseLedger. */
function cursorAt(b: Built, k: number): LedgerCursor {
  if (k === 0) return ZERO_CURSOR;
  const bytes = b.terminated.slice(0, k).reduce((n, l) => n + enc(l).length, 0);
  return { lines: k, bytes, lastLineSha256: sha256(b.terminated[k - 1] ?? "") };
}

const hex64 = fc.array(fc.constantFrom(..."0123456789abcdef"), { minLength: 64, maxLength: 64 }).map((a) => a.join(""));

interface Case {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly cursor: LedgerCursor;
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    b: builtArb,
    pick: fc.nat(), kind: fc.integer({ min: 0, max: 7 }), n1: fc.nat({ max: 50 }), n2: fc.nat(), hash: hex64,
  })
  .map(({ b, pick, kind, n1, n2, hash }): Case => {
    const n = b.terminated.length;
    const k = (pick % n) + 1; // 1..n consumed lines
    const good = cursorAt(b, k);
    const bytes = enc(textOf(b));
    switch (kind) {
      case 0:
        return { name: "wrong hash", bytes, cursor: { ...good, lastLineSha256: hash === good.lastLineSha256 ? "0".repeat(64) : hash } };
      case 1:
        return { name: "bytes beyond end", bytes, cursor: { ...good, bytes: bytes.length + 1 + n1 } };
      case 2:
        return { name: "lines beyond count", bytes, cursor: { ...good, lines: n + 1 + n1 } };
      case 3: {
        const lineLen = enc(b.terminated[k - 1] ?? "").length;
        return { name: "bytes mid-line", bytes, cursor: { ...good, bytes: good.bytes - 1 - (n2 % lineLen) } };
      }
      case 4: {
        if (n < 2) return { name: "wrong hash", bytes, cursor: { ...good, lastLineSha256: sha256("other") } };
        const j = (k - 1 + 1 + (n2 % (n - 1))) % n; // a line index other than k-1
        return { name: "consistent but different line", bytes, cursor: { ...good, lastLineSha256: sha256(b.terminated[j] ?? "") } };
      }
      case 5: {
        // ledger truncated after the cursor was taken (cursor at k, file now shorter than cursor.bytes)
        const cut = n2 % good.bytes;
        return { name: "truncated", bytes: bytes.subarray(0, cut), cursor: good };
      }
      case 6: {
        // same-length edit inside the last consumed line (content, not terminator)
        const line = b.terminated[k - 1] ?? "";
        const contentLen = line.replace(/\r?\n$/, "").length;
        const p = n2 % contentLen;
        const orig = line.charAt(p);
        const repl = orig === "q" ? "z" : "q";
        const edited = b.terminated.map((l, i) => (i === k - 1 ? line.slice(0, p) + repl + line.slice(p + 1) : l)).join("") + b.torn;
        return { name: "edited last consumed line", bytes: enc(edited), cursor: good };
      }
      default: {
        // CRLF <-> LF flip on the last consumed line: core sha256 normalises endings, bytes must catch it
        const line = b.terminated[k - 1] ?? "";
        const flipped = line.endsWith("\r\n") ? line.slice(0, -2) + "\n" : line.slice(0, -1) + "\r\n";
        const text = b.terminated.map((l, i) => (i === k - 1 ? flipped : l)).join("") + b.torn;
        return { name: "terminator flip", bytes: enc(text), cursor: good };
      }
    }
  });

const checkpoint = (bytes: Uint8Array, cursor: LedgerCursor) =>
  computeCheckpoint({
    engrams: [node], persisted: [state], persistedCursor: cursor, ledger: parseLedger(bytes, cursor), ledgerBytes: bytes,
    specs: [], cfg: DEFAULT_CONFIG, nowCommit: 10_000, nowISO: "2026-01-03T00:00:00.000Z", archivedIds: [], anySteeringSkipped: false,
  });

describe("PBT (e): cursor mismatch handling", () => {
  it("every corrupted cursor is rewritten: view ignores events, checkpoint re-anchors without folding", () => {
    runProperty(
      "checkpoint-e/corrupted-cursor",
      fc.property(caseArb, (c) => {
        const read = parseLedger(c.bytes, c.cursor);
        expect(read.rewritten, c.name).toBe(true);
        expect(read.events, c.name).toEqual([]);
        expect(read.tail, c.name).toEqual([]);
        expect(read.diagnostics.map((d) => d.code), c.name).toContain("LEDGER_REWRITTEN");

        const r = checkpoint(c.bytes, c.cursor);
        expect(r.cursor, c.name).toEqual(parseLedger(c.bytes, ZERO_CURSOR).endCursor);
        expect(r.foldedEvents, c.name).toBe(0);
        expect(r.diagnostics.map((d) => d.code), c.name).toContain("LEDGER_REWRITTEN");
        expect(r.stamped).toEqual([]);
        expect(r.pruned).toEqual([]);
        // states equal those of an empty-ledger checkpoint (nothing folded)
        const baseline = checkpoint(new Uint8Array(0), ZERO_CURSOR);
        expect(r.states, c.name).toEqual(baseline.states);
        expect(r.states[0]?.reinforcements).toBe(0);
      }),
    );
  });

  it("control: valid cursors are never reported as rewritten", () => {
    runProperty(
      "checkpoint-e/valid-cursor-control",
      fc.property(builtArb, fc.nat(), (b, pick) => {
        const k = pick % (b.terminated.length + 1);
        const read = parseLedger(enc(textOf(b)), cursorAt(b, k));
        expect(read.rewritten).toBe(false);
        expect(read.tail).toHaveLength(b.terminated.length - k);
        expect(read.diagnostics.map((d) => d.code)).not.toContain("LEDGER_REWRITTEN");
      }),
    );
  });

  // Finding (not a bug per design): the cursor hashes only the LAST consumed line, so a same-length
  // edit to an EARLIER consumed line is not detectable. Documented so the limitation is visible.
  it("documents: same-length edit before the last consumed line is not detected", () => {
    const l1 = eventLine(0, "\n");
    const l2 = eventLine(1, "\n");
    const cursor = cursorAt({ terminated: [l1, l2], torn: "" }, 2);
    const edited = l1.replace("task_passed", "task_passeq");
    expect(edited.length).toBe(l1.length);
    expect(parseLedger(enc(edited + l2), cursor).rewritten).toBe(false);
  });
});
