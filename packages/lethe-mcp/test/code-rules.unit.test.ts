// Function size and complexity rules (03-rules section 3) over lethe-mcp src/**/*.ts.
// Counting rules are documented in test/support/source-files.ts.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  complexityOf, fnName, isFnLike, lineOf, loadSources, visit,
} from "./support/source-files.js";

const MAX_FN_LINES = 40;
const MAX_COMPLEXITY = 10;
// "file:name" -> reason. Keep minimal.
const ALLOW: ReadonlyMap<string, string> = new Map<string, string>([]);

interface Finding {
  readonly key: string;
  readonly lines: number;
  readonly complexity: number;
}

/** Every function-like in `sf`, with its measured size and complexity. */
function measure(rel: string, sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  visit(sf, (n) => {
    if (!isFnLike(n) || n.body === undefined) return;
    out.push({
      key: `${rel}:${fnName(n)}`,
      lines: lineOf(sf, n.body.getEnd()) - lineOf(sf, n.body.getStart()) + 1,
      complexity: complexityOf(n),
    });
  });
  return out;
}

const overLimit = (f: Finding): boolean => f.lines > MAX_FN_LINES || f.complexity > MAX_COMPLEXITY;

function fixtureSource(): string {
  const body = Array.from({ length: 39 }, (_, i) => `  const v${i} = ${i};`).join("\n");
  const branches = Array.from({ length: 10 }, (_, i) => `  if (x === ${i}) return ${i};`).join("\n");
  return [
    `export function tooLong(): number {`, body, `  return 0;`, `}`,
    `export function tooComplex(x: number): number {`, branches, `  return -1;`, `}`,
    `export const ok = (): number => 1;`,
  ].join("\n");
}

describe("function size and complexity", () => {
  const files = loadSources();
  const real = files.flatMap(({ rel, sf }) => measure(rel, sf));

  it(`keeps every src function body <= ${MAX_FN_LINES} lines and complexity <= ${MAX_COMPLEXITY}`, () => {
    const bad: string[] = [];
    const allowed: string[] = [];
    for (const f of real.filter(overLimit)) {
      const msg = `${f.key} lines=${f.lines} complexity=${f.complexity}`;
      if (ALLOW.has(f.key)) allowed.push(`${msg} (${ALLOW.get(f.key)})`);
      else bad.push(msg);
    }
    if (allowed.length > 0) console.info(`allow-listed: ${allowed.join("; ")}`);
    expect(bad).toEqual([]);
  });

  it("scanner detects oversized and over-complex functions (never vacuous)", () => {
    // Exercised on an inline fixture so the check holds even while src has no functions.
    const sf = ts.createSourceFile("fixture.ts", fixtureSource(), ts.ScriptTarget.ES2022, true);
    const found = measure("fixture.ts", sf);
    expect(found.map((f) => f.key)).toEqual([
      "fixture.ts:tooLong", "fixture.ts:tooComplex", "fixture.ts:ok",
    ]);
    const flagged = found.filter(overLimit).map((f) => f.key);
    expect(flagged).toEqual(["fixture.ts:tooLong", "fixture.ts:tooComplex"]);
    expect(found[0]?.lines).toBeGreaterThan(MAX_FN_LINES);
    expect(found[1]?.complexity).toBe(11);
  });

  it("scans at least one source file", () => {
    expect(files.length).toBeGreaterThan(0);
  });
});
