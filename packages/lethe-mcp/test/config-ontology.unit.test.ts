// Error matrix for config.json / ontology.json readers. Refs: Req 10.4, Req 10.5
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AXES, validateOntology } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { CONFIG_PATH, loadConfigFile } from "../src/load/config-file.js";
import { loadOntologyFile, ONTOLOGY_PATH } from "../src/load/ontology-file.js";

let root = "";
let fsx: WorkspaceFs;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-cfgo-")));
  fsx = createWorkspaceFs(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, v: unknown) => fsx.writeAtomic(rel, JSON.stringify(v));
const stance = (patterns: unknown) => ({ id: "x:a", label: "A", patterns, negationAware: true });
const axis = (patterns: unknown = ["foo"]) => ({ id: "x", description: "d", stances: [stance(patterns)] });

describe("config.json bad values", () => {
  const numericKeys = [
    "s0", "sMax", "sMin", "beta", "alpha", "wDefault", "wSpec", "specFloor",
    "hotMin", "cryptMax", "budgetTokens", "dedupeJaccard",
  ];
  it.each(numericKeys)("rejects a string for numeric key %s naming file and key", async (key) => {
    await put(CONFIG_PATH, { version: 1, [key]: "5" });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain(CONFIG_PATH);
    expect(!r.ok && r.error.message).toContain(`"${key}"`);
  });

  it("rejects a granularity outside the enum", async () => {
    await put(CONFIG_PATH, { version: 1, granularity: "paragraph" });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain('"granularity"');
  });

  it("rejects a non-array activeSpecs and non-string entries", async () => {
    for (const activeSpecs of ["a", [1]]) {
      await put(CONFIG_PATH, { version: 1, activeSpecs });
      const r = await loadConfigFile(fsx);
      expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
      expect(!r.ok && r.error.message).toContain("activeSpecs");
    }
  });

  it("rejects a missing version and a non-object root", async () => {
    for (const body of [{ s0: 3 }, [], 7]) {
      await put(CONFIG_PATH, body);
      const r = await loadConfigFile(fsx);
      expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
      expect(!r.ok && r.error.message).toContain(CONFIG_PATH);
    }
  });

  it("names the offending key from validateConfig", async () => {
    await put(CONFIG_PATH, { version: 1, budgetTokens: 1.5 });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain('"budgetTokens"');
  });
});

describe("ontology.json bad values", () => {
  it("rejects a wrong version", async () => {
    await put(ONTOLOGY_PATH, { version: 2, axes: [] });
    const r = await loadOntologyFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain(ONTOLOGY_PATH);
    expect(!r.ok && r.error.message).toContain('"version"');
  });

  it("rejects unknown keys at the root and nested", async () => {
    await put(ONTOLOGY_PATH, { version: 1, axes: [], extra: 1 });
    const root1 = await loadOntologyFile(fsx);
    expect(!root1.ok && root1.error.message).toContain('"extra"');
    await put(ONTOLOGY_PATH, { version: 1, axes: [{ ...axis(), bogus: true }] });
    const nested = await loadOntologyFile(fsx);
    expect(!nested.ok && nested.error.code).toBe("CONFIG_INVALID");
    expect(!nested.ok && nested.error.message).toContain("axes.0.bogus");
  });

  it("rejects bad types: patterns not an array, negationAware not boolean, axes not an array", async () => {
    await put(ONTOLOGY_PATH, { version: 1, axes: [axis("foo")] });
    const a = await loadOntologyFile(fsx);
    expect(!a.ok && a.error.message).toContain("axes.0.stances.0.patterns");
    await put(ONTOLOGY_PATH, { version: 1, axes: [{ ...axis(), stances: [{ ...stance(["f"]), negationAware: "yes" }] }] });
    const b = await loadOntologyFile(fsx);
    expect(!b.ok && b.error.message).toContain("axes.0.stances.0.negationAware");
    await put(ONTOLOGY_PATH, { version: 1, axes: {} });
    const c = await loadOntologyFile(fsx);
    expect(!c.ok && c.error.code).toBe("CONFIG_INVALID");
  });
});

// Regex validity is core's job (Req 10.5 yields CONFIG_INVALID only for malformed structure);
// the loader passes the merged axes on and detect/sleep surface ONTOLOGY_INVALID_PATTERN (Req 5.4).
describe("ontology.json invalid regex", () => {
  it.each([
    ["syntax error", ["(unclosed"], "Invalid regex in x/x:a"],
    ["empty match", ["a*"], "empty string"],
    ["over length cap", ["a".repeat(513)], "exceeds 512"],
  ])("loads, then core reports ONTOLOGY_INVALID_PATTERN for %s", async (_n, patterns, text) => {
    await put(ONTOLOGY_PATH, { version: 1, axes: [axis(patterns)] });
    const r = await loadOntologyFile(fsx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(DEFAULT_AXES.length + 1);
    const v = validateOntology(r.value);
    expect(!v.ok && v.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
    expect(!v.ok && v.error.message).toContain(text);
  });
});
