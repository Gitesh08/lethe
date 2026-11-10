// Rule enforcement: import boundary and layering for @lethe/mcp (design.md "Layering rules").
// Refs: Req 1.7, Req 7.1, Req 22.1
import { posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { loadSources, visit } from "./support/source-files.js";

type Kind = "static" | "dynamic" | "reexport";

interface Imp {
  readonly spec: string;
  readonly kind: Kind;
  readonly line: number;
}

/** Resolved view of an import: `target` is the src-relative module path (no extension) for relative specs. */
interface Ctx {
  readonly rel: string;
  readonly imp: Imp;
  readonly target: string | undefined;
}

interface Rule {
  readonly id: string;
  /** Returns a message when `ctx` violates the rule. */
  readonly check: (ctx: Ctx) => string | undefined;
}

const FS_SPECS = new Set(["node:fs", "node:fs/promises", "fs", "fs/promises"]);
const FS_MODULES = new Set(["io/workspace-fs.ts", "io/fs-walk.ts", "io/fs-append.ts"]);
const TOOL_SUPPORT = new Set(["tools/schemas-common", "tools/schemas", "tools/tool", "tools/registry"]);
const inDir = (p: string | undefined, dir: string): boolean => p !== undefined && p.startsWith(`${dir}/`);
const isToolModule = (p: string | undefined): boolean => inDir(p, "tools") && !TOOL_SUPPORT.has(p ?? "");
const stem = (rel: string): string => rel.replace(/\.ts$/, "");

const forbidTargets = (from: string[], to: (t: string) => boolean, why: string) =>
  ({ rel, target }: Ctx): string | undefined =>
    from.some((d) => inDir(rel, d)) && target !== undefined && to(target) ? why : undefined;

/** Declarative rule table; later tasks extend this array. */
export const RULES: ReadonlyArray<Rule> = [
  { id: "fs-only-workspace-fs", check: ({ rel, imp }) =>
      FS_SPECS.has(imp.spec) && !FS_MODULES.has(rel) ? "only io/workspace-fs.ts (and its siblings io/fs-walk.ts, io/fs-append.ts) may import node:fs" : undefined },
  { id: "child-process-only-git", check: ({ rel, imp }) =>
      (imp.spec === "node:child_process" || imp.spec === "child_process") && rel !== "io/git.ts"
        ? "only io/git.ts may import node:child_process" : undefined },
  { id: "ops-not-upward", check: forbidTargets(["ops"],
      (t) => inDir(t, "tools") || inDir(t, "cli") || t === "server", "ops/* must not import tools/*, cli/* or server") },
  { id: "lower-layers-not-upward", check: forbidTargets(["load", "persist", "io"],
      (t) => inDir(t, "ops") || inDir(t, "tools") || inDir(t, "cli") || t === "server",
      "load/*, persist/*, io/* must not import ops/*, tools/*, cli/* or server") },
  { id: "tool-modules-only-via-registry", check: ({ rel, target }) =>
      isToolModule(target) && stem(rel) !== "tools/registry" ? "only tools/registry.ts may import tool modules" : undefined },
  { id: "core-public-entries-only", check: ({ rel, imp }) => {
      if (imp.spec === "@lethe/core") return undefined;
      if (imp.spec === "@lethe/core/properties") {
        return inDir(rel, "gate") && imp.kind === "dynamic" ? undefined
          : "@lethe/core/properties only from gate/* via dynamic import()";
      }
      return imp.spec.startsWith("@lethe/core") ? `forbidden @lethe/core entry "${imp.spec}"` : undefined;
    } },
  { id: "no-relative-escape-from-src", check: ({ imp, target }) =>
      imp.spec.startsWith(".") && (target === undefined || target.startsWith("..")) ? "relative import escapes src/" : undefined },
];

function importsOf(sf: ts.SourceFile): Imp[] {
  const out: Imp[] = [];
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  visit(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (n.importClause?.isTypeOnly !== true) out.push({ spec: n.moduleSpecifier.text, kind: "static", line: line(n) });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      if (!n.isTypeOnly) out.push({ spec: n.moduleSpecifier.text, kind: "reexport", line: line(n) });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = n.arguments[0];
      if (a !== undefined && ts.isStringLiteralLike(a)) out.push({ spec: a.text, kind: "dynamic", line: line(n) });
    }
  });
  return out;
}

function resolveTarget(rel: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const t = posix.normalize(posix.join(posix.dirname(rel), spec));
  return t.replace(/\.(js|ts)$/, "");
}

