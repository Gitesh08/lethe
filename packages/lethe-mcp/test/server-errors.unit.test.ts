// Error-code contract through the MCP server (in-memory transport). Refs: Req 6.1, 6.2, 6.3, 6.4, 6.6, 21.2, REQ-MCP-6
// LOCKED via a real child process lives in server-errors.perf.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { serializeTombstones, type TombstoneRecord } from "@lethe/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate, type GateRunner } from "../src/gate/gate.js";
import { nodeAtomicFsOps } from "../src/io/workspace-fs.js";
import { createLetheServer, type ServerDeps } from "../src/server.js";

const NOW = "2026-11-10T12:00:00.000Z";
const STEER = ".kiro/steering/a.md";
const quietGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const TEXT = [
  "## Pinned rule", "<!-- lethe: pin=true -->", "", "Always keep this pinned rule around for the whole project lifetime.", "",
  "## Loose rule one", "", "Prefer small functions and short files in every module of the codebase.", "",
  "## Loose rule two", "", "Name tests after the behaviour they check, in plain words, always.", "",
].join("\n");
const failingGate: GateRunner = async () => ({
  status: "failed",
  failure: { status: "failed", propertyId: "P8", seed: 7, counterexample: [1], message: "boom" },
});
type Res = Awaited<ReturnType<Client["callTool"]>>;
interface Env { ok: boolean; summary: string; error: { code: string; message: string; detail?: unknown }; data: Record<string, unknown> }
let dir = "";
let client: Client | undefined;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-srv-err-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, STEER), TEXT);
});
afterEach(async () => {
  await client?.close();
  client = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function connect(deps: ServerDeps = {}, toolDeps: ServerDeps["toolDeps"] = {}): Promise<Client> {
  const server = createLetheServer({ log: () => undefined, ...deps, toolDeps: { git: quietGit, gate: stubGate("passed"), lock: { waitMs: 0 }, ...toolDeps } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), c.connect(b)]);
  client = c;
  return c;
}
const call = (c: Client, name: string, args: Record<string, unknown>): Promise<Res> =>
  c.callTool({ name, arguments: { workspacePath: dir, atCommit: 10, now: NOW, ...args } });
const envOf = (r: Res): Env => r.structuredContent as unknown as Env;

/** isError, failure-envelope shape, text block equals structuredContent, and the expected code. */
function expectFailure(r: Res, code: string): Env {
  expect(r.isError).toBe(true);
  const env = envOf(r);
  expect(Object.keys(env).sort()).toEqual(["error", "ok", "summary"]);
  expect(env.ok).toBe(false);
  expect(env.error.code).toBe(code);
  expect(typeof env.error.message).toBe("string");
  expect(env.summary.startsWith(`${code}:`)).toBe(true);
  const content = r.content as Array<{ text: string }>;
  expect(JSON.parse(content[0]?.text ?? "")).toEqual(r.structuredContent);
  return env;
}
function tomb(file: string): TombstoneRecord {
  return {
    schema: 1, id: "esc", file, headingPath: ["esc"], body: "## Esc\nUse ESM.\n", raw: "## Esc\nUse ESM.\n", contentHash: "0".repeat(64), tokens: 3,
    meta: { globs: [], specLinks: [], pinned: false },
    state: { id: "esc", stability: 9, lastReinforcedCommit: 1, lastReinforcedAt: "2026-01-01T00:00:00.000Z", reinforcements: 1 },
    reason: "decayed", retentionAtDeath: 0.1, buriedAtCommit: 1, buriedAt: "2026-01-02T00:00:00.000Z", position: { index: 1 },
  };
}
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
/** Seeds state so every unpinned rule has decayed into the crypt, so sleep apply really writes. */
async function seedDecayed(c: Client): Promise<void> {
  const probe = envOf(await call(c, "lethe_consolidate_sleep", { gateRuns: 1 }));
  const stamped = (probe.data["checkpoint"] as { stamped: string[] }).stamped;
  const engrams: Record<string, unknown> = {};
  for (const id of stamped) if (!id.includes("pinned")) engrams[id] = { stability: 0.5, lastReinforcedCommit: 0, lastReinforcedAt: NOW, reinforcements: 0 };
  put(".kiro/lethe/state.json", JSON.stringify({ version: 1, commit: 10, at: NOW, ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams }));
}

describe("INVALID_INPUT", () => {
  // Only schema-level failures carry `{ path, message }` pairs in detail.
  it.each([
    ["relative workspacePath", { workspacePath: "rel/dir" }],
    ["unknown property", { bogus: 1 }],
  ])("%s: code plus { path, message } pairs", async (_n, args) => {
    const c = await connect();
    const env = expectFailure(await call(c, "lethe_score_memories", args), "INVALID_INPUT");
    const detail = env.error.detail as Array<Record<string, unknown>>;
    expect(detail.length).toBeGreaterThan(0);
    for (const d of detail) expect(Object.keys(d).sort()).toEqual(["message", "path"]);
  });

  // The schema accepts skipGate+apply; the operation rejects it, so detail is NOT { path, message } pairs.
  it("skipGate with apply is rejected by the operation (no pair-shape claim)", async () => {
    const c = await connect();
    expectFailure(await call(c, "lethe_consolidate_sleep", { apply: true, skipGate: true }), "INVALID_INPUT");
  });
});

describe("CONFIG_INVALID, ONTOLOGY_INVALID_PATTERN, TOMBSTONE_NOT_FOUND", () => {
  it("malformed state.json", async () => {
    put(".kiro/lethe/state.json", "{nope");
    expectFailure(await call(await connect(), "lethe_score_memories", {}), "CONFIG_INVALID");
  });
  it("malformed tombstones.json", async () => {
    put(".kiro/crypt/tombstones.json", "{nope");
    expectFailure(await call(await connect(), "lethe_resurrect_engram", { query: "x" }), "CONFIG_INVALID");
  });
  it("invalid ontology regex", async () => {
    const stance = { id: "s", label: "s", patterns: ["(unclosed"], negationAware: false };
    put(".kiro/lethe/ontology.json", JSON.stringify({ version: 1, axes: [{ id: "x", description: "d", stances: [stance] }] }));
    expectFailure(await call(await connect(), "lethe_detect_contradictions", {}), "ONTOLOGY_INVALID_PATTERN");
  });
  it("no matching tombstone", async () => {
    expectFailure(await call(await connect(), "lethe_resurrect_engram", { query: "nothing-here" }), "TOMBSTONE_NOT_FOUND");
  });
});

describe("PBT_GATE_FAILED, LOCKED (in-process), IO_FAILED", () => {
  it("failing gate double", async () => {
    const c = await connect({}, { gate: failingGate });
    expectFailure(await call(c, "lethe_consolidate_sleep", { apply: true, gateRuns: 1 }), "PBT_GATE_FAILED");
  });

  it("live lock file with waitMs 0", async () => {
    put(".kiro/lethe/lock", JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token: "t" }));
    const env = expectFailure(await call(await connect(), "lethe_resurrect_engram", { query: "x", apply: true }), "LOCKED");
    expect(env.error.detail).toMatchObject({ pid: process.pid });
  });

  it("injected rename failure while applying sleep leaves state untouched", async () => {
    const ops = { ...nodeAtomicFsOps, rename: async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); } };
    const c = await connect({}, { fsOptions: { ops } });
    await seedDecayed(c);
    const before = readFileSync(join(dir, STEER), "utf8");
    expectFailure(await call(c, "lethe_consolidate_sleep", { apply: true, gateRuns: 1 }), "IO_FAILED");
    expect(readFileSync(join(dir, STEER), "utf8")).toBe(before);
  });
});

