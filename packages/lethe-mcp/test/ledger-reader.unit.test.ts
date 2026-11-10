// Ledger reader matrix: torn tail, skipped lines, CRLF, multibyte, cursors, append-then-read. Refs: Req 10.9, Req 12.6, Req 23.7
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, type LedgerEvent } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { LEDGER_REL, loadLedger, parseLedger } from "../src/load/ledger-file.js";
import { ZERO_CURSOR } from "../src/persist/ledger-cursor.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const byteLen = (s: string): number => enc(s).length;
const ev = (commit: number, extra = ""): string =>
  `{"type":"task_passed","at":"2026-01-01T00:00:00Z","commit":${commit}${extra}}\n`;
const crlf = (s: string): string => s.replace(/\n$/, "\r\n");
const codes = (r: ReturnType<typeof parseLedger>): string[] => r.diagnostics.map((d) => d.code);
const lineNos = (r: ReturnType<typeof parseLedger>): string[] =>
  r.diagnostics.flatMap((d) => (/line (\d+)/.exec(d.message)?.[1] ?? []));
const commits = (r: ReturnType<typeof parseLedger>): number[] => r.events.map((e) => e.commit);

describe("ledger reader: line shapes", () => {
  it("torn tail is ignored, reported, and not counted in the cursor", () => {
    const r = parseLedger(enc(ev(1) + '{"type":"task_pa'));
    expect(commits(r)).toEqual([1]);
    expect(codes(r)).toEqual(["LEDGER_TORN_TAIL"]);
    expect(r.endCursor).toEqual({ lines: 1, bytes: byteLen(ev(1)), lastLineSha256: sha256(ev(1)) });
  });

  it("a file holding only a torn line has the zero cursor", () => {
    const r = parseLedger(enc("{"));
    expect(r.endCursor).toEqual(ZERO_CURSOR);
    expect(r.events).toEqual([]);
    expect(codes(r)).toEqual(["LEDGER_TORN_TAIL"]);
  });

  it("blank line is skipped with its 1-based number and still advances the cursor", () => {
    const text = ev(1) + "\n" + ev(2);
    const r = parseLedger(enc(text));
    expect(codes(r)).toEqual(["LEDGER_LINE_SKIPPED"]);
    expect(lineNos(r)).toEqual(["2"]);
    expect(r.tail.map((l) => l.event === null)).toEqual([false, true, false]);
    expect(r.endCursor.lines).toBe(3);
    expect(r.endCursor.bytes).toBe(byteLen(text));
  });

  it("garbage and invalid-event lines are skipped and advance the cursor", () => {
    const text = "not json\n" + '{"type":"nope","at":"x","commit":1}\n' + '{"type":"task_passed","at":"x","commit":-1}\n' + ev(4);
    const r = parseLedger(enc(text));
    expect(codes(r)).toEqual(["LEDGER_LINE_SKIPPED", "LEDGER_LINE_SKIPPED", "LEDGER_LINE_SKIPPED"]);
    expect(lineNos(r)).toEqual(["1", "2", "3"]);
    expect(commits(r)).toEqual([4]);
    expect(r.endCursor).toEqual({ lines: 4, bytes: byteLen(text), lastLineSha256: sha256(ev(4)) });
  });

  it("CRLF lines: endByte and hash include the \\r\\n terminator", () => {
    const a = crlf(ev(1));
    const b = crlf(ev(2));
    const r = parseLedger(enc(a + b));
    expect(commits(r)).toEqual([1, 2]);
    expect(r.tail.map((l) => l.endByte)).toEqual([byteLen(a), byteLen(a + b)]);
    expect(r.endCursor.lastLineSha256).toBe(sha256(b));
    // Core sha256 normalizes line endings, so the byte offset (not the hash) catches a CRLF<->LF rewrite.
    expect(parseLedger(enc(a + ev(2)), r.endCursor).rewritten).toBe(true);
    expect(parseLedger(enc(a + b + crlf(ev(3))), r.endCursor).events.map((e) => e.commit)).toEqual([3]);
  });

  it("multibyte content: endByte counts UTF-8 bytes, not characters", () => {
    const a = ev(1, ',"filesTouched":["é.ts","日本/語.ts","🙂.md"]');
    const b = ev(2);
    const r = parseLedger(enc(a + b));
    expect(a.length).toBeLessThan(byteLen(a));
    expect(r.tail.map((l) => l.endByte)).toEqual([byteLen(a), byteLen(a + b)]);
    expect(r.events[0]?.filesTouched).toEqual(["é.ts", "日本/語.ts", "🙂.md"]);
    const cur = parseLedger(enc(a)).endCursor;
    expect(cur).toEqual({ lines: 1, bytes: byteLen(a), lastLineSha256: sha256(a) });
    expect(commits(parseLedger(enc(a + b), cur))).toEqual([2]);
  });
});

