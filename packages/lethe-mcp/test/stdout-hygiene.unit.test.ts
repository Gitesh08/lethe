// Requirement 19.2 / INV-8: stdout carries protocol only. Only io/stdout.ts may touch process.stdout,
// and no stdout-writing console method may appear anywhere in src. Validates: Requirements 19.2
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { loadSources, stripCommentsAndStrings, visit } from "./support/source-files.js";

const STDOUT_MODULE = "io/stdout.ts";
const FORBIDDEN_CONSOLE: ReadonlySet<string> = new Set(["log", "info", "debug", "table", "dir"]);

/** Strip wrappers so `(process as X)`, `process!` and `globalThis.process` reduce to the base name. */
function baseName(e: ts.Expression): string {
  let cur: ts.Expression = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) ||
         ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  if (ts.isIdentifier(cur)) return cur.text;
  if (ts.isPropertyAccessExpression(cur) && cur.name.text === "process" &&
      ts.isIdentifier(cur.expression) && cur.expression.text === "globalThis") return "process";
  return "";
}

function keyOf(arg: ts.Expression): string | undefined {
  return ts.isStringLiteralLike(arg) ? arg.text : undefined;
}

/** Member name accessed on `target` by property access or element access with a literal key. */
function accessed(n: ts.Node): { base: string; member: string } | undefined {
  if (ts.isPropertyAccessExpression(n)) return { base: baseName(n.expression), member: n.name.text };
  if (ts.isElementAccessExpression(n)) {
    const k = keyOf(n.argumentExpression);
    return k === undefined ? undefined : { base: baseName(n.expression), member: k };
  }
  return undefined;
}

function destructured(n: ts.Node): { base: string; members: string[] } | undefined {
  if (!ts.isVariableDeclaration(n) || n.initializer === undefined) return undefined;
  if (!ts.isObjectBindingPattern(n.name)) return undefined;
  const members = n.name.elements.map((el) => (el.propertyName ?? el.name).getText().replace(/^["']|["']$/g, ""));
  return { base: baseName(n.initializer), members };
}

/** Findings from the TS AST over the original text (catches element access and destructuring). */
function astFindings(rel: string, text: string): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
  const out: string[] = [];
  visit(sf, (n) => {
    const a = accessed(n);
    if (a?.base === "process" && a.member === "stdout") out.push(`${rel}: process.stdout access`);
    if (a?.base === "console" && FORBIDDEN_CONSOLE.has(a.member)) out.push(`${rel}: console.${a.member}`);
    const d = destructured(n);
    if (d?.base === "process" && d.members.includes("stdout")) out.push(`${rel}: destructured process.stdout`);
    for (const m of d?.base === "console" ? d.members : []) {
      if (FORBIDDEN_CONSOLE.has(m)) out.push(`${rel}: destructured console.${m}`);
    }
  });
  return out;
}

/** Findings from regex over comment/string-stripped text (cheap second net). */
function regexFindings(rel: string, text: string): string[] {
  const s = stripCommentsAndStrings(text);
  const out: string[] = [];
  if (/\bprocess\s*\.\s*stdout\b/.test(s)) out.push(`${rel}: process.stdout reference`);
  const re = /\bconsole\s*\.\s*(log|info|debug|table|dir)\b/g;
  for (const m of s.matchAll(re)) out.push(`${rel}: console.${m[1] ?? ""}`);
  return out;
}

function scan(rel: string, text: string): string[] {
  const all = [...regexFindings(rel, text), ...astFindings(rel, text)];
  return rel === STDOUT_MODULE ? all.filter((f) => !f.includes("process.stdout") && !f.includes("process stdout")
    && !f.includes("destructured process.stdout")) : all;
}

describe("stdout hygiene (INV-8)", () => {
  it("keeps process.stdout confined to io/stdout.ts and bans stdout-writing console methods", () => {
    const bad = loadSources().flatMap(({ rel, text }) => scan(rel, text));
    expect(bad).toEqual([]);
  });

  it("scans at least one source file", () => {
    expect(loadSources().length).toBeGreaterThan(0);
  });

  describe("scanner is not vacuous", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["process.stdout.write", `process.stdout.write("x");`],
      ["globalThis.process.stdout", `globalThis.process.stdout.write("x");`],
      ["destructured stdout", `const { stdout } = process;`],
      ["destructured stdout (renamed)", `const { stdout: out } = globalThis.process;`],
      ["element access", `process["stdout"].write("x");`],
      ["console.log", `console.log("x");`],
      ["console.info", `console.info("x");`],
      ["console.debug", `console.debug("x");`],
      ["console.table", `console.table([]);`],
      ["console.dir", `console.dir({});`],
      ["console element access", `console["log"]("x");`],
      ["destructured console.log", `const { log } = console;`],
    ];
    it.each(cases)("flags %s", (_name, code) => {
      expect(scan("fixture.ts", code).length).toBeGreaterThan(0);
    });

    it("allows io/stdout.ts to use process.stdout but not console.log", () => {
      expect(scan(STDOUT_MODULE, `process.stdout.write("x");`)).toEqual([]);
      expect(scan(STDOUT_MODULE, `const { stdout } = process; process["stdout"];`)).toEqual([]);
      expect(scan(STDOUT_MODULE, `console.log("x");`).length).toBeGreaterThan(0);
    });

    it("ignores stderr logging, comments and strings", () => {
      const ok = [
        `console.error("x"); console.warn("y"); process.stderr.write("z");`,
        `// process.stdout.write(1)\n/* console.log(1) */`,
        "const s = 'process.stdout console.log'; const t = `console.info`;",
      ].join("\n");
      expect(scan("fixture.ts", ok)).toEqual([]);
    });
  });
});
