// recordOp matrix: torn tail, truncation, dropped paths, no-match summary, first-record stamping.
// Refs: Req 10.10, 12.2, 12.3, 12.4, 12.7
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitRunner } from "../src/io/git.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadLedger } from "../src/load/ledger-file.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { recordOp } from "../src/ops/record.js";
import { scoreMemories } from "../src/ops/score.js";

const NOW = "2026-11-10T12:00:00.000Z";
const LEDGER = join(".kiro", "lethe", "ledger.jsonl");
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-record-matrix-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(files: ReadonlyArray<string> | undefined): GitRunner {
  return { commitCount: async () => undefined, changedFiles: async () => files };
}
async function ctxAt(commit: number, g: GitRunner = git([]), logs: string[] = []): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit, now: NOW }, { git: g, lock: { waitMs: 0 }, log: (m) => void logs.push(m) });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("recordOp matrix", () => {
  it("repairs a torn ledger tail before appending (Req 12.2)", async () => {
    mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
    writeFileSync(join(dir, LEDGER), '{"type":"task_passed","at":"2026-11-0');
    const r = await recordOp(await ctxAt(7), { type: "task_passed", files: ["a.ts"] });
    expect(r.ok).toBe(true);
    const text = readFileSync(join(dir, LEDGER), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n");
    expect(lines[0]).toBe('{"type":"task_passed","at":"2026-11-0');
    const read = await loadLedger(createWorkspaceFs(dir));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.tail.map((l) => l.event === null)).toEqual([true, false]);
    expect(read.value.events).toEqual([{ type: "task_passed", at: NOW, commit: 7, filesTouched: ["a.ts"] }]);
    expect(read.value.diagnostics.map((d) => d.code)).not.toContain("LEDGER_TORN_TAIL");
  });

  it("keeps exactly 500 of 501 git files and reports FILES_TRUNCATED (Req 12.3)", async () => {
    const names = Array.from({ length: 501 }, (_, i) => `f/${String(i).padStart(4, "0")}.ts`);
    const r = await recordOp(await ctxAt(7, git(names)), { type: "task_passed", filesFromGit: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.filesTouched).toHaveLength(500);
    expect(r.value.event.filesTouched?.[499]).toBe("f/0499.ts");
    expect(r.value.diagnostics.filter((d) => d.code === "FILES_TRUNCATED")).toHaveLength(1);
  });

  it("drops escaping relative and absolute paths with PATH_DROPPED and a stderr log (Req 12.4)", async () => {
    const bad = ["../x", resolve(dir, "..", "elsewhere.ts"), ...(process.platform === "win32" ? ["C:\\other\\y.ts"] : [])];
    const logs: string[] = [];
    const r = await recordOp(await ctxAt(7, git([]), logs), { type: "task_passed", files: [...bad, "ok.ts"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.filesTouched).toEqual(["ok.ts"]);
    expect(r.value.diagnostics.filter((d) => d.code === "PATH_DROPPED")).toHaveLength(bad.length);
    expect(logs.filter((m) => m.includes("dropped"))).toHaveLength(bad.length);
  });

  it("task_passed with no files states that it matches no engram", async () => {
    const r = await recordOp(await ctxAt(7), { type: "task_passed" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.matchesNoEngram).toBe(true);
    expect(r.value.summary).toContain("matches no engram");
    expect(r.value.event.filesTouched).toBeUndefined();
  });

  it("first record stamps engrams so later scores decay (Req 12.7)", async () => {
    const r = await recordOp(await ctxAt(7), { type: "task_passed", files: ["unrelated.ts"] });
    expect(r.ok && r.value.stateUpdated).toBe(true);
    const state = JSON.parse(readFileSync(join(dir, ".kiro", "lethe", "state.json"), "utf8")) as {
      engrams: Record<string, { lastReinforcedCommit: number }>;
    };
    const ids = Object.keys(state.engrams);
    expect(ids).toHaveLength(1);
    expect(state.engrams[ids[0] ?? ""]?.lastReinforcedCommit).toBe(7);

    const env = await scoreMemories(await ctxAt(12), { includeSpecs: false });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const e = env.data.engrams[0];
    expect(e?.firstSeen).toBe("persisted");
    expect(e?.deltaC).toBe(5);
    expect(e?.retention).toBeLessThan(1);
    expect(e?.retention).toBeCloseTo(Math.exp(-1), 10);
  });
});
