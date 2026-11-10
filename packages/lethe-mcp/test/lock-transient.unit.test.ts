// Regression: transient Windows EPERM/EBUSY/EACCES on the lock path is contention, not failure (found by lock-race.perf).
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toolError } from "../src/envelope/errors.js";
import { acquireLock } from "../src/io/lock.js";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";

let root = "";
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-lock-tr-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const eperm = (code = "EPERM") => err(toolError("IO_FAILED", "File operation failed.", { code, path: ".kiro/lethe/lock" }));

function flaky(base: WorkspaceFs, fail: { writeExclusive?: number; readText?: number }, code?: string): WorkspaceFs {
  const left = { ...fail };
  return {
    ...base,
    writeExclusive: (rel, c) => ((left.writeExclusive ?? 0) > 0 ? (left.writeExclusive = (left.writeExclusive ?? 0) - 1, Promise.resolve(eperm(code))) : base.writeExclusive(rel, c)),
    readText: (rel) => ((left.readText ?? 0) > 0 ? (left.readText = (left.readText ?? 0) - 1, Promise.resolve(eperm(code))) : base.readText(rel)),
  };
}

describe("lock acquire under transient errno", () => {
  it("retries a single EPERM on writeExclusive and succeeds", async () => {
    const fsx = flaky(createWorkspaceFs(root), { writeExclusive: 1 });
    const r = await acquireLock(fsx, { waitMs: 1000, pollMs: 1 });
    expect(r.ok).toBe(true);
  });

  it.each(["EPERM", "EBUSY", "EACCES"])("retries %s on readText of a held lock until it is released", async (code) => {
    const base = createWorkspaceFs(root);
    await base.mkdirp(".kiro/lethe");
    writeFileSync(join(root, ".kiro", "lethe", "lock"), "{}"); // held (unparseable, never stale)
    const fsx = flaky(base, { readText: 2 }, code);
    let polls = 0;
    const sleep = async (): Promise<void> => {
      if (++polls === 4) await base.remove(".kiro/lethe/lock");
    };
    const r = await acquireLock(fsx, { waitMs: 60_000, pollMs: 1, sleep });
    expect(r.ok).toBe(true);
    expect(polls).toBe(4);
  });

  it("persistent EPERM beyond the budget ends as IO_FAILED (a real fault, not a holder), not LOCKED", async () => {
    const fsx = flaky(createWorkspaceFs(root), { writeExclusive: 1_000_000 });
    let t = 0;
    const r = await acquireLock(fsx, { waitMs: 100, pollMs: 1, clock: () => (t += 10), sleep: async () => undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("IO_FAILED");
  });

  it("non-transient IO errors still fail immediately", async () => {
    const fsx = flaky(createWorkspaceFs(root), { writeExclusive: 1 }, "ENOSPC");
    const r = await acquireLock(fsx, { waitMs: 1000, pollMs: 1 });
    expect(r.ok).toBe(false);
  });
});

describe("lock acquire under a transient PATH_ESCAPE", () => {
  it("retries a PATH_ESCAPE from the non-atomic guard probe (lock deleted between exists and realpath)", async () => {
    const base = createWorkspaceFs(root);
    let n = 0;
    const fsx: WorkspaceFs = {
      ...base,
      writeExclusive: (rel, c) => (n++ < 2 ? Promise.resolve(err(toolError("PATH_ESCAPE", "Path escapes the workspace.", { path: rel }))) : base.writeExclusive(rel, c)),
    };
    const r = await acquireLock(fsx, { waitMs: 1000, pollMs: 1 });
    expect(r.ok).toBe(true);
    expect(n).toBe(3);
  });
});