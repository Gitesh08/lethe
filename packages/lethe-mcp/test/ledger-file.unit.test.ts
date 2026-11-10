// Ledger reader basics. Refs: Req 10.8, Req 10.9, Req 23.7
import { sha256 } from "@lethe/core";
import { describe, expect, it } from "vitest";
import { parseLedger } from "../src/load/ledger-file.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const ev = (commit: number, extra = ""): string =>
  `{"type":"task_passed","at":"2026-01-01T00:00:00Z","commit":${commit}${extra}}\n`;
const codes = (r: ReturnType<typeof parseLedger>): string[] => r.diagnostics.map((d) => d.code);

describe("parseLedger", () => {
  it("parses valid lines and builds the end cursor", () => {
    const text = ev(1) + ev(2, ',"cited":["a"]');
    const r = parseLedger(enc(text));
    expect(r.events.map((e) => e.commit)).toEqual([1, 2]);
    expect(r.endCursor).toEqual({ lines: 2, bytes: text.length, lastLineSha256: sha256(ev(2, ',"cited":["a"]')) });
    expect(r.diagnostics).toEqual([]);
  });

  it("ignores an unterminated final line", () => {
    const r = parseLedger(enc(ev(1) + '{"type":"task_pa'));
    expect(r.events).toHaveLength(1);
    expect(r.endCursor.lines).toBe(1);
    expect(codes(r)).toEqual(["LEDGER_TORN_TAIL"]);
  });

  it("skips blank, garbage, and invalid lines but counts them", () => {
    const r = parseLedger(enc(ev(1) + "\n" + "garbage\n" + '{"type":"nope","at":"x","commit":1}\n' + ev(5)));
    expect(r.events.map((e) => e.commit)).toEqual([1, 5]);
    expect(r.endCursor.lines).toBe(5);
    expect(r.diagnostics.map((d) => d.message.match(/line (\d+)/)?.[1])).toEqual(["2", "3", "4"]);
    expect(codes(r)).toEqual(["LEDGER_LINE_SKIPPED", "LEDGER_LINE_SKIPPED", "LEDGER_LINE_SKIPPED"]);
  });

  it("returns only events after a matching cursor", () => {
    const first = parseLedger(enc(ev(1) + ev(2)));
    const r = parseLedger(enc(ev(1) + ev(2) + ev(3)), first.endCursor);
    expect(r.rewritten).toBe(false);
    expect(r.events.map((e) => e.commit)).toEqual([3]);
    expect(r.tail[0]?.lineNo).toBe(3);
  });

  it("uses byte offsets with CRLF and multibyte content", () => {
    const line = ev(1, ',"cited":["café"]').replace("\n", "\r\n");
    const bytes = enc(line + ev(2));
    const cur = parseLedger(enc(line)).endCursor;
    expect(cur.bytes).toBe(enc(line).length);
    expect(cur.bytes).toBeGreaterThan(line.length);
    expect(parseLedger(bytes, cur).events.map((e) => e.commit)).toEqual([2]);
  });

  it("reports LEDGER_REWRITTEN on hash mismatch or truncation", () => {
    const cur = parseLedger(enc(ev(1) + ev(2))).endCursor;
    const changed = parseLedger(enc(ev(1) + ev(9)), cur);
    expect(changed.rewritten).toBe(true);
    expect(changed.events).toEqual([]);
    expect(codes(changed)).toContain("LEDGER_REWRITTEN");
    expect(changed.endCursor.lines).toBe(2);
    const short = parseLedger(enc(ev(1)), cur);
    expect(short.rewritten).toBe(true);
    expect(short.endCursor.lines).toBe(1);
  });
});
