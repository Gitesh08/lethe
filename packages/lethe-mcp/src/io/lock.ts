// Workspace lock (Req 9.1-9.4): exclusive-create `.kiro/lethe/lock`, bounded retry, conservative stale
// takeover, token-checked release. Every environmental dependency is an injectable seam.
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleepMs } from "node:timers/promises";
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import { KEY_ORDERS, stableStringify } from "../persist/stable-json.js";
import { isTransient } from "./lock-transient.js";
import type { WorkspaceFs } from "./workspace-fs.js";

export const LOCK_DIR = ".kiro/lethe";
export const LOCK_PATH = ".kiro/lethe/lock";
export const DEFAULT_LOCK_WAIT_MS = 5000;
export const LOCK_POLL_MS = 50;
export const LOCK_STALE_AFTER_MS = 600_000;

/** `process.kill(pid, 0)` semantics: true when the process exists (including EPERM). */
export type PidProbe = (pid: number) => boolean;
export type LockSignal = "SIGINT" | "SIGTERM";

export interface SignalSeam {
  on(signal: LockSignal, handler: () => void): void;
  off(signal: LockSignal, handler: () => void): void;
}

export interface LockHolder { readonly pid: number; readonly host: string; readonly startedAt: string }
export interface LockHandle { readonly token: string; release(): Promise<void> }

export interface LockOptions {
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly staleAfterMs?: number;
  readonly clock?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly hostname?: () => string;
  readonly pid?: number;
  readonly probe?: PidProbe;
  readonly signals?: SignalSeam;
  /** Called after a signal handler released the lock; default re-raises the signal with default disposition. */
  readonly reraise?: (signal: LockSignal) => void;
  readonly newToken?: () => string;
  readonly log?: (message: string) => void;
}

const SIGNALS: readonly LockSignal[] = ["SIGINT", "SIGTERM"];

export const nodePidProbe: PidProbe = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: unknown }).code !== "ESRCH";
  }
};

const nodeSignals: SignalSeam = {
  on: (s, h) => void process.on(s, h),
  off: (s, h) => void process.off(s, h),
};

interface LockFile extends LockHolder { readonly token: string }

function parseLock(text: string): LockFile | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return undefined;
    const o = v as Record<string, unknown>;
    const { pid, host, startedAt, token } = o;
    if (typeof pid !== "number" || typeof host !== "string" || typeof startedAt !== "string" || typeof token !== "string") return undefined;
    return { pid, host, startedAt, token };
  } catch {
    return undefined;
  }
}

const holderOf = (f: LockFile | undefined): LockHolder | undefined =>
  f === undefined ? undefined : { pid: f.pid, host: f.host, startedAt: f.startedAt };

type Env = Required<Omit<LockOptions, "reraise" | "log">> & Pick<LockOptions, "reraise" | "log">;

function withDefaults(o: LockOptions): Env {
  // Explicitly-passed keys override; absent keys (exactOptionalPropertyTypes) fall back to the node defaults.
  return {
    waitMs: DEFAULT_LOCK_WAIT_MS,
    pollMs: LOCK_POLL_MS,
    staleAfterMs: LOCK_STALE_AFTER_MS,
    clock: Date.now,
    sleep: (ms: number) => sleepMs(ms),
    hostname,
    pid: process.pid,
    probe: nodePidProbe,
    signals: nodeSignals,
    newToken: () => randomBytes(8).toString("hex"),
    ...o,
  };
}

/** Stale only when older than the threshold, from this host, and the pid is not running (Req 9.3). */
function isStale(f: LockFile, env: Env): boolean {
  const started = Date.parse(f.startedAt);
  if (Number.isNaN(started)) return false;
  return env.clock() - started > env.staleAfterMs && f.host === env.hostname() && !env.probe(f.pid);
}

