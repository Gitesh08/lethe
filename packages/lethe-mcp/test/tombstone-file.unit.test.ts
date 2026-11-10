// Tests for loadTombstones. Refs: Req 10.11, Req 8.6
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadTombstones, TOMBSTONES_REL } from "../src/load/tombstone-file.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-tomb-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function record(id: string, commit: number): TombstoneRecord {
  return {
    schema: 1,
    id,
    file: ".kiro/steering/a.md",
    headingPath: ["A", id],
    body: "Use Redux.\r\n",
    raw: "## Redux\r\nUse Redux.\r\n",
    contentHash: "0".repeat(64),
    tokens: 3,
    meta: { globs: ["src/**"], specLinks: [], pinned: false },
    state: { id, stability: 5, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 0 },
    reason: "decayed",
    retentionAtDeath: 0.1,
    buriedAtCommit: commit,
    buriedAt: "2026-01-02T00:00:00.000Z",
    position: { index: 0 },
  };
}

async function expectInvalid(text: string): Promise<void> {
  const fsx = createWorkspaceFs(root);
  await fsx.writeAtomic(TOMBSTONES_REL, text);
  const r = await loadTombstones(fsx);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.code).toBe("CONFIG_INVALID");
  expect(JSON.stringify(r.error)).toContain("tombstones.json");
  expect(JSON.stringify(r.error)).not.toMatch(/\bat .*\(|stack/i);
}

describe("loadTombstones", () => {
  it("treats an absent file as an empty crypt", async () => {
    const r = await loadTombstones(createWorkspaceFs(root));
    expect(r.ok && r.value).toEqual([]);
  });

  it("parses a valid file into equal records", async () => {
    const fsx = createWorkspaceFs(root);
    const list = [record("a", 1), record("b", 2)];
    await fsx.writeAtomic(TOMBSTONES_REL, serializeTombstones(list));
    const r = await loadTombstones(fsx);
    expect(r.ok && r.value).toEqual(list);
  });

  it("reads on every call (no caching)", async () => {
    const fsx = createWorkspaceFs(root);
    const first = await loadTombstones(fsx);
    await fsx.writeAtomic(TOMBSTONES_REL, serializeTombstones([record("a", 1)]));
    const second = await loadTombstones(fsx);
    expect(first.ok && first.value.length).toBe(0);
    expect(second.ok && second.value.length).toBe(1);
  });

  it("rejects malformed JSON", () => expectInvalid("{not json"));
  it("rejects a wrong version", () => expectInvalid('{"version":2,"tombstones":[]}'));
  it("rejects an invalid record", () => expectInvalid('{"version":1,"tombstones":[{"schema":1}]}'));
});
