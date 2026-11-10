// Spawned bundle (node dist/lethe.mjs serve) end-to-end over real stdio. Refs: Req 21.4, Req 19.1, Req 19.3, Req 1.5, INV-8
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, LATEST_PROTOCOL_VERSION, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnv } from "../src/io/child-env.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { serializeState } from "../src/persist/state-serialize.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(PKG, "dist", "lethe.mjs");
type Haunted = Awaited<ReturnType<typeof materialiseHaunted>>;

let ws = "";
let repo: Haunted;

function snapshot(dir: string, base = dir, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) snapshot(p, base, out);
    else out.set(p.slice(base.length), readFileSync(p, "utf8"));
  }
  return out;
}

beforeEach(async () => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "lethe-bundle-stdio-")));
  repo = await materialiseHaunted(ws);
  // The fixture's aged states with a zero ledger cursor, so sleep apply really archives.
  const seeded = serializeState({
    commit: repo.nowCommit, at: repo.nowISO,
    ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams: repo.states,
  });
  const w = await createWorkspaceFs(ws).writeAtomic(".kiro/lethe/state.json", seeded);
  if (!w.ok) throw new Error(w.error.message);
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

const call = (c: Client, name: string, args: Record<string, unknown>) =>
  c.callTool({ name, arguments: { workspacePath: ws, atCommit: repo.nowCommit, now: repo.nowISO, ...args } });

describe("bundle over real stdio (SDK client)", () => {
  it("initialize, list, score, detect, sleep dry-run and apply, error and unknown tool", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath, args: [BUNDLE, "serve"], cwd: ws, env: childEnv(), stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    const client = new Client({ name: "bundle-e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBeTruthy();

      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(4);

      for (const name of ["lethe_score_memories", "lethe_detect_contradictions"]) {
        const r = await call(client, name, {});
        expect(r.isError, name).toBe(false);
        const text = (r.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
        expect(JSON.parse(text), name).toEqual(r.structuredContent);
      }

      const before = snapshot(ws);
      const dry = await call(client, "lethe_consolidate_sleep", { gateRuns: 10 });
      expect(dry.isError).toBe(false);
      const dryEnv = dry.structuredContent as { ok: boolean; data: { applied: boolean } };
      expect(dryEnv.data.applied).toBe(false);
      expect(snapshot(ws)).toEqual(before);

      const applied = await call(client, "lethe_consolidate_sleep", { gateRuns: 10, apply: true });
      expect(applied.isError, JSON.stringify(applied.structuredContent)).toBe(false);
      const env = applied.structuredContent as { ok: boolean; data: { applied: boolean } };
      expect(env.data.applied).toBe(true);
      expect(existsSync(join(ws, ".kiro", "lethe", "backup", String(repo.nowCommit)))).toBe(true);
      const after = snapshot(ws);
      const steering = [...before.keys()].filter((k) => k.replace(/\\/g, "/").includes("/.kiro/steering/"));
      expect(steering.some((k) => before.get(k) !== after.get(k))).toBe(true);
      const tomb = (m: Map<string, string>): string | undefined =>
        [...m].find(([k]) => k.replace(/\\/g, "/").endsWith("/.kiro/crypt/tombstones.json"))?.[1];
      expect(tomb(after)).not.toBe(tomb(before));

      const bad = await call(client, "lethe_resurrect_engram", { query: "no-such-engram-zzz" });
      expect(bad.isError).toBe(true);
      expect((bad.structuredContent as { error: { code: string } }).error.code).toBe("TOMBSTONE_NOT_FOUND");

      const unknown = await call(client, "nope", {}).then(() => undefined, (e: unknown) => e);
      expect(unknown).toBeInstanceOf(McpError);
      expect((unknown as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((unknown as McpError).message).toContain("Unknown tool: nope");
    } finally {
      await client.close();
    }
    expect(stderr).toContain("lethe serve:");
  }, 60_000);
});

describe("bundle raw stdout hygiene", () => {
  it("stdout carries only JSON-RPC 2.0 lines; stderr has the startup line; exits 0 on stdin end", async () => {
    const child = spawn(process.execPath, [BUNDLE, "serve"], { cwd: ws, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    const exited = new Promise<number | null>((r) => child.once("close", (code) => r(code)));
    const send = (m: unknown): void => { child.stdin.write(`${JSON.stringify(m)}\n`); };

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "raw", version: "0.0.0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lethe_score_memories",
      arguments: { workspacePath: ws, atCommit: repo.nowCommit, now: repo.nowISO } } });

    const deadline = Date.now() + 40_000;
    const ids = (): number => out.split("\n").filter((l) => l.trim() !== "").length;
    while (ids() < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.stdin.end();
    const code = await exited;

    const lines = out.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const msg = JSON.parse(line) as { jsonrpc?: string };
      expect(msg.jsonrpc).toBe("2.0");
    }
    const norm = (s: string): string => (process.platform === "win32" ? s.toLowerCase() : s);
    expect(norm(err)).toContain(norm(`lethe serve: node ${process.version}, cwd ${ws}`));
    expect(code).toBe(0);
  }, 60_000);
});
