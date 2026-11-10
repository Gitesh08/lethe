// Task 12.5: workspace .kiro/settings/mcp.json shape and registration. Refs: Req 17.1, 17.2, 17.3, 17.4, REQ-MCP-3
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTO_APPROVE } from "../scripts/print-mcp-config.mjs";
import { TOOLS } from "../src/tools/registry.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const file = resolve(repoRoot, ".kiro", "settings", "mcp.json");

const expected = {
  mcpServers: {
    lethe: {
      command: "node",
      args: ["packages/lethe-mcp/dist/lethe.mjs", "serve"],
      autoApprove: ["lethe_score_memories", "lethe_detect_contradictions"],
    },
  },
};

interface ServerEntry {
  readonly args: string[];
  readonly autoApprove: string[];
}

describe(".kiro/settings/mcp.json", () => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const entry = (parsed as { mcpServers: { lethe: ServerEntry } }).mcpServers.lethe;
  const readOnly = TOOLS.filter((t) => !t.mutating).map((t) => t.name as string);
  const mutating = TOOLS.filter((t) => t.mutating).map((t) => t.name as string);

  it("equals the expected object exactly", () => {
    expect(parsed).toStrictEqual(expected);
  });

  it("autoApprove contains only read-only tool names, never * or a mutating tool", () => {
    expect(entry.autoApprove).not.toContain("*");
    for (const name of entry.autoApprove) {
      expect(readOnly).toContain(name);
      expect(mutating).not.toContain(name);
    }
    expect([...entry.autoApprove].sort()).toEqual([...readOnly].sort());
  });

  it("matches print-mcp-config AUTO_APPROVE", () => {
    expect(entry.autoApprove).toEqual([...AUTO_APPROVE]);
  });

  it("has no env, disabled or disabledTools at server level", () => {
    for (const k of ["env", "disabled", "disabledTools"]) {
      expect(entry).not.toHaveProperty(k);
    }
  });

  it("args[0] exists relative to the repo root and args[1] is serve", () => {
    expect(existsSync(resolve(repoRoot, entry.args[0] as string))).toBe(true);
    expect(entry.args[1]).toBe("serve");
  });
});
