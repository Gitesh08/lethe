// Task 6.11 — ledger append. Refs: Req 9.6, Req 10.8, Req 10.10
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@lethe/core";
import { appendLineWith, type AppendHandle, type AppendOps } from "../src/io/fs-append.js";
import { LEDGER_REL, parseLedger } from "../src/load/ledger-file.js";
import { appendLedgerEvent } from "../src/persist/ledger-append.js";
import { createMemoryFs } from "./support/memory-fs.js";

const ev: LedgerEvent = { type: "task_passed", at: "2026-11-20T10:00:00Z", commit: 7, filesTouched: ["a.ts"], cited: ["x"] };
const dec = (b: Uint8Array | undefined): string => new TextDecoder().decode(b);

describe("appendLedgerEvent", () => {
  it("creates an absent ledger with one key-ordered line", async () => {
    const fs = createMemoryFs();
    const r = await appendLedgerEvent(fs, { cited: ["x"], commit: 7, filesTouched: ["a.ts"], at: ev.at, type: ev.type });
    expect(r.ok).toBe(true);
    expect(dec(fs.files.get(LEDGER_REL))).toBe(
      '{"type":"task_passed","at":"2026-11-20T10:00:00Z","commit":7,"filesTouched":["a.ts"],"cited":["x"]}\n',
    );
  });

  it("adds a leading newline after a torn fragment; the fragment becomes a skipped line", async () => {
    const fs = createMemoryFs();
    fs.files.set(LEDGER_REL, new TextEncoder().encode('{"type":"task_pa'));
    await appendLedgerEvent(fs, ev);
    const text = dec(fs.files.get(LEDGER_REL));
    expect(text.startsWith('{"type":"task_pa\n{"type":"task_passed"')).toBe(true);
    const read = parseLedger(fs.files.get(LEDGER_REL) ?? new Uint8Array());
    expect(read.events).toEqual([ev]);
    expect(read.diagnostics.map((d) => d.code)).toContain("LEDGER_LINE_SKIPPED");
  });

  it("adds no extra newline when the file already ends with one, and round-trips", async () => {
    const fs = createMemoryFs();
    await appendLedgerEvent(fs, ev);
    await appendLedgerEvent(fs, { ...ev, commit: 8 });
    const text = dec(fs.files.get(LEDGER_REL));
    expect(text.split("\n")).toHaveLength(3);
    expect(parseLedger(fs.files.get(LEDGER_REL) ?? new Uint8Array()).events.map((e) => e.commit)).toEqual([7, 8]);
  });

  it("rejects an invalid event as INVALID_INPUT and writes nothing", async () => {
    const fs = createMemoryFs();
    const r = await appendLedgerEvent(fs, { ...ev, commit: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_INPUT");
    expect(fs.files.has(LEDGER_REL)).toBe(false);
  });
});

function spyOps(initial: string): { ops: AppendOps; writes: string[]; closed: () => boolean } {
  let data = new TextEncoder().encode(initial);
  const writes: string[] = [];
  let closed = false;
  const h: AppendHandle = {
    size: async () => data.length,
    byteAt: async (p) => data[p] ?? 0,
    write: async (b) => {
      writes.push(dec(b));
      data = Uint8Array.from([...data, ...b]);
    },
    sync: async () => undefined,
    close: async () => void (closed = true),
  };
  return { ops: { mkdirp: async () => undefined, open: async () => h }, writes, closed: () => closed };
}

describe("appendLineWith", () => {
  it("performs exactly one write of the line when the file ends with a newline", async () => {
    const s = spyOps("a\n");
    await appendLineWith(s.ops, "/x/l.jsonl", "b\n");
    expect(s.writes).toEqual(["b\n"]);
    expect(s.closed()).toBe(true);
  });

  it("writes the leading newline first, then one write of the line", async () => {
    const s = spyOps("frag");
    await appendLineWith(s.ops, "/x/l.jsonl", "b\n");
    expect(s.writes).toEqual(["\n", "b\n"]);
  });

  it("writes no leading newline to an empty file", async () => {
    const s = spyOps("");
    await appendLineWith(s.ops, "/x/l.jsonl", "b\n");
    expect(s.writes).toEqual(["b\n"]);
  });
});
