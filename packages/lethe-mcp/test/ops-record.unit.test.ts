// Focused unit tests for ops/record.ts. Refs: Req 12.1, 12.2, 12.3, 12.4, 12.5, 12.7
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitRunner } from "../src/io/git.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { recordOp } from "../src/ops/record.js";

const NOW = "2026-11-10T12:00:00.000Z";
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-record-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(files: ReadonlyArray<string> | undefined): GitRunner {
  return { commitCount: async () => undefined, changedFiles: async () => files };
}
async function ctx(g: GitRunner = git([]), warnings: string[] = []): Promise<RunContext> {
  const r = await buildContext({ workspacePath: dir, commit: 7, now: NOW }, { git: g, lock: { waitMs: 0 }, log: (m) => void warnings.push(m) });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const read = (rel: string): string => readFileSync(join(dir, ...rel.split("/")), "utf8");

describe("recordOp", () => {
  it("appends one event and stamps state.json", async () => {
    const r = await recordOp(await ctx(), { type: "task_passed", files: ["src/a.ts", "src/a.ts"], cited: ["x"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event).toEqual({ type: "task_passed", at: NOW, commit: 7, filesTouched: ["src/a.ts"], cited: ["x"] });
    expect(read(".kiro/lethe/ledger.jsonl")).toBe(
      `{"type":"task_passed","at":"${NOW}","commit":7,"filesTouched":["src/a.ts"],"cited":["x"]}\n`,
    );
    expect(r.value.stateUpdated).toBe(true);
    expect(r.value.degraded).toBe(false);
    expect(r.value.summary).toContain("estimated utility");
    expect(JSON.parse(read(".kiro/lethe/state.json"))).toMatchObject({ commit: 7 });
  });

  it("requires cited for spec_cited and manual_pin and writes nothing", async () => {
    for (const type of ["spec_cited", "manual_pin"] as const) {
      const r = await recordOp(await ctx(), { type, cited: [" "] });
      expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
    }
    expect(() => read(".kiro/lethe/ledger.jsonl")).toThrow();
  });

  it("task_passed with nothing says it matches no engram", async () => {
    const r = await recordOp(await ctx(), { type: "task_passed" });
    expect(r.ok && r.value.matchesNoEngram).toBe(true);
    expect(r.ok && r.value.summary).toContain("matches no engram");
  });

  it("caps --files-from-git at 500 with a FILES_TRUNCATED diagnostic", async () => {
    const names = Array.from({ length: 501 }, (_, i) => `f/${String(i).padStart(4, "0")}.ts`);
    const r = await recordOp(await ctx(git(names)), { type: "task_passed", filesFromGit: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.filesTouched?.length).toBe(500);
    expect(r.value.diagnostics.map((d) => d.code)).toContain("FILES_TRUNCATED");
  });

  it("reports GIT_FILES_UNAVAILABLE and drops escaping paths with a warning", async () => {
    const warnings: string[] = [];
    const r = await recordOp(await ctx(git(undefined), warnings), {
      type: "task_passed",
      filesFromGit: true,
      files: ["../outside.ts", "ok.ts"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.filesTouched).toEqual(["ok.ts"]);
    expect(warnings.length).toBe(1);
    const codes = r.value.diagnostics.map((d) => d.code);
    expect(codes).toContain("GIT_FILES_UNAVAILABLE");
    expect(codes).toContain("PATH_DROPPED");
  });

  it("degrades to STATE_NOT_UPDATED when the lock is held, keeping the event", async () => {
    mkdirSync(join(dir, ".kiro", "lethe", "lock"), { recursive: true });
    writeFileSync(join(dir, ".kiro", "lethe", "lock", "owner.json"), JSON.stringify({ pid: process.pid, host: "x", startedAt: NOW }));
    const r = await recordOp(await ctx(), { type: "task_passed", files: ["a.ts"], lockWaitMs: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.degraded).toBe(true);
    expect(r.value.diagnostics.map((d) => d.code)).toContain("STATE_NOT_UPDATED");
    expect(read(".kiro/lethe/ledger.jsonl")).toContain('"filesTouched":["a.ts"]');
  });
});
