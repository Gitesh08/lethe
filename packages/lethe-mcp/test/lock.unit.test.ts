// Happy-path tests for the workspace lock (stale/token/signal detail: task 4.11). Refs: Req 9.1, 9.2, 9.4
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, withLock, type LockSignal, type SignalSeam } from "../src/io/lock.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-lock-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lockFile = (): string => join(root, ".kiro", "lethe", "lock");

function fakeSignals(): SignalSeam & { count(): number } {
  const live: Array<[LockSignal, () => void]> = [];
  return {
    on: (s, h) => void live.push([s, h]),
    off: (s, h) => {
      const i = live.findIndex(([ls, lh]) => ls === s && lh === h);
      if (i >= 0) live.splice(i, 1);
    },
    count: () => live.length,
  };
}

describe("workspace lock", () => {
  it("acquires with {pid,host,startedAt,token}, releases, and removes signal handlers", async () => {
    const fsx = createWorkspaceFs(root);
    const signals = fakeSignals();
    const r = await acquireLock(fsx, { signals, pid: 4242, hostname: () => "H", clock: () => Date.parse("2026-11-09T10:00:00.000Z"), newToken: () => "tok" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.parse(readFileSync(lockFile(), "utf8"))).toEqual({ pid: 4242, host: "H", startedAt: "2026-11-09T10:00:00.000Z", token: "tok" });
    expect(Object.keys(JSON.parse(readFileSync(lockFile(), "utf8")))).toEqual(["pid", "host", "startedAt", "token"]);
    expect(signals.count()).toBe(2);
    await r.value.release();
    expect(existsSync(lockFile())).toBe(false);
    expect(signals.count()).toBe(0);
  });

  it("returns LOCKED with holder detail when the wait budget is exhausted", async () => {
    const fsx = createWorkspaceFs(root);
    const first = await acquireLock(fsx, { signals: fakeSignals(), pid: 7, hostname: () => "H" });
    expect(first.ok).toBe(true);
    const second = await acquireLock(fsx, { signals: fakeSignals(), waitMs: 20, pollMs: 5 });
    expect(second.ok).toBe(false);
    if (second.ok || !first.ok) return;
    expect(second.error.code).toBe("LOCKED");
    expect(second.error.detail).toMatchObject({ pid: 7, host: "H" });
    await first.value.release();
  });

  it("withLock releases when the body throws", async () => {
    const fsx = createWorkspaceFs(root);
    const signals = fakeSignals();
    await expect(withLock(fsx, { signals }, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(lockFile())).toBe(false);
    expect(signals.count()).toBe(0);
  });
});