describe("INTERNAL_ERROR", () => {
  it("hides the stack, logs the full error to the sink, and the next call succeeds", async () => {
    const logged: string[] = [];
    let boom = true;
    const git = { commitCount: async () => { if (boom) throw new Error("secret stack detail"); return undefined; }, changedFiles: async () => undefined };
    const c = await connect({ log: (m) => logged.push(m) }, { git });
    const args = { workspacePath: dir, now: NOW };
    const res = await c.callTool({ name: "lethe_score_memories", arguments: args });
    expectFailure(res, "INTERNAL_ERROR");
    expect(JSON.stringify(res)).not.toMatch(/secret stack detail|\bat .*\(|\.ts:\d+/);
    expect(logged.join("\n")).toContain("secret stack detail");
    expect(logged.join("\n")).toContain("Error");
    boom = false;
    expect((await c.callTool({ name: "lethe_score_memories", arguments: args })).isError).toBe(false);
  });
});

describe("PATH_ESCAPE, PARSE_*, BUDGET_INFEASIBLE", () => {
  it("resurrect apply of a tombstone whose file escapes the workspace", async () => {
    put(".kiro/crypt/tombstones.json", serializeTombstones([tomb("../outside.md")]));
    const env = expectFailure(await call(await connect(), "lethe_resurrect_engram", { query: "esc", apply: true }), "PATH_ESCAPE");
    expect(JSON.stringify(env.error.detail)).toContain("outside.md");
  });

  it("PARSE_* is a diagnostic on an ok result, never an error", async () => {
    put(".kiro/steering/bad.md", "---\nglobs: x\n## H\n\nbody\n");
    const r = await call(await connect(), "lethe_score_memories", {});
    expect(r.isError).toBe(false);
    const env = envOf(r);
    expect(env.ok).toBe(true);
    const diags = env.data["diagnostics"] as Array<{ code: string; message: string }>;
    const skipped = diags.find((d) => d.code === "PARSE_SKIPPED");
    expect(skipped?.message).toContain("PARSE_INVALID_FRONTMATTER");
  });

  it("budget_infeasible is a status on an ok result, never an error code", async () => {
    const r = await call(await connect(), "lethe_consolidate_sleep", { budgetTokens: 1, gateRuns: 1 });
    expect(r.isError).toBe(false);
    const env = envOf(r);
    expect(env.ok).toBe(true);
    expect(env.data["budgetStatus"]).toBe("budget_infeasible");
    expect("error" in env).toBe(false);
  });
});
