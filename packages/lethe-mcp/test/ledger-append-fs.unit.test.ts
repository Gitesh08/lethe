// Task 6.12 — ledger append and pbt-failures on a REAL filesystem. Refs: Req 9.6, Req 10.10, Req 12.6, Req 14.4
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LedgerEvent } from "@lethe/core";
import { appendPbtFailure, pbtFailureEntry } from "@lethe/core/properties";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { LEDGER_REL, loadLedger } from "../src/load/ledger-file.js";
import { appendLedgerEvent } from "../src/persist/ledger-append.js";
import { PBT_FAILURES_REL, writePbtFailure, type GateFailure } from "../src/persist/pbt-failures.js";

let root = "";
let fsx: WorkspaceFs;
const abs = (rel: string): string => join(root, ...rel.split("/"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lethe-ledger-fs-"));
  fsx = createWorkspaceFs(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const mk = (i: number): LedgerEvent => ({
  type: i % 3 === 0 ? "task_passed" : i % 3 === 1 ? "spec_cited" : "manual_pin",
  at: "2026-11-20T10:00:00Z",
  commit: i,
  filesTouched: [`src/f${i}.ts`, "ünï/çødé.ts"],
  cited: [`id-${i}`],
});
const seed = (rel: string, text: string): void => {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
};

describe("ledger append on disk", () => {
  it("round-trips many events through loadLedger", async () => {
    const events = Array.from({ length: 60 }, (_, i) => mk(i));
    for (const e of events) expect((await appendLedgerEvent(fsx, e)).ok).toBe(true);
    const read = await loadLedger(fsx);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.events).toEqual(events);
    expect(read.value.diagnostics).toEqual([]);
  });

  it("repairs a torn fragment: it becomes a skipped line and the new event is intact", async () => {
    seed(LEDGER_REL, `${JSON.stringify(mk(1))}\n{"type":"task_pa`);
    await appendLedgerEvent(fsx, mk(2));
    const text = readFileSync(abs(LEDGER_REL), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const read = await loadLedger(fsx);
    if (!read.ok) throw new Error("load failed");
    expect(read.value.events).toEqual([mk(1), mk(2)]);
    const codes = read.value.diagnostics.map((d) => d.code);
    expect(codes).toContain("LEDGER_LINE_SKIPPED");
    expect(codes).not.toContain("LEDGER_TORN_TAIL");
  });

  it("appends after an existing CRLF-terminated file", async () => {
    seed(LEDGER_REL, `${JSON.stringify(mk(1))}\r\n`);
    await appendLedgerEvent(fsx, mk(2));
    const read = await loadLedger(fsx);
    if (!read.ok) throw new Error("load failed");
    expect(read.value.events).toEqual([mk(1), mk(2)]);
    expect(read.value.diagnostics).toEqual([]);
  });
});

describe("pbt-failures on disk equals core's serializer", () => {
  const core = { pbtFailureEntry, appendPbtFailure };
  const fail = (n: number): GateFailure => ({ status: "failed", propertyId: `P${n}`, seed: n, counterexample: { a: [n] }, message: "m" });

  it("three sequential appends produce core's text byte for byte", async () => {
    let expected: string | undefined;
    for (const n of [1, 2, 3]) {
      const at = `2026-11-20T10:00:0${n}Z`;
      const r = await writePbtFailure(fsx, core, fail(n), at);
      expect(r.ok).toBe(true);
      expected = appendPbtFailure(expected, pbtFailureEntry(fail(n), at));
      expect(readFileSync(abs(PBT_FAILURES_REL), "utf8")).toBe(expected);
    }
  });
});
