// Type hygiene and file size rules (03-rules sections 1 and 3) over lethe-mcp src/**/*.ts.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lineOf, loadSources, visit } from "./support/source-files.js";

const MAX_FILE_LINES = 200;
const MIN_EXPLANATION_CHARS = 5;

function parse(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
}

function fileLines(text: string): number {
  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

/** `any` keywords (covers `as any`, `: any`, `any[]`, generics). */
function findAny(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  visit(sf, (n) => {
    if (n.kind === ts.SyntaxKind.AnyKeyword) out.push(`${sf.fileName}:${lineOf(sf, n.getStart())} any`);
    if (ts.isAsExpression(n) && n.type.kind === ts.SyntaxKind.AnyKeyword) {
      out.push(`${sf.fileName}:${lineOf(sf, n.getStart())} as any`);
    }
  });
  return out;
}

function findNonNull(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  visit(sf, (n) => {
    if (ts.isNonNullExpression(n)) out.push(`${sf.fileName}:${lineOf(sf, n.getStart())} non-null !`);
  });
  return out;
}

function findDirectives(rel: string, text: string): string[] {
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (/@ts-(ignore|nocheck)\b/.test(line)) out.push(`${rel}:${i + 1} ${line.trim()}`);
    const m = /@ts-expect-error\b(.*)$/.exec(line);
    if (m !== null) {
      const rest = (m[1] ?? "").replace(/^[\s:\-*/]+/, "").replace(/[\s*/]+$/, "");
      if (rest.length < MIN_EXPLANATION_CHARS) out.push(`${rel}:${i + 1} unexplained @ts-expect-error`);
    }
  });
  return out;
}

const isExported = (n: ts.Node): boolean =>
  ts.canHaveModifiers(n) &&
  (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Property signatures (any depth) inside exported interfaces and type aliases lacking `readonly`. */
function findMutableFields(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  visit(sf, (decl) => {
    if (!(ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) || !isExported(decl)) return;
    visit(decl as unknown as ts.SourceFile, (n) => {
      if (!ts.isPropertySignature(n)) return;
      const ro = (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
      if (!ro) out.push(`${sf.fileName}:${lineOf(sf, n.getStart())} ${decl.name.text}.${n.name.getText()}`);
    });
  });
  return out;
}

const scanAll = (rel: string, text: string): string[] => {
  const sf = parse(rel, text);
  return [
    ...findAny(sf), ...findNonNull(sf), ...findDirectives(rel, text), ...findMutableFields(sf),
  ];
};

describe("type hygiene over src", () => {
  const files = loadSources();

  it("scans at least one source file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it(`keeps every file <= ${MAX_FILE_LINES} lines`, () => {
    const bad = files.filter((f) => fileLines(f.text) > MAX_FILE_LINES).map((f) => `${f.rel} ${fileLines(f.text)}`);
    expect(bad).toEqual([]);
  });

  it("has no any or as any", () => {
    expect(files.flatMap((f) => findAny(f.sf))).toEqual([]);
  });

  it("has no non-null assertions", () => {
    expect(files.flatMap((f) => findNonNull(f.sf))).toEqual([]);
  });

  it("has no @ts-ignore/@ts-nocheck and only explained @ts-expect-error", () => {
    expect(files.flatMap((f) => findDirectives(f.rel, f.text))).toEqual([]);
  });

  it("marks every exported interface/type-literal property readonly", () => {
    expect(files.flatMap((f) => findMutableFields(f.sf))).toEqual([]);
  });
});

describe("scanner non-vacuity (inline fixtures)", () => {
  it("flags any and as any", () => {
    expect(findAny(parse("f.ts", "const a: any = 1;"))).toHaveLength(1);
    expect(findAny(parse("f.ts", "const b = (1 as any);")).length).toBeGreaterThanOrEqual(1);
    expect(findAny(parse("f.ts", "const c: unknown = 1;"))).toEqual([]);
  });

  it("flags non-null assertions", () => {
    expect(findNonNull(parse("f.ts", "declare const x: string | undefined;\nexport const y = x!;"))).toHaveLength(1);
    expect(findNonNull(parse("f.ts", "export const y = 1 !== 2;"))).toEqual([]);
  });

  it("flags @ts-ignore, @ts-nocheck and unexplained @ts-expect-error", () => {
    expect(findDirectives("f.ts", "// @ts-ignore\nconst a = 1;")).toHaveLength(1);
    expect(findDirectives("f.ts", "// @ts-nocheck")).toHaveLength(1);
    expect(findDirectives("f.ts", "// @ts-expect-error")).toHaveLength(1);
    expect(findDirectives("f.ts", "// @ts-expect-error: ok")).toHaveLength(1);
    expect(findDirectives("f.ts", "// @ts-expect-error: deliberate bad call, TODO-12")).toEqual([]);
  });

  it("flags non-readonly fields in exported interfaces and nested type literals", () => {
    expect(findMutableFields(parse("f.ts", "export interface A { x: number }"))).toHaveLength(1);
    expect(findMutableFields(parse("f.ts", "export type B = { readonly x: { y: number } };"))).toHaveLength(1);
    expect(findMutableFields(parse("f.ts", "export interface C { readonly x: number }"))).toEqual([]);
    expect(findMutableFields(parse("f.ts", "interface D { x: number }"))).toEqual([]);
  });

  it("combined fixture trips every rule", () => {
    const text = [
      "export interface Bad { x: number }",
      "export const a: any = 1;",
      "declare const s: string | undefined;",
      "export const t = s!;",
      "// @ts-ignore",
      "export const u = 2;",
    ].join("\n");
    expect(scanAll("f.ts", text).length).toBeGreaterThanOrEqual(4);
  });

  it("counts lines ignoring a trailing newline", () => {
    expect(fileLines("a\nb\n")).toBe(2);
    expect(fileLines(Array.from({ length: 201 }, () => "x").join("\n"))).toBeGreaterThan(MAX_FILE_LINES);
  });
});
