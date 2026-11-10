// End-to-end runCli rows of the exit-code table that were mapper-only. Refs: Req 13.3, 13.6, 12, 19, 20
// Row 16 (serve 0/130/143) is covered by test/server-stdio.unit.test.ts; PATH_ESCAPE has no CLI route
// and stays mapper-only in cli-run-matrix.unit.test.ts.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { FIXED, makeWorkspace, putFile, runIn } from "./support/cli-harness.js";

const FILE = ".kiro/steering/a.md";
let dir = "";
beforeEach(() => {
  dir = makeWorkspace({ [FILE]: "# A\n\n## Keep\nKeep me.\n" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tomb: TombstoneRecord = {
  schema: 1, id: "a-redux", file: FILE, headingPath: ["Redux"], body: "## Redux\nUse Redux.\n", raw: "## Redux\nUse Redux.\n",
  contentHash: "0".repeat(64), tokens: 3, meta: { globs: [], specLinks: [], pinned: false },
  state: { id: "a-redux", stability: 9, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 4 },
  reason: "decayed", retentionAtDeath: 0.1, buriedAtCommit: 1, buriedAt: "2026-01-02T00:00:00.000Z", position: { index: 1 },
};

describe("OK rows exit 0", () => {
  it("sleep dry-run with a passing gate", async () => {
    const r = await runIn(dir, ["sleep", ...FIXED]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toBe("");
  });

  it("resurrect dry-run listing a real tombstone", async () => {
    putFile(dir, ".kiro/crypt/tombstones.json", serializeTombstones([tomb]));
    const r = await runIn(dir, ["resurrect", "--query", "a-redux", "--json", ...FIXED]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("a-redux");
    expect(readFileSync(join(dir, FILE), "utf8")).toBe("# A\n\n## Keep\nKeep me.\n");
  });

  it("adopt dry-run and --apply on a clean workspace", async () => {
    expect((await runIn(dir, ["adopt", ...FIXED])).exitCode).toBe(0);
    expect((await runIn(dir, ["adopt", "--apply", ...FIXED])).exitCode).toBe(0);
  });

  it("probe writes a capture from stdin JSON", async () => {
    const r = await runIn(dir, ["probe", ...FIXED], {}, '{"hook_event_name":"PostFileSave"}');
    expect(r.exitCode).toBe(0);
    expect(r.stdinReads).toBe(1);
  });
});

describe("write failures exit 74", () => {
  it("probe: .kiro/lethe/probe is a file so mkdir fails", async () => {
    putFile(dir, ".kiro/lethe/probe", "not a directory");
    const r = await runIn(dir, ["probe", "--json", ...FIXED], {}, '{"hook_event_name":"PostFileSave"}');
    expect(r.exitCode).toBe(74);
    expect((JSON.parse(r.stdout) as { ok: boolean }).ok).toBe(false);
  });

  it("record: .kiro/lethe/ledger.jsonl is a directory so the append fails", async () => {
    mkdirSync(join(dir, ".kiro", "lethe", "ledger.jsonl"), { recursive: true });
    writeFileSync(join(dir, ".kiro", "lethe", "ledger.jsonl", "x"), "");
    const r = await runIn(dir, ["record", "--type", "task_passed", "--files", "a.ts", "--json", ...FIXED]);
    expect(r.exitCode).toBe(74);
  });
});
