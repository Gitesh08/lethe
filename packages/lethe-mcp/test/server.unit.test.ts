// createLetheServer over an in-memory transport. Refs: Req 1.3, 1.5, 6.1, 6.3, 6.4, 6.6, REQ-MCP-6
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLetheServer, type ServerDeps } from "../src/server.js";

const NOW = "2026-11-10T12:00:00.000Z";
const quietGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let dir = "";
let client: Client | undefined;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-server-")));
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function connect(deps: ServerDeps = {}): Promise<Client> {
  const server = createLetheServer({ log: () => undefined, toolDeps: { git: quietGit }, ...deps });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  client = c;
  return c;
}

describe("createLetheServer", () => {
  it("lists exactly four tools with descriptions and strict schemas", async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools).toHaveLength(4);
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  it("score call returns one text block equal to structuredContent", async () => {
    const c = await connect();
    const res = await c.callTool({ name: "lethe_score_memories", arguments: { workspacePath: dir, atCommit: 1, now: NOW } });
    expect(res.isError).toBe(false);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(JSON.parse(content[0]?.text ?? "")).toEqual(res.structuredContent);
    expect((res.structuredContent as { ok: boolean }).ok).toBe(true);
  });

  it("unknown tool is a protocol InvalidParams error", async () => {
    const c = await connect();
    const bad = c.callTool({ name: "x", arguments: { workspacePath: join(dir, "missing") } });
    await expect(bad).rejects.toBeInstanceOf(McpError);
    await expect(bad).rejects.toMatchObject({ code: -32602, message: expect.stringContaining("Unknown tool: x") });
  });

  it("invalid input returns an INVALID_INPUT failure envelope", async () => {
    const c = await connect();
    const res = await c.callTool({ name: "lethe_score_memories", arguments: { workspacePath: dir, bogus: 1 } });
    expect(res.isError).toBe(true);
    const env = res.structuredContent as { ok: boolean; error: { code: string; detail: Array<Record<string, unknown>> } };
    expect(env.error.code).toBe("INVALID_INPUT");
    for (const d of env.error.detail) expect(Object.keys(d).sort()).toEqual(["message", "path"]);
  });

  it("a throwing dependency becomes INTERNAL_ERROR and the server keeps serving", async () => {
    const logged: string[] = [];
    let boom = true;
    const git = {
      commitCount: async () => {
        if (boom) throw new Error("secret stack detail");
        return undefined;
      },
      changedFiles: async () => undefined,
    };
    const c = await connect({ log: (m) => logged.push(m), toolDeps: { git } });
    const args = { workspacePath: dir, now: NOW };
    const res = await c.callTool({ name: "lethe_score_memories", arguments: args });
    expect(res.isError).toBe(true);
    const env = res.structuredContent as { error: { code: string; message: string } };
    expect(env.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res)).not.toContain("secret stack detail");
    expect(logged.join("\n")).toContain("secret stack detail");
    boom = false;
    const next = await c.callTool({ name: "lethe_score_memories", arguments: args });
    expect(next.isError).toBe(false);
  });
});
