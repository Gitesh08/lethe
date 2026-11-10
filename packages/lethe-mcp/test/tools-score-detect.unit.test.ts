// Unit tests for tools/score.ts and tools/detect.ts. Refs: Req 1.4, 2.6, 3.1, REQ-MCP-2
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectTool } from "../src/tools/detect.js";
import { scoreTool } from "../src/tools/score.js";

const NOW = "2026-11-10T12:00:00.000Z";
const deps = { git: { commitCount: async () => undefined, changedFiles: async () => undefined }, log: () => undefined };
let dir = "";

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lethe-tools-sd-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const put = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

describe("tool definitions", () => {
  it("expose name, read-only flag, and strict JSON schema", () => {
    expect(scoreTool.name).toBe("lethe_score_memories");
    expect(detectTool.name).toBe("lethe_detect_contradictions");
    for (const t of [scoreTool, detectTool]) {
      expect(t.mutating).toBe(false);
      expect(t.jsonSchema["additionalProperties"]).toBe(false);
      expect(t.description).toMatch(/^Call this to/);
      expect(t.description).toContain("Read-only and safe");
    }
  });

  it("score description says estimated utility and does not claim usefulness", () => {
    expect(scoreTool.description).toContain("estimated utility");
    expect(scoreTool.description).toContain("not proof");
    expect(scoreTool.description.toLowerCase()).not.toContain("useful rules");
  });

  it("detect description names the resolution outcomes", () => {
    expect(detectTool.description).toContain("unresolvable");
    expect(detectTool.description).toContain("deterministic");
  });
});

describe("tool run", () => {
  it("score returns the op envelope for a temp workspace", async () => {
    put(".kiro/steering/a.md", "## A\n\nUse ESM modules.\n");
    const env = await scoreTool.run({ workspacePath: dir, atCommit: 3, now: NOW }, deps);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.data.engrams).toHaveLength(1);
    expect(env.data.commit).toBe(3);
  });

  it("detect finds a contradiction between steering sections", async () => {
    put(".kiro/steering/a.md", "## A\n\nUse Vitest for tests.\n\n## B\n\nUse Jest for tests.\n");
    const env = await detectTool.run({ workspacePath: dir, atCommit: 1, now: NOW }, deps);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.data.count).toBe(1);
    expect(env.data.reports[0]?.axis).toBe("test-runner");
  });

  it("returns INVALID_INPUT for bad or unknown input", async () => {
    for (const t of [scoreTool, detectTool]) {
      const bad = await t.run({ workspacePath: dir, bogus: 1 }, deps);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("INVALID_INPUT");
      const missing = await t.run({}, deps);
      expect(missing.ok).toBe(false);
    }
  });
});
