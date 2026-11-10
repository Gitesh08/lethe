// Registry holds exactly four tools; only registry.ts imports tool modules; server.ts only registry.
// Refs: Req 1.1, Req 1.7, REQ-MCP-1
import { existsSync } from "node:fs";
import { posix } from "node:path";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools/registry.js";
import { SRC, loadSources, visit } from "./support/source-files.js";

const REQUIRED = [
  "lethe_consolidate_sleep",
  "lethe_detect_contradictions",
  "lethe_resurrect_engram",
  "lethe_score_memories",
];

/** Throws unless `tools` has exactly the four required names. */
function assertExactlyFour(tools: ReadonlyArray<{ readonly name: string }>): void {
  expect(tools.length).toBe(4);
  expect(tools.map((t) => t.name).sort()).toEqual(REQUIRED);
}

const TOOL_MODULES = new Set(["tools/score", "tools/detect", "tools/sleep", "tools/resurrect"]);

/** Resolved src-relative targets (no extension) of every relative import/re-export/dynamic import. */
function importTargets(rel: string, sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const push = (spec: string): void => {
    if (spec.startsWith(".")) out.push(posix.normalize(posix.join(posix.dirname(rel), spec)).replace(/\.(js|ts)$/, ""));
  };
  visit(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) push(n.moduleSpecifier.text);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = n.arguments[0];
      if (a !== undefined && ts.isStringLiteralLike(a)) push(a.text);
    }
  });
  return out;
}

describe("registry has exactly four tools", () => {
  it("TOOLS has the four required names", () => {
    assertExactlyFour(TOOLS);
  });

  it("the assertion bites on a fifth entry and on a missing entry", () => {
    expect(() => assertExactlyFour([...TOOLS, TOOLS[0]])).toThrow();
    expect(() => assertExactlyFour(TOOLS.slice(0, 3))).toThrow();
  });

  it("the assertion bites when a name is wrong", () => {
    const renamed = TOOLS.map((t, i) => (i === 0 ? { name: "lethe_other" } : t));
    expect(() => assertExactlyFour(renamed)).toThrow();
  });
});

describe("tool module import boundary", () => {
  const sources = loadSources();

  it("only tools/registry.ts imports the four tool modules", () => {
    const importers = sources
      .filter((s) => importTargets(s.rel, s.sf).some((t) => TOOL_MODULES.has(t)))
      .map((s) => s.rel);
    expect(importers).toEqual(["tools/registry.ts"]);
  });

  const hasServer = existsSync(join(SRC, "server.ts"));
  it.skipIf(!hasServer)("server.ts imports from tools/ only tools/registry", () => {
    const server = sources.find((s) => s.rel === "server.ts");
    expect(server).toBeDefined();
    const fromTools = importTargets("server.ts", server!.sf).filter((t) => t.startsWith("tools/"));
    expect(fromTools.length).toBeGreaterThan(0);
    expect([...new Set(fromTools)]).toEqual(["tools/registry"]);
  });
});
