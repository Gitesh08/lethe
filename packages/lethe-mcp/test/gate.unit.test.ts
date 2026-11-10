// Default gate runner: lazy import discipline and a real run against core's properties.
// Refs: Req 14.1, Req 14.6, REQ-PBT-3, REQ-MCP-5
import { DEFAULT_CONFIG } from "@lethe/core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { defaultGateRunner } from "../src/gate/gate.js";
import { loadSources, visit } from "./support/source-files.js";

describe("gate.ts import discipline", () => {
  it("references @lethe/core/properties only via dynamic import inside function bodies", () => {
    const src = loadSources().find((s) => s.rel === "gate/gate.ts");
    expect(src).toBeDefined();
    const sf = ts.createSourceFile("gate.ts", src?.text ?? "", ts.ScriptTarget.ES2022, true);
    let staticValueImports = 0;
    let dynamicOutsideFunction = 0;
    let dynamicTotal = 0;
    const inFunction = (n: ts.Node): boolean => {
      for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
        if (ts.isFunctionLike(p)) return true;
      }
      return false;
    };
    visit(sf, (n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)
          && n.moduleSpecifier.text.startsWith("@lethe/core/") && n.importClause?.isTypeOnly !== true) {
        staticValueImports += 1;
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dynamicTotal += 1;
        if (!inFunction(n)) dynamicOutsideFunction += 1;
      }
    });
    expect(staticValueImports).toBe(0);
    expect(dynamicTotal).toBeGreaterThan(0);
    expect(dynamicOutsideFunction).toBe(0);
  });
});

describe("defaultGateRunner", () => {
  it("passes on the real properties and echoes numRuns", async () => {
    const out = await defaultGateRunner(DEFAULT_CONFIG, 50);
    expect(out).toEqual({ status: "passed", ran: 12, numRuns: 50 });
  }, 120_000);
});
