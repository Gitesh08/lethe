// Asserts the EFFECTIVE compiler options (tsconfig.json + extended base) per 03-rules section 1.
// `skipLibCheck` is on (third-party .d.ts only; our own sources are fully checked) and is only noted.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = resolve(PKG, "tsconfig.json");
const read = ts.readConfigFile(cfgPath, (p) => ts.sys.readFile(p));
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PKG);
const o = parsed.options;

describe("effective tsconfig", () => {
  it("parses without errors", () => {
    expect(read.error).toBeUndefined();
    expect(parsed.errors).toEqual([]);
  });

  it("enables the strict flag set", () => {
    expect(o.strict).toBe(true);
    expect(o.noUncheckedIndexedAccess).toBe(true);
    expect(o.exactOptionalPropertyTypes).toBe(true);
    expect(o.noImplicitOverride).toBe(true);
  });

  it("targets ES2022 with ESM modules and no JS", () => {
    expect(o.target).toBe(ts.ScriptTarget.ES2022);
    expect([ts.ModuleKind.ESNext, ts.ModuleKind.NodeNext, ts.ModuleKind.ES2022]).toContain(o.module);
    expect(o.allowJs ?? false).toBe(false);
    expect(o.noEmit).toBe(true);
  });
});
