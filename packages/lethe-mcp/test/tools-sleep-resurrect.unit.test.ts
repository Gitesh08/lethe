// Unit tests for tools/sleep.ts and tools/resurrect.ts. Refs: Req 1.4, 4.1, 5.1, REQ-MCP-3
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resurrectTool } from "../src/tools/resurrect.js";
import { sleepTool } from "../src/tools/sleep.js";

const NOW = "2026-11-10T12:00:00.000Z";
const deps = { git: { commitCount: async () => undefined, changedFiles: async () => undefined }, log: () => undefined, lock: { waitMs: 0 } };
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-tools-sr-")));
  mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
  writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## A\n\nUse ESM modules everywhere in the project.\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tree = (): string[] => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

describe("tool definitions", () => {
  it("are mutating with strict schemas", () => {
    expect(sleepTool.name).toBe("lethe_consolidate_sleep");
    expect(resurrectTool.name).toBe("lethe_resurrect_engram");
    for (const t of [sleepTool, resurrectTool]) {
      expect(t.mutating).toBe(true);
      expect(t.jsonSchema["additionalProperties"]).toBe(false);
      expect(t.description).toMatch(/^Call this to/);
      expect(t.description).toContain("dry-run");
      expect(t.description).toContain("apply: true");
      expect(t.description).toContain("safe");
    }
  });

  it("sleep forbids skipGate with apply; resurrect mentions fresh stability", () => {
    expect(sleepTool.description).toContain("Never combine skipGate with apply");
    expect(resurrectTool.description).toContain("fresh stability");
  });
});

describe("tool run", () => {
  it("sleep dry-run with the default gate passes and writes nothing", async () => {
    const before = tree();
    const env = await sleepTool.run({ workspacePath: dir, atCommit: 5, now: NOW, gateRuns: 2 }, deps);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.data.applied).toBe(false);
    expect(env.data.pbtGate).toBe("passed");
    expect(env.summary).toContain("Dry run");
    expect(tree()).toEqual(before);
  });

  it("sleep rejects skipGate with apply as INVALID_INPUT", async () => {
    const env = await sleepTool.run({ workspacePath: dir, apply: true, skipGate: true }, deps);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("INVALID_INPUT");
  });

  it("resurrect with no match returns TOMBSTONE_NOT_FOUND", async () => {
    const env = await resurrectTool.run({ workspacePath: dir, query: "nothing-here", atCommit: 1, now: NOW }, deps);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("TOMBSTONE_NOT_FOUND");
  });

  it("resurrect rejects unknown fields", async () => {
    const env = await resurrectTool.run({ workspacePath: dir, query: "x", bogus: 1 }, deps);
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("INVALID_INPUT");
  });
});
