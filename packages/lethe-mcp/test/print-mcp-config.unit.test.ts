// Task 11.5: print-mcp-config.mjs. Refs: Req 17.2, 17.3, 17.5
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVE,
  defaultDistPath,
  mcpConfigEntry,
} from "../scripts/print-mcp-config.mjs";
import { TOOLS } from "../src/tools/registry.js";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(pkgDir, "scripts", "print-mcp-config.mjs");

function run(): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe("print-mcp-config.mjs", () => {
  const out = run();
  const parsed: unknown = JSON.parse(out.stdout);
  const cfg = parsed as ReturnType<typeof mcpConfigEntry>;
  const entry = cfg.mcpServers.lethe;
  const readOnly = TOOLS.filter((t) => !t.mutating).map((t) => t.name);

  it("exits 0 and prints exactly the expected shape", () => {
    expect(out.status).toBe(0);
    expect(Object.keys(cfg)).toEqual(["mcpServers"]);
    expect(Object.keys(cfg.mcpServers)).toEqual(["lethe"]);
    expect(Object.keys(entry).sort()).toEqual(["args", "autoApprove", "command"]);
    expect(entry.command).toBe("node");
    expect(entry.args).toHaveLength(2);
    expect(entry.args[1]).toBe("serve");
  });

  it("has no env, disabled or disabledTools", () => {
    for (const k of ["env", "disabled", "disabledTools"]) {
      expect(entry).not.toHaveProperty(k);
    }
  });

  it("autoApprove is exactly the two read-only tools, matching the registry", () => {
    expect(entry.autoApprove).toEqual(["lethe_score_memories", "lethe_detect_contradictions"]);
    expect([...entry.autoApprove].sort()).toEqual([...readOnly].sort());
    expect([...AUTO_APPROVE]).toEqual(entry.autoApprove);
  });

  it("args[0] is an absolute dist/lethe.mjs path under the package dir", () => {
    const p = entry.args[0] as string;
    expect(isAbsolute(p)).toBe(true);
    expect(p.split(sep).join("/").endsWith("dist/lethe.mjs")).toBe(true);
    expect(p.startsWith(pkgDir + sep)).toBe(true);
    expect(p).toBe(defaultDistPath());
  });

  it("path-exists branch XOR missing-file warning branch", () => {
    const p = entry.args[0] as string;
    if (existsSync(p)) {
      expect(out.stderr).not.toContain("warning");
      console.error("print-mcp-config test: dist exists branch ran");
    } else {
      expect(out.stderr).toContain("does not exist yet");
      console.error("print-mcp-config test: dist missing (warning) branch ran");
    }
  });

  it("pure mcpConfigEntry embeds the given path verbatim", () => {
    const e = mcpConfigEntry("/x/dist/lethe.mjs");
    expect(e.mcpServers.lethe.args).toEqual(["/x/dist/lethe.mjs", "serve"]);
  });

  it("matches workspace .kiro/settings/mcp.json autoApprove when present", () => {
    const f = resolve(pkgDir, "..", "..", ".kiro", "settings", "mcp.json");
    if (!existsSync(f)) {
      console.error("print-mcp-config test: workspace mcp.json absent, skipped");
      return;
    }
    const ws = JSON.parse(readFileSync(f, "utf8")) as {
      mcpServers: { lethe: { autoApprove: string[] } };
    };
    expect(ws.mcpServers.lethe.autoApprove).toEqual(entry.autoApprove);
  });
});
