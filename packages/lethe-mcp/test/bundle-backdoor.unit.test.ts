// The shipped bundle must contain no fault-injection backdoor. Refs: Req 22.3, Rules-0.5, NFR-2
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { moduleByLine } from "./support/bundle-scan.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = readFileSync(resolve(root, "dist", "lethe.mjs"), "utf8").replace(/\r\n/g, "\n");

interface EnvRead {
  readonly name: string; // "<dynamic>" when the key is not a literal
  readonly line: number;
  readonly module: string;
}

const ENV_OBJ = String.raw`(?:process|Bun|Deno)\.env`;
const ENV_DOT = new RegExp(String.raw`\b${ENV_OBJ}\.(?!get\b)([A-Za-z_$][\w$]*)`, "g");
const ENV_BRACKET = new RegExp(String.raw`\b${ENV_OBJ}\[\s*(["'\x60])([^"'\x60]*)\1\s*\]`, "g");
const ENV_BRACKET_DYN = new RegExp(String.raw`\b${ENV_OBJ}\[\s*(?!["'\x60])`, "g");
const ENV_GET = new RegExp(String.raw`\b${ENV_OBJ}\.get\(\s*(["'\x60])([^"'\x60]*)\1`, "g");
const ENV_DESTRUCT = new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${ENV_OBJ}\b`, "g");

/** The env object passed around whole (e.g. `source = process.env`); individual keys are not visible. */
const ENV_WHOLE = new RegExp(String.raw`\b${ENV_OBJ}(?![\w$.\[])`, "g");

const SUSPECT = /^LETHE_|FAULT|INJECT|CRASH/i;

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Every environment read found in `text`, attributed to esbuild module comments. */
export function findEnvReads(text: string): EnvRead[] {
  const owners = moduleByLine(text.split("\n"));
  const out: EnvRead[] = [];
  const push = (name: string, index: number): void => {
    const line = lineAt(text, index);
    out.push({ name, line, module: owners[line - 1] ?? "<unknown>" });
  };
  for (const m of text.matchAll(ENV_DOT)) if (m[1] !== undefined) push(m[1], m.index);
  for (const m of text.matchAll(ENV_BRACKET)) if (m[2] !== undefined) push(m[2], m.index);
  for (const m of text.matchAll(ENV_GET)) if (m[2] !== undefined) push(m[2], m.index);
  for (const m of text.matchAll(ENV_BRACKET_DYN)) push("<dynamic>", m.index);
  for (const m of text.matchAll(ENV_WHOLE)) push("<whole-object>", m.index);
  for (const m of text.matchAll(ENV_DESTRUCT)) {
    for (const part of (m[1] ?? "").split(",")) {
      const key = /^\s*(?:\.\.\.)?\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))/.exec(part);
      const name = key?.[1] ?? key?.[2];
      if (name !== undefined) push(name, m.index);
    }
  }
  return out.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

export function suspectEnvReads(text: string): EnvRead[] {
  return findEnvReads(text).filter((r) => SUSPECT.test(r.name));
}

/** Distinctive identifiers and message literals from test/helpers/faulty-fs.ts, plus a fixed list. */
function forbiddenStrings(): string[] {
  const file = resolve(root, "test", "helpers", "faulty-fs.ts");
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found = new Set<string>(["createFaultyFs", "faulty-fs", "failFrom", "Injected write failure"]);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && /\s/.test(node.text)) found.add(node.text.replace(/\.$/, ""));
    if (ts.isInterfaceDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (exported && node.name !== undefined) found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].sort();
}

describe("bundle has no fault-injection backdoor", () => {
  const reads = findEnvReads(bundle);

  it("lists every process.env read for the record", () => {
    const table = reads.map((r) => `  ${r.name}  (line ${r.line}, ${r.module})`);
    console.warn(`bundle env reads (${reads.length}):\n${table.join("\n") || "  (none)"}`);
    expect(Array.isArray(reads)).toBe(true);
  });

  it("reads no LETHE_*, FAULT, INJECT or CRASH environment variable", () => {
    const bad = suspectEnvReads(bundle).map((r) => `${r.name} @ line ${r.line} (${r.module})`);
    expect(bad).toEqual([]);
  });

  it("contains none of the strings used by test/helpers/faulty-fs.ts", () => {
    const needles = forbiddenStrings();
    expect(needles).toContain("Injected write failure");
    expect(needles).toContain("createFaultyFs");
    const lines = bundle.split("\n");
    const owners = moduleByLine(lines);
    const hits: string[] = [];
    for (const needle of needles) {
      lines.forEach((l, i) => {
        if (l.includes(needle)) hits.push(`${JSON.stringify(needle)} @ line ${i + 1} (${owners[i] ?? "?"})`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("scanner bites on synthetic backdoor snippets", () => {
    const names = (s: string): string[] => suspectEnvReads(s).map((r) => r.name);
    expect(names("if (process.env.LETHE_FAULT) x();")).toEqual(["LETHE_FAULT"]);
    expect(names('const n = process.env["CRASH_AT"];')).toEqual(["CRASH_AT"]);
    expect(names("const n = process.env['inject_at'];")).toEqual(["inject_at"]);
    expect(names("const { INJECT_IO } = process.env;")).toEqual(["INJECT_IO"]);
    expect(names("const { A, FAULT_X: f, ...rest } = process.env;")).toEqual(["FAULT_X"]);
    expect(names('Bun.env.LETHE_X; Deno.env.get("CRASH_NOW");')).toEqual(["CRASH_NOW", "LETHE_X"]);
    expect(names("process.env.NODE_ENV; process.env.HOME")).toEqual([]);
    expect(findEnvReads("process.env[key]").map((r) => r.name)).toEqual(["<dynamic>"]);
  });
});
