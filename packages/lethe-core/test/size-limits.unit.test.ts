// File-size rule from 03-rules section 3: <= 200 lines per source file.
// Function length (<= 40) is not asserted: it cannot be measured reliably without an AST.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(PKG, "src");
const MAX_LINES = 200;
// Pure data files (seeded fixture content) may exceed the limit; none do today. Named explicitly.
const DATA_FILES: ReadonlySet<string> = new Set([
  "fixtures/haunted-content-ops.ts",
  "fixtures/haunted-content-product.ts",
  "fixtures/haunted-content-rules.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("src/ file size", () => {
  it(`keeps every non-data file at or under ${MAX_LINES} lines`, () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/");
      if (DATA_FILES.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n").length;
      if (lines > MAX_LINES) offenders.push(`${rel}: ${lines} lines`);
    }
    expect(offenders).toEqual([]);
  });
});