function makeHandle(fsx: WorkspaceFs, env: Env, token: string): LockHandle {
  let released = false;
  const handlers = new Map<LockSignal, () => void>();
  const log = env.log ?? ((m: string) => console.error(m));
  const detach = (): void => {
    for (const [s, h] of handlers) env.signals.off(s, h);
    handlers.clear();
  };
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    detach();
    const cur = await fsx.readText(LOCK_PATH);
    if (!cur.ok) return log(`lethe: lock release failed: ${cur.error.code}`);
    if (cur.value === undefined || parseLock(cur.value)?.token !== token) return; // not ours: never delete
    const rm = await fsx.remove(LOCK_PATH);
    if (!rm.ok) log(`lethe: lock release failed: ${rm.error.code}`);
  };
  for (const s of SIGNALS) {
    const h = (): void => void release().then(() => (env.reraise ?? defaultReraise)(s));
    handlers.set(s, h);
    env.signals.on(s, h);
  }
  return { token, release };
}

function defaultReraise(signal: LockSignal): void {
  process.kill(process.pid, signal);
}

async function tryBreakStale(fsx: WorkspaceFs, env: Env, seen: LockFile): Promise<void> {
  const again = await fsx.readText(LOCK_PATH);
  if (!again.ok || again.value === undefined) return;
  if (parseLock(again.value)?.token !== seen.token) return; // replaced meanwhile
  await fsx.remove(LOCK_PATH);
}

type Attempt =
  | { readonly kind: "acquired"; readonly handle: LockHandle }
  | { readonly kind: "fatal"; readonly error: ToolError }
  | { readonly kind: "busy"; readonly held?: LockFile; readonly transient?: ToolError };

/** One acquisition attempt. Transient errno (Windows mid-delete) counts as contention, not failure. */
async function attempt(fsx: WorkspaceFs, env: Env): Promise<Attempt> {
  const token = env.newToken();
  const mine: LockFile = { pid: env.pid, host: env.hostname(), startedAt: new Date(env.clock()).toISOString(), token };
  const made = await fsx.writeExclusive(LOCK_PATH, stableStringify(mine, KEY_ORDERS.lock));
  if (made.ok && made.value) return { kind: "acquired", handle: makeHandle(fsx, env, token) };
  if (!made.ok) return isTransient(made.error) ? { kind: "busy", transient: made.error } : { kind: "fatal", error: made.error };
  const cur = await fsx.readText(LOCK_PATH);
  if (!cur.ok) return isTransient(cur.error) ? { kind: "busy", transient: cur.error } : { kind: "fatal", error: cur.error };
  const held = cur.value === undefined ? undefined : parseLock(cur.value);
  return held === undefined ? { kind: "busy" } : { kind: "busy", held };
}

/** Acquires the workspace lock; LOCKED (with holder detail) when the wait budget is exhausted. */
export async function acquireLock(fsx: WorkspaceFs, options: LockOptions = {}): Promise<Result<LockHandle, ToolError>> {
  const env = withDefaults(options);
  const dir = await fsx.mkdirp(LOCK_DIR);
  if (!dir.ok) return dir;
  const begin = env.clock();
  for (;;) {
    const a = await attempt(fsx, env);
    if (a.kind === "acquired") return ok(a.handle);
    if (a.kind === "fatal") return err(a.error);
    if (a.held !== undefined && isStale(a.held, env)) {
      await tryBreakStale(fsx, env, a.held);
      continue;
    }
    if (env.clock() - begin >= env.waitMs) {
      // A persistent transient errno is a real fault (e.g. permissions), not a holder: report IO_FAILED.
      if (a.transient !== undefined) return err(a.transient);
      return err(toolError("LOCKED", "Another lethe process holds the workspace lock.", holderOf(a.held)));
    }
    await env.sleep(env.pollMs);
  }
}

/** Runs `fn` while holding the lock; always releases (also when `fn` throws). */
export async function withLock<T>(
  fsx: WorkspaceFs,
  options: LockOptions,
  fn: () => Promise<T>,
): Promise<Result<T, ToolError>> {
  const lock = await acquireLock(fsx, options);
  if (!lock.ok) return lock;
  try {
    return ok(await fn());
  } finally {
    await lock.value.release();
  }
}
