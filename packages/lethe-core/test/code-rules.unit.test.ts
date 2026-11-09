// AST enforcement of 03-rules sections 1-3 over every src/**/*.ts (requirement 6.8).
//
// Counting rules:
// - Function length: lines from the body's first line (opening brace / expression start) to its last
//   line, inclusive. Blank and comment lines inside the body count.
// - Cyclomatic complexity: 1 + if, for, for-of, for-in, while, do, non-default case clauses, catch,
//   conditional (?:), &&, ||, ??. Optional chaining is not counted. Nested function-likes are
//   measured separately and are not added to their parent.
// - Function-likes: declarations, expressions, arrows, methods, constructors, get/set accessors.
// - Switches without a default are reported (console), not failed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");
const MAX_FN_LINES = 40;
const MAX_COMPLEXITY = 10;
// "file:name" -> reason. Keep minimal.
const ALLOW: ReadonlyMap<string, string> = new Map<string, string>([]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((full) => {
  const rel = relative(SRC, full).split("\\").join("/");
  const text = readFileSync(full, "utf8");
  return { rel, text, sf: ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true) };
});

type FnLike =
  | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
  | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;

function isFnLike(n: ts.Node): n is FnLike {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n);
}

function visit(sf: ts.SourceFile, cb: (n: ts.Node) => void): void {
  const go = (n: ts.Node): void => { cb(n); ts.forEachChild(n, go); };
  go(sf);
}

function fnName(n: FnLike): string {
  if (n.name !== undefined) return n.name.getText();
  const p = n.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return p.name.getText();
  return `<anon@${n.getStart()}>`;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function complexityOf(fn: FnLike): number {
  let c = 1;
  const go = (n: ts.Node): void => {
    if (n !== fn && isFnLike(n)) return;
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement: case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForOfStatement: case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.WhileStatement: case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause: case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.CaseClause:
        c++; break;
      case ts.SyntaxKind.BinaryExpression: {
        const k = (n as ts.BinaryExpression).operatorToken.kind;
        if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken ||
            k === ts.SyntaxKind.QuestionQuestionToken) c++;
        break;
      }
      default: break;
    }
    ts.forEachChild(n, go);
  };
  go(fn);
  return c;
}

describe("tsconfig-independent code rules over src/", () => {
  it("has no `any`, `as any`, or non-null assertions", () => {
    const bad: string[] = [];
    for (const { rel, sf } of files) {
      visit(sf, (n) => {
        if (n.kind === ts.SyntaxKind.AnyKeyword) bad.push(`${rel}:${lineOf(sf, n.getStart())} any`);
        if (n.kind === ts.SyntaxKind.NonNullExpression) bad.push(`${rel}:${lineOf(sf, n.getStart())} non-null`);
      });
    }
    expect(bad).toEqual([]);
  });

  it("has no @ts-ignore/@ts-nocheck and justified @ts-expect-error only", () => {
    const bad: string[] = [];
    let expectErrors = 0;
    for (const { rel, text } of files) {
      text.split("\n").forEach((line, i) => {
        if (/@ts-(ignore|nocheck)/.test(line)) bad.push(`${rel}:${i + 1} ${line.trim()}`);
        const m = /@ts-expect-error(.*)$/.exec(line);
        if (m !== null) {
          expectErrors++;
          if ((m[1] ?? "").trim().length < 5) bad.push(`${rel}:${i + 1} unjustified @ts-expect-error`);
        }
      });
    }
    console.info(`@ts-expect-error count in src: ${expectErrors}`);
    expect(bad).toEqual([]);
  });

  it(`keeps every function body <= ${MAX_FN_LINES} lines and complexity <= ${MAX_COMPLEXITY}`, () => {
    const bad: string[] = [];
    const allowed: string[] = [];
    for (const { rel, sf } of files) {
      visit(sf, (n) => {
        if (!isFnLike(n) || n.body === undefined) return;
        const lines = lineOf(sf, n.body.getEnd()) - lineOf(sf, n.body.getStart()) + 1;
        const cc = complexityOf(n);
        if (lines <= MAX_FN_LINES && cc <= MAX_COMPLEXITY) return;
        const key = `${rel}:${fnName(n)}`;
        const msg = `${key} lines=${lines} complexity=${cc}`;
        if (ALLOW.has(key)) allowed.push(`${msg} (${ALLOW.get(key)})`);
        else bad.push(msg);
      });
    }
    if (allowed.length > 0) console.info(`allow-listed: ${allowed.join("; ")}`);
    expect(bad).toEqual([]);
  });

  it("reports switches without a default", () => {
    const noDefault: string[] = [];
    for (const { rel, sf } of files) {
      visit(sf, (n) => {
        if (ts.isSwitchStatement(n) && !n.caseBlock.clauses.some(ts.isDefaultClause)) {
          noDefault.push(`${rel}:${lineOf(sf, n.getStart())}`);
        }
      });
    }
    console.info(`switches without default (${noDefault.length}): ${noDefault.join(", ")}`);
    expect(Array.isArray(noDefault)).toBe(true);
  });

  it("declares every interface property in src/types.ts as readonly", () => {
    const sf = files.find((f) => f.rel === "types.ts")?.sf;
    expect(sf).toBeDefined();
    if (sf === undefined) return;
    const bad: string[] = [];
    visit(sf, (n) => {
      if (!ts.isPropertySignature(n)) return;
      const ro = n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
      if (!ro) bad.push(`types.ts:${lineOf(sf, n.getStart())} ${n.name.getText()}`);
    });
    expect(bad).toEqual([]);
  });
});
