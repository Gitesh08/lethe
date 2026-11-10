// Unit tests for ops/context.ts and ops/mutate.ts. Refs: Req 4.6, 9.4, 11.5, 8.10
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { buildContext, type RunContext, type TraceStep } from "../src/ops/context.js";
import { withMutation } from "../src/ops/mutate.js";

const NOW = "2026-11-10T12:00:00.000Z";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lethe-ctx-"));
  mkdirSync(join(dir, ".kiro", "lethe"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };

async function ctxFor(trace?: TraceStep[], lockWait = 0): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: dir, commit: 7, now: NOW },
    { git: noGit, lock: { waitMs: lockWait }, log: () => undefined, gate: stubGate("passed"), ...(trace ? { trace: (s: TraceStep) => void trace.push(s) } : {}) },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe("buildContext", () => {
  it("applies commit and now overrides", async () => {
    const c = await ctxFor();
    expect(c.nowCommit).toBe(7);
    expect(c.commitSource).toBe("override");
    expect(c.nowISO).toBe(NOW);
    expect(c.diagnostics).toEqual([]);
  });

  it("reads the clock once and uses git when no override", async () => {
    let clockCalls = 0;
    const r = await buildContext(
      { workspacePath: dir },
      { git: { commitCount: async () => 42, changedFiles: async () => undefined }, clock: () => (clockCalls++, new Date(NOW)) },
    );
    expect(r.ok && r.value.nowCommit).toBe(42);
    expect(r.ok && r.value.commitSource).toBe("git");
    expect(clockCalls).toBe(1);
  });

  it("falls back to zero with a diagnostic when git is unavailable", async () => {
    const r = await buildContext({ workspacePath: dir, now: NOW }, { git: noGit });
    expect(r.ok && r.value.commitSource).toBe("zero");
    expect(r.ok && r.value.diagnostics.map((d) => d.code)).toEqual(["GIT_COMMIT_COUNT_UNAVAILABLE"]);
  });

  it("rejects missing and relative workspaces with INVALID_INPUT", async () => {
    const missing = await buildContext({ workspacePath: join(dir, "nope") });
    const rel = await buildContext({ workspacePath: "relative/dir" });
    expect(!missing.ok && missing.error.code).toBe("INVALID_INPUT");
    expect(!rel.ok && rel.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a malformed now", async () => {
    const r = await buildContext({ workspacePath: dir, now: "yesterday" });
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
  });
});

describe("withMutation", () => {
  it("runs lock, recover, load, body, release in order and releases the lock", async () => {
    const trace: TraceStep[] = [];
    const c = await ctxFor(trace);
    const r = await withMutation(c, async (loaded) => ok(loaded.cfg.budgetTokens));
    expect(r.ok).toBe(true);
    expect(trace).toEqual(["lock", "recover", "load", "body", "release"]);
    expect(existsSync(join(dir, ".kiro", "lethe", "lock"))).toBe(false);
  });

  it("releases the lock when the body throws", async () => {
    const c = await ctxFor();
    await expect(withMutation(c, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(join(dir, ".kiro", "lethe", "lock"))).toBe(false);
  });

  it("returns LOCKED without running the body or releasing the foreign lock", async () => {
    const lockFile = join(dir, ".kiro", "lethe", "lock");
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: "x", startedAt: new Date().toISOString(), token: "other" }));
    const trace: TraceStep[] = [];
    const c = await ctxFor(trace);
    let ran = false;
    const r = await withMutation(c, async () => { ran = true; return ok(1); });
    expect(!r.ok && r.error.code).toBe("LOCKED");
    expect(ran).toBe(false);
    expect(trace).toEqual(["lock"]);
    expect(existsSync(lockFile)).toBe(true);
  });

  it("recovers an interrupted apply before the body and attaches the diagnostic", async () => {
    const stray = join(dir, ".kiro", "steering", "stray.md");
    mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
    writeFileSync(stray, "created by interrupted apply\n");
    writeFileSync(
      join(dir, ".kiro", "lethe", "pending.json"),
      JSON.stringify({ version: 1, startedAt: NOW, pid: 1, files: [{ path: ".kiro/steering/stray.md", existed: false }] }),
    );
    const c = await ctxFor();
    const r = await withMutation(c, async () => ok(existsSync(stray)));
    expect(r.ok && r.value).toBe(false);
    expect(c.diagnostics.map((d) => d.code)).toEqual(["INTERRUPTED_APPLY_RECOVERED"]);
    expect(existsSync(join(dir, ".kiro", "lethe", "pending.json"))).toBe(false);
  });
});
