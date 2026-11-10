import { describe, expect, it } from "vitest";
import { parseJournal } from "../src/persist/journal.js";

const good = {
  version: 1,
  startedAt: "2026-11-20T10:00:00.000Z",
  pid: 42,
  files: [{ path: "a.md", existed: true }],
};

function parse(patch: Record<string, unknown>): ReturnType<typeof parseJournal> {
  return parseJournal(JSON.stringify({ ...good, ...patch }));
}

describe("parseJournal rejects malformed journals (Req 8.10)", () => {
  it("accepts a well-formed journal with and without backupDir", () => {
    expect(parse({})).toEqual(good);
    expect(parse({ backupDir: "b" })).toEqual({ ...good, backupDir: "b" });
  });

  it("rejects wrong version, bad pid, bad startedAt", () => {
    expect(parse({ version: 2 })).toBeUndefined();
    expect(parse({ pid: "1" })).toBeUndefined();
    expect(parse({ startedAt: 5 })).toBeUndefined();
  });

  it("rejects bad files entries and non-string backupDir", () => {
    expect(parse({ files: "x" })).toBeUndefined();
    expect(parse({ files: [null] })).toBeUndefined();
    expect(parse({ files: [{ path: "a", existed: "yes" }] })).toBeUndefined();
    expect(parse({ files: [{ path: 1, existed: true }] })).toBeUndefined();
    expect(parse({ backupDir: 7 })).toBeUndefined();
  });

  it("rejects non-JSON and non-object text", () => {
    expect(parseJournal("not json")).toBeUndefined();
    expect(parseJournal("[]")).toBeUndefined();
  });
});
