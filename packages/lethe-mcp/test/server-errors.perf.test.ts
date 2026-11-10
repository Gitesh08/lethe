// LOCKED through the MCP server with the lock genuinely held by another process. Refs: Req 6.1, 6.2, 9.4, REQ-MCP-6
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLetheServer } from "../src/server.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-11-10T12:00:00.000Z";

describe("server LOCKED with a lock held by a child process", () => {
  let tmp = "";
  let child: ChildProcess | undefined;
  let client: Client | undefined;

  beforeAll(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), "lethe-srv-locked-"))); });
  afterAll(async () => {
    await client?.close();
    if (child !== undefined && child.exitCode === null) {
      const closed = new Promise<void>((r) => child?.once("close", () => r()));
      child.kill();
      await closed;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("resurrect apply returns a LOCKED failure envelope naming the holder pid", async () => {
    const bundle = join(tmp, "lock-holder.mjs");
    await build({
      entryPoints: [join(PKG, "test", "support", "lock-holder.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
    });
    const root = join(tmp, "ws");
    mkdirSync(join(root, ".kiro", "steering"), { recursive: true });
    writeFileSync(join(root, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules.\n");
    const ready = join(tmp, "ready.txt");
    child = spawn(process.execPath, [bundle, root, ready, "60000"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    for (let i = 0; i < 400 && !existsSync(ready); i++) await sleep(25);
    expect(existsSync(ready), `holder never became ready: ${stderr}`).toBe(true);

    const server = createLetheServer({
      log: () => undefined,
      toolDeps: { git: { commitCount: async () => undefined, changedFiles: async () => undefined }, lock: { waitMs: 200, pollMs: 10 } },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(a), c.connect(b)]);
    client = c;

    const res = await c.callTool({ name: "lethe_resurrect_engram", arguments: { workspacePath: root, query: "x", apply: true, atCommit: 1, now: NOW } });
    expect(res.isError).toBe(true);
    const env = res.structuredContent as { ok: boolean; summary: string; error: { code: string; detail: { pid: number } } };
    expect(Object.keys(env).sort()).toEqual(["error", "ok", "summary"]);
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe("LOCKED");
    expect(env.error.detail.pid).toBe(child.pid);
    expect(env.summary.startsWith("LOCKED:")).toBe(true);
  }, 30_000);
});
