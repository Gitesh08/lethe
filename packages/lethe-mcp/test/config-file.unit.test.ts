// Basic loader tests for config.json and ontology.json. Refs: Req 10.4, Req 10.5
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AXES, DEFAULT_CONFIG } from "@lethe/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { loadConfigFile } from "../src/load/config-file.js";
import { loadOntologyFile } from "../src/load/ontology-file.js";

let root = "";
let fsx: WorkspaceFs;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-cfg-")));
  fsx = createWorkspaceFs(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, v: unknown) => fsx.writeAtomic(rel, typeof v === "string" ? v : JSON.stringify(v));
const CFG = ".kiro/lethe/config.json";

describe("loadConfigFile", () => {
  it("returns defaults when the file is absent", async () => {
    const r = await loadConfigFile(fsx);
    expect(r.ok && r.value).toEqual({ config: DEFAULT_CONFIG, activeSpecs: undefined });
  });

  it("merges overrides over defaults and returns activeSpecs", async () => {
    await put(CFG, { version: 1, budgetTokens: 1000, granularity: "bullet", activeSpecs: ["a"] });
    const r = await loadConfigFile(fsx);
    expect(r.ok && r.value.config).toEqual({ ...DEFAULT_CONFIG, budgetTokens: 1000, granularity: "bullet" });
    expect(r.ok && r.value.activeSpecs).toEqual(["a"]);
  });

  it("rejects unknown keys naming file and key", async () => {
    await put(CFG, { version: 1, bogus: 1 });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain(CFG);
    expect(!r.ok && r.error.message).toContain("bogus");
  });

  it("rejects a wrong version", async () => {
    await put(CFG, { version: 2 });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain('"version"');
  });

  it("rejects out-of-range values via validateConfig and malformed JSON", async () => {
    await put(CFG, { version: 1, hotMin: 0.1, cryptMax: 0.5 });
    const r = await loadConfigFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain(CFG);
    await put(CFG, "{nope");
    const bad = await loadConfigFile(fsx);
    expect(!bad.ok && bad.error.code).toBe("CONFIG_INVALID");
  });
});

describe("loadOntologyFile", () => {
  const ONT = ".kiro/lethe/ontology.json";

  it("returns default axes when absent", async () => {
    const r = await loadOntologyFile(fsx);
    expect(r.ok && r.value).toEqual(DEFAULT_AXES);
  });

  it("appends a user axis", async () => {
    const axes = [{ id: "x", description: "d", stances: [{ id: "x:a", label: "A", patterns: ["foo"], negationAware: true }] }];
    await put(ONT, { version: 1, axes });
    const r = await loadOntologyFile(fsx);
    expect(r.ok && r.value.length).toBe(DEFAULT_AXES.length + 1);
  });

  it("rejects malformed structure naming file and key", async () => {
    await put(ONT, { version: 1, axes: [{ id: "x", description: "d", stances: [{ id: "s" }] }] });
    const r = await loadOntologyFile(fsx);
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
    expect(!r.ok && r.error.message).toContain(ONT);
    expect(!r.ok && r.error.message).toContain("axes.0.stances.0");
  });
});
