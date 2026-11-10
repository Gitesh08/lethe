// Unit tests for load/workspace.ts. Refs: Req 10.1, Req 2.4
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { loadWorkspace } from "../src/load/workspace.js";

let root = "";
let fsx: WorkspaceFs;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-ws-")));
  fsx = createWorkspaceFs(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, text: string) => fsx.writeAtomic(rel, text);
const seed = async () => {
  await put(".kiro/steering/b.md", "## B\n\nUse pure CSS.\n");
  await put(".kiro/steering/a.md", "## A\n\nUse ESM modules.\n");
  await put(".kiro/specs/s1/requirements.md", "## R\n\nThe code SHALL use ESM modules. <!-- REQ-X-1 -->\n");
  await put(".kiro/specs/s1/tasks.md", "- [ ] 1. todo\n");
};

describe("loadWorkspace", () => {
  it("returns defaults for a workspace without .kiro/lethe", async () => {
    await seed();
    const r = await loadWorkspace(fsx, { includeSpecs: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.cfg.budgetTokens).toBe(4000);
    expect(r.value.persisted.states).toEqual([]);
    expect(r.value.ledger.events).toEqual([]);
    expect(r.value.tombstones).toBeUndefined();
    expect(r.value.engrams.map((e) => e.file)).toEqual([".kiro/steering/a.md", ".kiro/steering/b.md"]);
  });

  it("includeSpecs controls spec engrams only; specs are always derived", async () => {
    await seed();
    const off = await loadWorkspace(fsx, { includeSpecs: false });
    const on = await loadWorkspace(fsx, { includeSpecs: true });
    if (!off.ok || !on.ok) throw new Error("load failed");
    expect(off.value.specEngrams).toEqual([]);
    expect(on.value.specEngrams.length).toBeGreaterThan(0);
    expect(off.value.specs).toEqual(on.value.specs);
    expect(off.value.specs[0]?.specName).toBe("s1");
    expect(off.value.specs[0]?.active).toBe(true);
    expect(off.value.specs[0]?.stances.length).toBeGreaterThan(0);
    expect(off.value.engrams).toEqual(on.value.engrams);
  });

  it("drops spec parse diagnostics when specs are not included", async () => {
    mkdirSync(join(root, ".kiro", "specs", "s1"), { recursive: true });
    writeFileSync(join(root, ".kiro", "specs", "s1", "tasks.md"), new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    const off = await loadWorkspace(fsx, { includeSpecs: false });
    const on = await loadWorkspace(fsx, { includeSpecs: true });
    if (!off.ok || !on.ok) throw new Error("load failed");
    expect(off.value.parseDiagnostics).toEqual([]);
    expect(on.value.parseDiagnostics.map((d) => d.file)).toEqual([".kiro/specs/s1/tasks.md"]);
  });

  it("loads tombstones only when requested", async () => {
    await put(".kiro/crypt/tombstones.json", JSON.stringify({ version: 1, tombstones: [] }));
    const without = await loadWorkspace(fsx, { includeSpecs: false });
    const withT = await loadWorkspace(fsx, { includeSpecs: false, needTombstones: true });
    if (!without.ok || !withT.ok) throw new Error("load failed");
    expect(without.value.tombstones).toBeUndefined();
    expect(withT.value.tombstones).toEqual([]);
  });

  it("propagates a bad config as CONFIG_INVALID", async () => {
    await put(".kiro/lethe/config.json", JSON.stringify({ version: 1, s0: "x" }));
    const r = await loadWorkspace(fsx, { includeSpecs: true });
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
  });

  it("maps an invalid ontology regex to ONTOLOGY_INVALID_PATTERN", async () => {
    const stance = { id: "x:a", label: "A", patterns: ["("], negationAware: false };
    await put(".kiro/lethe/ontology.json", JSON.stringify({ version: 1, axes: [{ id: "x", description: "d", stances: [stance] }] }));
    const r = await loadWorkspace(fsx, { includeSpecs: false });
    expect(!r.ok && r.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
  });

  it("returns CONFIG_INVALID for malformed tombstones only when requested", async () => {
    await put(".kiro/crypt/tombstones.json", "{nope");
    expect((await loadWorkspace(fsx, { includeSpecs: false })).ok).toBe(true);
    const r = await loadWorkspace(fsx, { includeSpecs: false, needTombstones: true });
    expect(!r.ok && r.error.code).toBe("CONFIG_INVALID");
  });

  it("is deterministic across loads", async () => {
    await seed();
    const a = await loadWorkspace(fsx, { includeSpecs: true });
    const b = await loadWorkspace(fsx, { includeSpecs: true });
    expect(a).toEqual(b);
  });
});
