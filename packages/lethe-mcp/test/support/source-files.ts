// Shared helpers for source-scanning rule tests over packages/lethe-mcp/src.
//
// Counting rules (identical to lethe-core's code-rules test):
// - Function length: lines from the body's first line (opening brace / expression start) to its last
//   line, inclusive. Blank and comment lines inside the body count.
// - Cyclomatic complexity: 1 + if, for, for-of, for-in, while, do, non-default case clauses, catch,
//   conditional (?:), &&, ||, ??. Optional chaining is not counted. Nested function-likes are
//   measured separately and are not added to their parent.
// - Function-likes: declarations, expressions, arrows, methods, constructors, get/set accessors.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SRC = join(PKG, "src");

export type FnLike =
  | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
  | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;

export interface SourceEntry {
  readonly rel: string;
  readonly text: string;
  readonly sf: ts.SourceFile;
}

/** Sorted, recursive list of `.ts` files under `dir`. */
export function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Parse every src/**\/*.ts; `rel` is relative to src with `/` separators. */
export function loadSources(): ReadonlyArray<SourceEntry> {
  return walkTs(SRC).map((full) => {
    const rel = relative(SRC, full).split("\\").join("/");
    const text = readFileSync(full, "utf8");
    return { rel, text, sf: ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true) };
  });
}

/** Blank out comments and string/template contents, preserving newlines (crude, no regex literals). */
export function stripCommentsAndStrings(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    const n = text[i + 1] ?? "";
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      out += c;
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === "\\") i += 1;
        out += text[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function isFnLike(n: ts.Node): n is FnLike {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n);
}

export function visit(sf: ts.SourceFile, cb: (n: ts.Node) => void): void {
  const go = (n: ts.Node): void => { cb(n); ts.forEachChild(n, go); };
  go(sf);
}

export function fnName(n: FnLike): string {
  if (n.name !== undefined) return n.name.getText();
  const p = n.parent;
  if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) return p.name.getText();
  return `<anon@${n.getStart()}>`;
}

export function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

export function complexityOf(fn: FnLike): number {
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
