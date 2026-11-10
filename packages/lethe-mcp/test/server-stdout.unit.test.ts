// In-process stdout-pollution check: product code writes nothing to stdout. Refs: Req 19.1, 19.2, 19.3, INV-8
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { createLetheServer } from "../src/server.js";

const NOW = "2026-11-10T12:00:00.000Z";
let dir = "";
let client: Client | undefined;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-stdout-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "rules.md"), "# Rules\n\n## Style\n\nUse Vitest.\n\n## Other\n\nUse Jest.\n");
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function connect(boom: boolean): Promise<Client> {
  const git = {
    commitCount: async () => {
      if (boom) throw new Error("kaboom-detail");
      return undefined;
    },
    changedFiles: async () => undefined,
  };
  // No `log` injected: the default stderr logger must be used.
  const server = createLetheServer({ toolDeps: { git, gate: stubGate("passed"), lock: { waitMs: 0 } } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  client = c;
  return c;
}

function text(spy: MockInstance): string {
  return spy.mock.calls.map((args) => args.map((x) => (typeof x === "string" ? x : Buffer.from(x as Uint8Array).toString())).join(" ")).join("");
}

describe("stdout pollution (in-process)", () => {
  it("writes zero bytes to stdout across all tools and error cases; INTERNAL_ERROR reaches stderr", async () => {
    const c = await connect(false);
    const bad = await connect(true);
    client = c;
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cons = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    try {
      const base = { workspacePath: dir, atCommit: 5, now: NOW };
      const call = (cl: Client, name: string, args: Record<string, unknown>) => cl.callTool({ name, arguments: args });
      const results = [
        await call(c, "lethe_score_memories", base),
        await call(c, "lethe_detect_contradictions", base),
        await call(c, "lethe_consolidate_sleep", { ...base, skipGate: false, gateRuns: 2 }),
        await call(c, "lethe_resurrect_engram", { ...base, query: "no-such-engram-zzz" }),
        await call(c, "lethe_score_memories", { workspacePath: dir, bogus: 1 }),
      ];
      expect(results[0]?.isError).toBe(false);
      expect(results[3]?.isError).toBe(true);
      expect(results[4]?.isError).toBe(true);
      await expect(call(c, "no_such_tool", { workspacePath: dir })).rejects.toBeDefined();
      const internal = await call(bad, "lethe_score_memories", { workspacePath: dir, now: NOW });
      expect(internal.isError).toBe(true);
      expect((internal.structuredContent as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");

      expect(out).not.toHaveBeenCalled();
      expect(text(err)).toContain("kaboom-detail");
      const [log, info, , , debug] = cons;
      expect(log).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(debug).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
      for (const s of cons) s.mockRestore();
      await bad.close();
    }
  });
});
