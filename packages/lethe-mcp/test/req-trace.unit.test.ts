// Traceability: every REQ-MCP/REQ-HOK/NFR id in requirements.md is cited by a test; script is deterministic.
// Refs: Req 21.9, Rules-11
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectTestFiles, defaultRoot, extractIds, traceTable } from "../scripts/req-trace.mjs";

const root = defaultRoot();
const script = resolve(root, "scripts", "req-trace.mjs");
const requirements = resolve(root, "..", "..", ".kiro", "specs", "lethe-mcp", "requirements.md");

describe("requirement traceability", () => {
  it("every REQ-MCP-*, REQ-HOK-* and NFR-* id is cited by at least one test file", () => {
    const wanted = extractIds(readFileSync(requirements, "utf8")).filter((id) => /^(REQ-MCP-|REQ-HOK-|NFR-)/.test(id));
    expect(wanted.length).toBeGreaterThan(0);
    const cited = new Set<string>();
    for (const f of collectTestFiles(root)) for (const id of extractIds(f.text)) cited.add(id);
    const missing = wanted.filter((id) => !cited.has(id)).sort();
    expect(missing, `uncited ids: ${missing.join(", ")}`).toEqual([]);
    expect(traceTable(collectTestFiles(root))).toContain("| NFR-3 |");
  });

  it("two runs produce byte-identical LF-only output ending in exactly one newline", () => {
    const run = () => spawnSync(process.execPath, [script], { encoding: "utf8" });
    const a = run();
    const b = run();
    expect(a.status).toBe(0);
    expect(b.stdout).toBe(a.stdout);
    expect(a.stdout).not.toContain("\r");
    expect(a.stdout.endsWith("\n")).toBe(true);
    expect(a.stdout.endsWith("\n\n")).toBe(false);
  });

  describe("extractIds", () => {
    const ids = (t: string) => extractIds(t).sort();
    it("expands dotted continuation lists", () => {
      expect(ids("Refs: Req 13.3, 13.4, 13.5")).toEqual(["Req 13.3", "Req 13.4", "Req 13.5"]);
    });
    it("expands minor ranges", () => {
      expect(ids("Req 18.1-18.7")).toEqual(["Req 18.1", "Req 18.2", "Req 18.3", "Req 18.4", "Req 18.5", "Req 18.6", "Req 18.7"]);
    });
    it("expands REQ-MCP ranges", () => {
      expect(ids("REQ-MCP-1..6")).toEqual(["REQ-MCP-1", "REQ-MCP-2", "REQ-MCP-3", "REQ-MCP-4", "REQ-MCP-5", "REQ-MCP-6"]);
    });
    it("reads INV and NFR ids", () => {
      expect(ids("INV-8 and NFR-2")).toEqual(["INV-8", "NFR-2"]);
    });
    it("does not take bare continuation numbers", () => {
      expect(ids("Req 21.4, 22")).toEqual(["Req 21.4"]);
    });
  });
});
