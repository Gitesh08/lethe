// serveStdio over injected streams and signal seam. Refs: Req 19.1, Req 9.4, Req 17.5, INV-8
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LockSignal, SignalSeam } from "../src/io/lock.js";
import { createLockBridge, EXIT_SIGINT, EXIT_SIGTERM, serveStdio } from "../src/server-stdio.js";

const quietGit = { commitCount: async () => undefined, changedFiles: async () => undefined };

function fakeSignals(): SignalSeam & { emit(s: LockSignal): void; count(): number } {
  const map = new Map<LockSignal, Set<() => void>>();
  return {
    on: (s, h) => void (map.get(s) ?? map.set(s, new Set()).get(s))?.add(h),
    off: (s, h) => void map.get(s)?.delete(h),
    emit: (s) => void [...(map.get(s) ?? [])].forEach((h) => h()),
    count: () => [...map.values()].reduce((n, set) => n + set.size, 0),
  };
}

/** Collects newline-delimited JSON-RPC messages written to `out`. */
function collect(out: PassThrough): { next(id: number): Promise<Record<string, unknown>> } {
  const seen: Array<Record<string, unknown>> = [];
  let buf = "";
  out.on("data", (c: Buffer) => {
    buf += c.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim() !== "") seen.push(JSON.parse(l) as Record<string, unknown>);
  });
  return {
    next: async (id) => {
      for (let i = 0; i < 200; i++) {
        const hit = seen.find((m) => m["id"] === id);
        if (hit !== undefined) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no response for id ${id}`);
    },
  };
}

let dir = "";
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-stdio-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function start() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const signals = fakeSignals();
  const lines: string[] = [];
  const done = serveStdio({ stdin, stdout, signals, log: (m) => lines.push(m), toolDeps: { git: quietGit } });
  return { stdin, stdout, signals, lines, done };
}

describe("serveStdio", () => {
  it("logs the startup line, serves initialize + tools/list, and resolves 0 when stdin ends", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const s = start();
      const rx = collect(s.stdout);
      s.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n",
      );
      const init = await rx.next(1);
      expect((init["result"] as { serverInfo: { name: string } }).serverInfo.name).toBe("lethe");
      s.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      s.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      const list = await rx.next(2);
      expect((list["result"] as { tools: unknown[] }).tools).toHaveLength(4);
      expect(s.lines).toContain(`lethe serve: node ${process.version}, cwd ${process.cwd()}`);
      s.stdin.end();
      await expect(s.done).resolves.toBe(0);
      expect(s.signals.count()).toBe(0);
      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
    }
  });

  it.each([
    ["SIGINT", EXIT_SIGINT, 130],
    ["SIGTERM", EXIT_SIGTERM, 143],
  ] as const)("resolves %s with exit code %i", async (sig, code, expected) => {
    const s = start();
    await vi.waitFor(() => expect(s.lines.length).toBeGreaterThan(0));
    s.signals.emit(sig);
    await expect(s.done).resolves.toBe(expected);
    expect(code).toBe(expected);
    expect(s.signals.count()).toBe(0);
  });

  it("lock bridge runs held lock handlers and waits for their reraise", async () => {
    const bridge = createLockBridge();
    const order: string[] = [];
    const h = (): void => {
      void new Promise((r) => setTimeout(r, 20)).then(() => {
        order.push("released");
        bridge.lock.reraise?.("SIGTERM");
      });
    };
    bridge.lock.signals?.on("SIGTERM", h);
    await bridge.drain("SIGTERM", 1000);
    order.push("drained");
    expect(order).toEqual(["released", "drained"]);
    await bridge.drain("SIGINT", 1000); // nothing registered: returns at once
  });
});
