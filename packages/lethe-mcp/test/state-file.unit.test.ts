// Unit tests for load/state-file and persist/state-serialize. Refs: Req 10.6, 10.7, 10.12
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadStateFile, parseStateText } from "../src/load/state-file.js";
import { ZERO_CURSOR } from "../src/persist/ledger-cursor.js";
import { serializeState } from "../src/persist/state-serialize.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-state-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const SHA = "a".repeat(64);
const AT = "2026-11-20T10:00:00Z";
const st = (id: string, stability: number) => ({
  id,
  stability,
  lastReinforcedCommit: 3,
  lastReinforcedAt: AT,
  reinforcements: 1,
});

function put(text: string): void {
  const p = join(root, ".kiro", "lethe", "state.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

describe("loadStateFile", () => {
  it("absent file gives no states and a zero cursor", async () => {
    const r = await loadStateFile(createWorkspaceFs(root));
    expect(r.ok && r.value.states).toEqual([]);
    expect(r.ok && r.value.cursor).toEqual(ZERO_CURSOR);
  });

  it("reads a valid file, using keys as ids sorted ascending", async () => {
    put(serializeState({ commit: 9, at: AT, ledger: { lines: 2, bytes: 40, lastLineSha256: SHA }, engrams: [st("b", 2), st("a", 1.5)] }));
    const r = await loadStateFile(createWorkspaceFs(root));
    expect(r.ok && r.value.states).toEqual([st("a", 1.5), st("b", 2)]);
    expect(r.ok && r.value.cursor).toEqual({ lines: 2, bytes: 40, lastLineSha256: SHA });
    expect(r.ok && r.value.commit).toBe(9);
  });

  it("rejects malformed JSON and bad shapes with CONFIG_INVALID naming the key path", () => {
    const bad = parseStateText("{nope");
    expect(!bad.ok && bad.error.code).toBe("CONFIG_INVALID");
    const field = parseStateText(
      JSON.stringify({ version: 1, commit: 1, at: AT, ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams: { x: { stability: -1, lastReinforcedCommit: 0, lastReinforcedAt: AT, reinforcements: 0 } } }),
    );
    expect(!field.ok && field.error.code).toBe("CONFIG_INVALID");
    expect(!field.ok && field.error.detail).toEqual({ file: ".kiro/lethe/state.json", path: "engrams.x.stability" });
  });

  it("rejects a wrong version and a cursor with lines 0 but a hash", () => {
    const v = parseStateText(JSON.stringify({ version: 2, commit: 1, at: AT, ledger: ZERO_CURSOR, engrams: {} }));
    expect(!v.ok && v.error.code).toBe("CONFIG_INVALID");
    const c = parseStateText(JSON.stringify({ version: 1, commit: 1, at: AT, ledger: { lines: 0, bytes: 0, lastLineSha256: SHA }, engrams: {} }));
    expect(!c.ok && c.error.code).toBe("CONFIG_INVALID");
  });
});

describe("serializeState", () => {
  it("is byte-exact with ascending engram keys", () => {
    const text = serializeState({ commit: 5, at: AT, ledger: ZERO_CURSOR, engrams: [st("z", 1), st("a", 2)] });
    const e = (id: string, s: number) =>
      `    "${id}": {\n      "stability": ${s},\n      "lastReinforcedCommit": 3,\n      "lastReinforcedAt": "${AT}",\n      "reinforcements": 1\n    }`;
    expect(text).toBe(
      `{\n  "version": 1,\n  "commit": 5,\n  "at": "${AT}",\n  "ledger": {\n    "lines": 0,\n    "bytes": 0,\n    "lastLineSha256": null\n  },\n  "engrams": {\n${e("a", 2)},\n${e("z", 1)}\n  }\n}\n`,
    );
  });

  it("writes an empty engrams map as {}", () => {
    expect(serializeState({ commit: 0, at: AT, ledger: ZERO_CURSOR, engrams: [] })).toContain('"engrams": {}');
  });
});