describe("ledger reader: cursor", () => {
  const base = ev(1) + ev(2);
  const cur = parseLedger(enc(base)).endCursor;

  it("matching cursor returns only later lines with absolute line numbers", () => {
    const r = parseLedger(enc(base + "junk\n" + ev(3)), cur);
    expect(r.rewritten).toBe(false);
    expect(r.tail.map((l) => l.lineNo)).toEqual([3, 4]);
    expect(commits(r)).toEqual([3]);
    expect(lineNos(r)).toEqual(["3"]);
  });

  it("cursor at the current end yields nothing new and keeps the cursor", () => {
    const r = parseLedger(enc(base), cur);
    expect(r.rewritten).toBe(false);
    expect(r.tail).toEqual([]);
    expect(r.endCursor).toEqual(cur);
    expect(r.diagnostics).toEqual([]);
  });

  const expectRewritten = (r: ReturnType<typeof parseLedger>, end: string): void => {
    expect(r.rewritten).toBe(true);
    expect(r.tail).toEqual([]);
    expect(r.events).toEqual([]);
    expect(codes(r)).toContain("LEDGER_REWRITTEN");
    expect(r.endCursor).toEqual(parseLedger(enc(end)).endCursor);
  };

  it("hash mismatch (same length) is a rewrite", () => {
    const text = ev(1) + ev(9) + ev(3);
    expectRewritten(parseLedger(enc(text), cur), text);
  });

  it("byte mismatch at the cursor line is a rewrite", () => {
    const text = ev(1) + ev(22) + ev(3);
    expectRewritten(parseLedger(enc(text), cur), text);
  });

  it("cursor.lines beyond the file length is a rewrite", () => {
    expectRewritten(parseLedger(enc(ev(1)), cur), ev(1));
    expectRewritten(parseLedger(new Uint8Array(0), cur), "");
  });
});

describe("ledger reader: append then read (Req 12.6)", () => {
  let root = "";
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-ledger-")));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const line = (e: LedgerEvent): string => stableLine(e, KEY_ORDERS.ledgerLine);

  it("reading with the previous endCursor yields exactly the appended events", async () => {
    // No appender module exists yet: simulate it by rewriting existing bytes + new stableLine bytes.
    const fsx = createWorkspaceFs(root);
    const first: LedgerEvent[] = [{ type: "task_passed", at: "2026-01-01T00:00:00Z", commit: 1, filesTouched: ["é.ts"] }];
    const added: LedgerEvent[] = [
      { type: "spec_cited", at: "2026-01-02T00:00:00Z", commit: 2, cited: ["日本"] },
      { type: "manual_pin", at: "2026-01-03T00:00:00Z", commit: 3 },
    ];
    await fsx.writeAtomic(LEDGER_REL, first.map(line).join(""));
    const r1 = await loadLedger(fsx);
    if (!r1.ok) throw new Error("load failed");
    expect(r1.value.events).toEqual(first);

    const existing = await fsx.readBytes(LEDGER_REL);
    if (!existing.ok || existing.value === undefined) throw new Error("read failed");
    await fsx.writeAtomic(LEDGER_REL, new Uint8Array([...existing.value, ...enc(added.map(line).join(""))]));

    const r2 = await loadLedger(fsx, r1.value.endCursor);
    if (!r2.ok) throw new Error("load failed");
    expect(r2.value.rewritten).toBe(false);
    expect(r2.value.events).toEqual(added);
    const all = [...first, ...added].map(line).join("");
    expect(r2.value.endCursor).toEqual(parseLedger(enc(all)).endCursor);
  });

  it("an absent ledger is empty with the zero cursor", async () => {
    const r = await loadLedger(createWorkspaceFs(root));
    expect(r.ok && r.value.endCursor).toEqual(ZERO_CURSOR);
    expect(r.ok && r.value.events).toEqual([]);
  });
});
