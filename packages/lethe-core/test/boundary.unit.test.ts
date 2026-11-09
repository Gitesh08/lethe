// Dependency-boundary + purity enforcement for @lethe/core (the engine entry point must stay pure).
// Refs: REQ-CORE-PURE (requirement 6.3 / 6.8), INV-7
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src");
const PROPS = join(SRC, "properties") + sep;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface Imp {
  readonly spec: string;
  readonly line: number;
}

/** Value imports/exports-from/dynamic imports; `import type` and `export type` are ignored. */
function importsOf(text: string): Imp[] {
  const found: Imp[] = [];
  const re = /\b(?:import|export)\s+(type\s+)?(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) continue;
    const spec = m[2] ?? m[3];
    if (spec === undefined) continue;
    found.push({ spec, line: text.slice(0, m.index).split("\n").length });
  }
  return found;
}

function resolveRel(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  return base.endsWith(".js") ? `${base.slice(0, -3)}.ts` : base.endsWith(".ts") ? base : `${base}.ts`;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/** Blank out comments and string/template contents, preserving newlines (crude, no regex literals). */
function stripCommentsAndStrings(text: string): string {
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

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["Date.now", /\bDate\.now\b/],
  ["new Date()", /\bnew\s+Date\(\s*\)/],
  ["Math.random", /\bMath\.random\b/],
  ["console.", /\bconsole\./],
  ["process.", /\bprocess\./],
  ["require(", /\brequire\(/],
  ["eval(", /\beval\(/],
  [": any", /:\s*any\b/],
  ["as any", /\bas\s+any\b/],
];

function graphProblems(entry: string): { problems: string[]; size: number } {
  const seen = new Set<string>();
  const queue = [entry];
  const problems: string[] = [];
  while (queue.length > 0) {
    const file = queue.pop() ?? entry;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(PKG, file);
    if (file.startsWith(PROPS)) problems.push(`${rel}: reaches src/properties/`);
    for (const imp of importsOf(read(file))) {
      if (!imp.spec.startsWith(".")) {
        problems.push(`${rel}:${imp.line}: non-relative import "${imp.spec}"`);
      } else {
        queue.push(resolveRel(file, imp.spec));
      }
    }
  }
  return { problems, size: seen.size };
}

describe("engine import graph (from src/index.ts)", () => {
  it("never reaches fast-check, vitest, node: modules or src/properties/", () => {
    const { problems, size } = graphProblems(join(SRC, "index.ts"));
    expect(problems).toEqual([]);
    expect(size).toBeGreaterThan(20);
  });
});

describe("fixtures import graph (from src/fixtures/index.ts)", () => {
  it("never reaches fast-check, vitest, node: modules or src/properties/", () => {
    const { problems, size } = graphProblems(join(SRC, "fixtures", "index.ts"));
    expect(problems).toEqual([]);
    expect(size).toBeGreaterThan(10);
  });
});

describe("src/ never imports from test/", () => {
  it("has no relative import escaping src/ or naming test/", () => {
    const problems: string[] = [];
    for (const file of walkTs(SRC)) {
      for (const imp of importsOf(read(file))) {
        if (!imp.spec.startsWith(".")) continue;
        const target = resolveRel(file, imp.spec);
        if (!target.startsWith(SRC + sep) || /(^|[\\/])test[\\/]/.test(imp.spec)) {
          problems.push(`${relative(PKG, file)}:${imp.line}: ${imp.spec}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("package.json", () => {
  const pkg = JSON.parse(read(join(PKG, "package.json"))) as Record<string, unknown>;

  it("has no runtime dependencies", () => {
    const deps = pkg["dependencies"];
    expect(deps === undefined || Object.keys(deps as object).length === 0).toBe(true);
  });

  it("lists fast-check only as an optional peer, pinned like the devDependency", () => {
    const peers = pkg["peerDependencies"] as Record<string, string>;
    const dev = pkg["devDependencies"] as Record<string, string>;
    expect(Object.keys(peers)).toEqual(["fast-check"]);
    expect(peers["fast-check"]).toBe(dev["fast-check"]);
    expect(pkg["peerDependenciesMeta"]).toEqual({ "fast-check": { optional: true } });
  });

  it("exposes the engine, ./properties and ./fixtures entry points", () => {
    const exp = pkg["exports"] as Record<string, string>;
    expect(exp["."]).toBe("./src/index.ts");
    expect(exp["./properties"]).toBe("./src/properties/index.ts");
    expect(exp["./fixtures"]).toBe("./src/fixtures/index.ts");
    expect(Object.keys(exp).sort()).toEqual([".", "./fixtures", "./properties"]);
  });
});

describe("src/ purity scan", () => {
  it("contains no forbidden constructs outside comments and strings", () => {
    const hits: string[] = [];
    for (const file of walkTs(SRC)) {
      const raw = read(file);
      const lines = stripCommentsAndStrings(raw).split("\n");
      lines.forEach((text, idx) => {
        for (const [label, re] of FORBIDDEN) {
          if (re.test(text)) hits.push(`${relative(PKG, file)}:${idx + 1}: ${label}`);
        }
      });
      raw.split("\n").forEach((text, idx) => {
        if (/@ts-ignore/.test(text)) hits.push(`${relative(PKG, file)}:${idx + 1}: @ts-ignore`);
      });
    }
    expect(hits).toEqual([]);
  });
});