/** Returns "rule-id file:line message" strings for one source text. */
export function checkSource(rel: string, text: string, rules: ReadonlyArray<Rule> = RULES): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  for (const imp of importsOf(sf)) {
    const ctx: Ctx = { rel, imp, target: resolveTarget(rel, imp.spec) };
    for (const r of rules) {
      const msg = r.check(ctx);
      if (msg !== undefined) found.push(`${r.id} ${rel}:${imp.line} ${msg} ("${imp.spec}")`);
    }
  }
  return found;
}

describe("src layering and import boundaries", () => {
  it("has no violations across src/**/*.ts", () => {
    const sources = loadSources();
    expect(sources.length).toBeGreaterThan(0);
    const problems = sources.flatMap((s) => checkSource(s.rel, s.text));
    expect(problems).toEqual([]);
  });

  it("keeps the rule table ids unique", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("rule checker is not vacuous", () => {
  const ids = (rel: string, text: string): string[] => checkSource(rel, text).map((m) => m.split(" ")[0] ?? "");

  it("fs-only-workspace-fs flags fs variants outside workspace-fs and allows it inside", () => {
    expect(ids("io/lock.ts", 'import { open } from "node:fs/promises";')).toEqual(["fs-only-workspace-fs"]);
    expect(ids("ops/x.ts", 'export * from "fs";')).toEqual(["fs-only-workspace-fs"]);
    expect(ids("io/workspace-fs.ts", 'import { readFileSync } from "node:fs";')).toEqual([]);
    expect(ids("io/fs-walk.ts", 'import { readdir } from "node:fs/promises";')).toEqual([]);
  });

  it("child-process-only-git flags other modules", () => {
    expect(ids("io/backup.ts", 'import { execFile } from "node:child_process";')).toEqual(["child-process-only-git"]);
    expect(ids("io/git.ts", 'import { execFile } from "node:child_process";')).toEqual([]);
  });

  it("ops-not-upward and lower-layers-not-upward flag upward imports", () => {
    expect(ids("ops/score.ts", 'import { x } from "../tools/schemas-common.js";')).toEqual(["ops-not-upward"]);
    expect(ids("ops/score.ts", 'import { x } from "../tools/score-tool.js";')).toContain("ops-not-upward");
    expect(ids("ops/score.ts", 'import { x } from "../server.js";')).toEqual(["ops-not-upward"]);
    expect(ids("load/steering.ts", 'import { x } from "../ops/context.js";')).toEqual(["lower-layers-not-upward"]);
    expect(ids("io/git.ts", 'const m = await import("../cli/run.js");')).toEqual(["lower-layers-not-upward"]);
    expect(ids("ops/score.ts", 'import { x } from "../load/workspace.js";')).toEqual([]);
  });

  it("tool-modules-only-via-registry flags tool imports except from the registry", () => {
    expect(ids("server.ts", 'import { t } from "./tools/score.js";')).toEqual(["tool-modules-only-via-registry"]);
    expect(ids("tools/detect.ts", 'import { t } from "./score.js";')).toEqual(["tool-modules-only-via-registry"]);
    expect(ids("tools/registry.ts", 'import { t } from "./score.js";')).toEqual([]);
    expect(ids("tools/score.ts", 'import { z } from "./schemas-common.js";')).toEqual([]);
  });

  it("core-public-entries-only restricts deep, properties and fixtures imports", () => {
    expect(ids("ops/a.ts", 'import { s } from "@lethe/core";')).toEqual([]);
    expect(ids("ops/a.ts", 'import { s } from "@lethe/core/src/decay/retention.js";')).toEqual(["core-public-entries-only"]);
    expect(ids("gate/gate.ts", 'import { p } from "@lethe/core/properties";')).toEqual(["core-public-entries-only"]);
    expect(ids("ops/a.ts", 'const p = await import("@lethe/core/properties");')).toEqual(["core-public-entries-only"]);
    expect(ids("gate/gate.ts", 'const p = await import("@lethe/core/properties");')).toEqual([]);
    expect(ids("gate/gate.ts", 'import { f } from "@lethe/core/fixtures";')).toEqual(["core-public-entries-only"]);
  });

  it("no-relative-escape-from-src flags escapes", () => {
    expect(ids("ops/a.ts", 'import { x } from "../../test/support/x.js";')).toEqual(["no-relative-escape-from-src"]);
    expect(ids("index.ts", 'import { x } from "../package.json";')).toEqual(["no-relative-escape-from-src"]);
  });

  it("ignores import type and export type", () => {
    expect(ids("ops/a.ts", 'import type { T } from "node:fs";\nexport type { U } from "../tools/x.js";')).toEqual([]);
  });
});
