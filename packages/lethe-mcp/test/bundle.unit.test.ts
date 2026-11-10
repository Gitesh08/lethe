// Bundle drift, hygiene, network scan and lazy gate. Refs: Req 18.1-18.7, REQ-HOK-4
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBundle } from "../scripts/build.mjs";
import {
  DRIVE_PATH,
  NETWORK_PATTERN,
  firstDifferingLine,
  moduleByLine,
  scanBundle,
} from "./support/bundle-scan.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committedRaw = readFileSync(resolve(root, "dist", "lethe.mjs"), "utf8");
const committed = committedRaw.replace(/\r\n/g, "\n");

/** Modules allowed to mention network APIs (none today; SDK transports would be listed here). */
const ALLOWED_NETWORK_MODULES: readonly string[] = [];

describe("bundle drift", () => {
  let built = "";
  beforeAll(async () => {
    built = (await buildBundle({ write: false })).text.replace(/\r\n/g, "\n");
  }, 60_000);

  it("committed dist/lethe.mjs equals a fresh in-memory build", () => {
    const same = built === committed;
    if (!same) throw new Error(`bundle drift at ${firstDifferingLine(built, committed)}`);
    expect(same).toBe(true);
  });
});

describe("bundle hygiene", () => {
  it("has no machine-specific paths or source maps", () => {
    expect(DRIVE_PATH.exec(committed)?.[0]).toBeUndefined();
    expect(committed).not.toContain("/Users/");
    expect(committed).not.toContain("/home/");
    expect(committed).not.toContain("sourceMappingURL");
  });

  it("drive-path guard is not toothless and ignores regex escapes", () => {
    expect(DRIVE_PATH.test("const p = 'C:\\\\Users\\\\x';")).toBe(true);
    expect(DRIVE_PATH.test("// D:\\Projects\\x")).toBe(true);
    expect(DRIVE_PATH.test('"\\\\bstrict:\\\\s*true\\\\b"')).toBe(false);
    expect(DRIVE_PATH.test('"\\\\bstrict:\\\\s*true\\\\b"'.replace("strict", "x"))).toBe(false);
  });

  it("starts with the shebang and contains no CR", () => {
    expect(committedRaw.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(committedRaw).not.toContain("\r");
  });

  it("package.json declares engines.node >=22 and bin.lethe dist/lethe.mjs", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      engines?: { node?: string };
      bin?: { lethe?: string };
    };
    expect(pkg.engines?.node).toBe(">=22");
    expect(pkg.bin?.lethe).toBe("dist/lethe.mjs");
  });
});

describe("bundle network scan", () => {
  it("scanner flags real network use but not regex group syntax", () => {
    expect(NETWORK_PATTERN.test('await fetch("x")')).toBe(true);
    expect(NETWORK_PATTERN.test('import "node:https"')).toBe(true);
    expect(NETWORK_PATTERN.test("http.request(o)")).toBe(true);
    expect(NETWORK_PATTERN.test('"\\\\bfetch(?:ing)?\\\\b"')).toBe(false);
  });

  it("product code (src/, lethe-core) never uses network APIs; others must be allow-listed", () => {
    const hits = scanBundle(committed, NETWORK_PATTERN);
    const product = hits.filter((h) => /(^|\/)src\//.test(h.module) && !h.module.includes("node_modules"));
    expect(product, JSON.stringify(product)).toEqual([]);
    const core = hits.filter((h) => h.module.includes("lethe-core"));
    expect(core, JSON.stringify(core)).toEqual([]);
    const unlisted = hits.filter((h) => !ALLOWED_NETWORK_MODULES.includes(h.module));
    expect(unlisted, JSON.stringify(unlisted)).toEqual([]);
  });
});

describe("bundle lazy gate", () => {
  // Wording note: the task says "single call site"; gate.ts legitimately has two
  // (loadPbtFailureCore, defaultGateRunner), so every call site must be inside those.
  it("init_properties() is only called inside the two gate functions", () => {
    const lines = committed.split("\n");
    const calls = lines.map((l, i) => ({ l, i })).filter(({ l }) => /\binit_properties\(\)/.test(l));
    expect(calls.length).toBe(2);
    for (const { l, i } of calls) {
      expect(l.startsWith(" "), `top-level call at line ${i + 1}`).toBe(true);
      let j = i;
      while (j > 0 && /^[\s}]/.test(lines[j] ?? "")) j--;
      const header = lines[j] ?? "";
      expect(
        /^async function loadPbtFailureCore\b|^var defaultGateRunner = async\b/.test(header),
        `call at line ${i + 1} enclosed by: ${header}`,
      ).toBe(true);
    }
  });

  it("no module-top-level initialiser runs for fast-check or pure-rand", () => {
    const lines = committed.split("\n");
    const owners = moduleByLine(lines);
    const bad = lines
      .map((l, i) => ({ l, m: owners[i] ?? "", i }))
      .filter(({ l, m }) => /^init_\w+\(\);?$/.test(l) && /node_modules\/(fast-check|pure-rand)\//.test(m));
    expect(bad).toEqual([]);
    const props = lines.findIndex((l) => /^init_properties\(\)/.test(l));
    expect(props).toBe(-1);
  });
});
