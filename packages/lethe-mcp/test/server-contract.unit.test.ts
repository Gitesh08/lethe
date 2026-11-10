// Contract tests for the four tools over an in-memory MCP transport on the haunted fixture.
// Refs: Req 1.1, Req 1.3, Req 1.5, Req 21.2, REQ-MCP-1, REQ-MCP-3
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadStateFile } from "../src/load/state-file.js";
import { createLetheServer } from "../src/server.js";
import { serializeState } from "../src/persist/state-serialize.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let root = "";
let client: Client;
let commit = 0;
let now = "";
let archivedId = "";
let snapshot: Map<string, string>;

/** Every file under `dir` -> utf8 bytes, keyed by relative path. */
function readTree(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const r = rel === "" ? name : `${rel}/${name}`;
    if (statSync(join(dir, r)).isDirectory()) for (const [k, v] of readTree(dir, r)) out.set(k, v);
    else out.set(r, readFileSync(join(dir, r), "utf8"));
  }
  return out;
}

async function connect(): Promise<Client> {
  const server = createLetheServer({
    log: () => undefined,
    toolDeps: { git: noGit, gate: stubGate("passed"), lock: { waitMs: 0 }, log: () => undefined },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "contract", version: "0.0.0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  return c;
}

interface Called { readonly isError: unknown; readonly env: { ok: boolean; summary: unknown; data: unknown } }

async function call(name: string, args: Record<string, unknown>): Promise<Called> {
  const res = await client.callTool({ name, arguments: { workspacePath: root, atCommit: commit, now, ...args } });
  const content = res.content as Array<{ type: string; text: string }>;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe("text");
  expect(JSON.parse(content[0]?.text ?? "")).toEqual(res.structuredContent);
  return { isError: res.isError, env: res.structuredContent as Called["env"] };
}

function expectOk(r: Called): void {
  expect(r.isError).toBe(false);
  expect(r.env.ok).toBe(true);
  expect(r.env.summary).toBeDefined();
  expect(r.env.data).toBeDefined();
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-contract-")));
  const repo = await materialiseHaunted(root);
  commit = repo.nowCommit;
  now = repo.nowISO;
  const fsx = createWorkspaceFs(root);
  const cur = await loadStateFile(fsx);
  if (!cur.ok) throw new Error(cur.error.message);
  await fsx.writeAtomic(
    ".kiro/lethe/state.json",
    serializeState({ commit, at: now, ledger: cur.value.cursor, engrams: repo.states }),
  );
  client = await connect();

  // Setup: apply a real sleep so tombstones exist for the resurrect dry-run.
  const applied = await call("lethe_consolidate_sleep", { apply: true });
  expectOk(applied);
  const tombs = JSON.parse(readFileSync(join(root, ".kiro/crypt/tombstones.json"), "utf8")) as { tombstones: Array<{ id: string }> };
  archivedId = tombs.tombstones[0]?.id ?? "";
  if (archivedId === "") throw new Error("setup produced no tombstones");

  // Snapshot step: every contract assertion below must leave this tree byte-identical.
  snapshot = readTree(root);
}, 60_000);

afterAll(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("tool contract", () => {
  it("tools/list returns four tools with additionalProperties false", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "lethe_consolidate_sleep",
      "lethe_detect_contradictions",
      "lethe_resurrect_engram",
      "lethe_score_memories",
    ]);
    for (const t of tools) expect(t.inputSchema["additionalProperties"]).toBe(false);
  });

  it("score returns a success envelope mirrored in structuredContent", async () => {
    expectOk(await call("lethe_score_memories", {}));
  });

  it("detect returns a success envelope mirrored in structuredContent", async () => {
    expectOk(await call("lethe_detect_contradictions", {}));
  });

  it("sleep without apply succeeds and changes nothing", async () => {
    const r = await call("lethe_consolidate_sleep", {});
    expectOk(r);
    expect((r.env.data as { applied: boolean }).applied).toBe(false);
    expect(readTree(root)).toEqual(snapshot);
  });

  it("resurrect without apply finds the archived engram and changes nothing", async () => {
    const r = await call("lethe_resurrect_engram", { query: archivedId });
    expectOk(r);
    const data = r.env.data as { restored?: unknown; matches: Array<{ id: string }> };
    expect(data.restored).toBeUndefined();
    expect(data.matches.map((m) => m.id)).toContain(archivedId);
    expect(readTree(root)).toEqual(snapshot);
  });

  it("unknown tool is JSON-RPC -32602 'Unknown tool: nope' and changes nothing", async () => {
    const bad = client.callTool({ name: "nope", arguments: { workspacePath: root } });
    await expect(bad).rejects.toBeInstanceOf(McpError);
    await expect(bad).rejects.toMatchObject({ code: -32602, message: expect.stringContaining("Unknown tool: nope") });
    expect(readTree(root)).toEqual(snapshot);
  });
});
