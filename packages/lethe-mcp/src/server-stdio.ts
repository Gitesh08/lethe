// stdio entry for the MCP server: connect, log one startup line, shut down on stdin close or SIGINT/SIGTERM.
// Refs: Req 19.1, Req 9.4, Req 17.5, INV-8
import type { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LockOptions, LockSignal, SignalSeam } from "./io/lock.js";
import { log as stderrLog, protocolStdout, type Logger } from "./io/stdout.js";
import type { ContextDeps } from "./ops/context.js";
import { createLetheServer } from "./server.js";

export const EXIT_STDIN_CLOSED = 0;
export const EXIT_SIGINT = 130;
export const EXIT_SIGTERM = 143;
/** Upper bound on waiting for in-flight lock releases after a signal. */
export const SIGNAL_DRAIN_MS = 3000;

export interface ServeStdioOptions {
  readonly log?: Logger;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly toolDeps?: ContextDeps;
  /** Process-level signal seam for the server's own SIGINT/SIGTERM handlers (default: `process`). */
  readonly signals?: SignalSeam;
}

const processSignals: SignalSeam = {
  on: (s, h) => void process.on(s, h),
  off: (s, h) => void process.off(s, h),
};

const EXIT_FOR: Readonly<Record<LockSignal, number>> = { SIGINT: EXIT_SIGINT, SIGTERM: EXIT_SIGTERM };
const SIGNALS: readonly LockSignal[] = ["SIGINT", "SIGTERM"];

/**
 * Lock seam owned by the server: lock handlers register here instead of on `process`, so the server
 * runs them itself on a signal and waits for their releases (the lock's default `reraise` would
 * otherwise kill the process before the lock file is gone and before we can return an exit code).
 */
export function createLockBridge(): {
  readonly lock: Pick<LockOptions, "signals" | "reraise">;
  drain(signal: LockSignal, timeoutMs: number): Promise<void>;
} {
  const handlers = new Map<LockSignal, Set<() => void>>();
  let outstanding = 0;
  let wake: (() => void) | undefined;
  const lock: Pick<LockOptions, "signals" | "reraise"> = {
    signals: {
      on: (s, h) => void (handlers.get(s) ?? handlers.set(s, new Set()).get(s))?.add(h),
      off: (s, h) => void handlers.get(s)?.delete(h),
    },
    reraise: () => {
      outstanding -= 1;
      if (outstanding <= 0) wake?.();
    },
  };
  const drain = async (signal: LockSignal, timeoutMs: number): Promise<void> => {
    const held = [...(handlers.get(signal) ?? [])];
    if (held.length === 0) return;
    outstanding = held.length;
    const done = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const timer = new Promise<void>((resolve) => void setTimeout(resolve, timeoutMs).unref());
    for (const h of held) h();
    await Promise.race([done, timer]);
  };
  return { lock, drain };
}

/**
 * Serves MCP over stdio. Resolves with the process exit code: 0 when stdin ends, 130 on SIGINT,
 * 143 on SIGTERM. Held locks are released before it resolves. Never calls `process.exit`.
 */
export async function serveStdio(opts: ServeStdioOptions = {}): Promise<number> {
  const log = opts.log ?? stderrLog;
  const stdin = opts.stdin ?? process.stdin;
  const signals = opts.signals ?? processSignals;
  const bridge = createLockBridge();
  const server = createLetheServer({
    log,
    toolDeps: { ...opts.toolDeps, lock: { ...opts.toolDeps?.lock, ...bridge.lock } },
  });
  const transport = new StdioServerTransport(stdin, opts.stdout ?? protocolStdout);
  transport.onerror = (e): void => log(`lethe serve: transport error: ${e.message}`);

  let finish: (code: number) => void = () => undefined;
  const exit = new Promise<number>((resolve) => {
    finish = resolve;
  });
  let ending = false;
  const shutdown = async (code: number, signal?: LockSignal): Promise<void> => {
    if (ending) return;
    ending = true;
    for (const [s, h] of listeners) signals.off(s, h);
    for (const ev of ["end", "close"]) stdin.off(ev, onEnd);
    if (signal !== undefined) await bridge.drain(signal, SIGNAL_DRAIN_MS);
    await server.close().catch((e: unknown) => log(`lethe serve: close failed: ${String(e)}`));
    finish(code);
  };
  const onEnd = (): void => void shutdown(EXIT_STDIN_CLOSED);
  const listeners = new Map<LockSignal, () => void>();
  for (const s of SIGNALS) {
    const h = (): void => void shutdown(EXIT_FOR[s], s);
    listeners.set(s, h);
    signals.on(s, h);
  }
  for (const ev of ["end", "close"]) stdin.once(ev, onEnd);

  await server.connect(transport);
  log(`lethe serve: node ${process.version}, cwd ${process.cwd()}`);
  return exit;
}
