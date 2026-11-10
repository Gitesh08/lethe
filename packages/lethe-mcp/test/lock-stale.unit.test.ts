// Stale detection, retry/LOCKED, token-checked release, finally-release and signal handling for the lock.
// Refs: Req 9.2, 9.3, 9.4
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, nodePidProbe, withLock, type LockOptions, type LockSignal, type SignalSeam } from "../src/io/lock.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";

const T0 = Date.parse("2026-11-09T12:00:00.000Z");
let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-lockstale-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lockFile = (): string => join(root, ".kiro", "lethe", "lock");
const plant = (o: { pid?: number; host?: string; startedAt?: string; token?: string }): void => {
  mkdirSync(dirname(lockFile()), { recursive: true });
  writeFileSync(lockFile(), JSON.stringify({ pid: 111, host: "H", startedAt: new Date(T0 - 601_000).toISOString(), token: "old", ...o }));
};
const tokenOnDisk = (): string => (JSON.parse(readFileSync(lockFile(), "utf8")) as { token: string }).token;

interface Fake { opts: LockOptions; sleeps: number[]; probed: number[]; now(): number }
function fake(extra: LockOptions = {}, alive = false): Fake {
  let now = T0;
  const sleeps: number[] = [];
  const probed: number[] = [];
  const opts: LockOptions = {
    clock: () => now,
    sleep: (ms) => { sleeps.push(ms); now += ms; return Promise.resolve(); },
    hostname: () => "H",
    pid: 999,
    probe: (p) => { probed.push(p); return alive; },
    signals: { on: () => undefined, off: () => undefined },
    newToken: () => "new",
    waitMs: 200,
    pollMs: 50,
    ...extra,
  };
  return { opts, sleeps, probed, now: () => now };
}

describe("stale detection", () => {
  it("takes over an old lock from this host whose pid is dead", async () => {
    plant({});
    const f = fake();
    const r = await acquireLock(createWorkspaceFs(root), f.opts);
    expect(r.ok).toBe(true);
    expect(f.probed).toEqual([111]);
    expect(tokenOnDisk()).toBe("new");
    expect(f.sleeps).toEqual([]);
  });

  const notStale: Array<[string, Parameters<typeof plant>[0], boolean]> = [
    ["live pid", {}, true],
    ["foreign host", { host: "other" }, false],
    ["young lock (599 s)", { startedAt: new Date(T0 - 599_000).toISOString() }, false],
    ["exactly at the threshold (600 s)", { startedAt: new Date(T0 - 600_000).toISOString() }, false],
    ["invalid startedAt", { startedAt: "not-a-date" }, false],
  ];
  it.each(notStale)("does not break the lock: %s", async (_name, lock, alive) => {
    plant(lock);
    const f = fake({ waitMs: 0 }, alive); // no waiting: the fake clock would otherwise age the lock past the threshold
    const r = await acquireLock(createWorkspaceFs(root), f.opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("LOCKED");
    expect(tokenOnDisk()).toBe("old");
  });

  it("does not break an unparseable lock file and reports no holder", async () => {
    mkdirSync(dirname(lockFile()), { recursive: true });
    writeFileSync(lockFile(), "{ garbage");
    const r = await acquireLock(createWorkspaceFs(root), fake().opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("LOCKED");
      expect(r.error.detail).toBeUndefined();
    }
    expect(readFileSync(lockFile(), "utf8")).toBe("{ garbage");
  });
});

describe("retry loop", () => {
  it("polls every pollMs until the budget is exhausted, then LOCKED with holder detail", async () => {
    plant({ startedAt: new Date(T0).toISOString(), host: "other", pid: 55 });
    const f = fake();
    const r = await acquireLock(createWorkspaceFs(root), f.opts);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("LOCKED");
    expect(r.error.detail).toEqual({ pid: 55, host: "other", startedAt: new Date(T0).toISOString() });
    expect(f.sleeps).toEqual([50, 50, 50, 50]);
  });

  it("acquires when the lock disappears while waiting", async () => {
    plant({ startedAt: new Date(T0).toISOString(), host: "other" });
    const f = fake();
    const inner = f.opts.sleep;
    const opts: LockOptions = { ...f.opts, sleep: async (ms) => { rmSync(lockFile()); await inner?.(ms); } };
    const r = await acquireLock(createWorkspaceFs(root), opts);
    expect(r.ok).toBe(true);
    expect(f.sleeps).toEqual([50]);
    expect(tokenOnDisk()).toBe("new");
  });
});

describe("release", () => {
  it("does not delete a lock that now belongs to someone else", async () => {
    const r = await acquireLock(createWorkspaceFs(root), fake().opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    plant({ token: "someone-else", startedAt: new Date(T0).toISOString() });
    await r.value.release();
    expect(tokenOnDisk()).toBe("someone-else");
  });

  it("is idempotent and never removes a later holder's lock", async () => {
    const r = await acquireLock(createWorkspaceFs(root), fake().opts);
    if (!r.ok) throw new Error("expected lock");
    await r.value.release();
    expect(existsSync(lockFile())).toBe(false);
    plant({ token: "next" });
    await r.value.release();
    expect(tokenOnDisk()).toBe("next");
  });

  it("withLock releases after success and after a throw", async () => {
    const fsx = createWorkspaceFs(root);
    const ok = await withLock(fsx, fake().opts, () => Promise.resolve(existsSync(lockFile())));
    expect(ok).toEqual({ ok: true, value: true });
    expect(existsSync(lockFile())).toBe(false);
    await expect(withLock(fsx, fake().opts, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(existsSync(lockFile())).toBe(false);
  });

  it("withLock does not run the body when LOCKED", async () => {
    plant({ startedAt: new Date(T0).toISOString(), host: "other" });
    let ran = false;
    const r = await withLock(createWorkspaceFs(root), fake().opts, () => { ran = true; return Promise.resolve(1); });
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
});

describe("signal handlers", () => {
  function seam(): SignalSeam & { live: Map<LockSignal, () => void>; added: number; removed: number } {
    const live = new Map<LockSignal, () => void>();
    const s = {
      live, added: 0, removed: 0,
      on(sig: LockSignal, h: () => void) { live.set(sig, h); s.added++; },
      off(sig: LockSignal, h: () => void) { if (live.get(sig) === h) live.delete(sig); s.removed++; },
    };
    return s;
  }

  it("registers SIGINT and SIGTERM on acquire and removes both on release", async () => {
    const signals = seam();
    const r = await acquireLock(createWorkspaceFs(root), fake({ signals }).opts);
    if (!r.ok) throw new Error("expected lock");
    expect([...signals.live.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    await r.value.release();
    expect(signals.live.size).toBe(0);
    expect(signals.removed).toBe(2);
  });

  it.each<LockSignal>(["SIGINT", "SIGTERM"])("%s handler releases the lock then re-raises the signal", async (sig) => {
    const signals = seam();
    const raised = new Promise<LockSignal>((resolve) => {
      void acquireLock(createWorkspaceFs(root), fake({ signals, reraise: resolve }).opts).then(() => signals.live.get(sig)?.());
    });
    expect(await raised).toBe(sig);
    expect(existsSync(lockFile())).toBe(false);
    expect(signals.live.size).toBe(0);
  });
});

describe("nodePidProbe", () => {
  it("reports the current process as alive", () => {
    expect(nodePidProbe(process.pid)).toBe(true);
  });
});
