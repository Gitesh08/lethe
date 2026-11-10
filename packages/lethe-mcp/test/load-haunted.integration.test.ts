// Integration: loadWorkspace over a materialised haunted repo. Refs: Req 10.1, Req 21.8
// Fixture-native: steering files, ledger events, SpecInvariants. Synthesised here: ledger.jsonl bytes
// (stableLine) and .kiro/specs/<name>/{requirements,tasks}.md, because the fixture ships specs as values only.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDocument, type EngramNode, type SpecInvariant } from "@lethe/core";
import { DEMO_SEED, generateHauntedRepo } from "@lethe/core/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFs, type WorkspaceFs } from "../src/io/workspace-fs.js";
import { loadWorkspace } from "../src/load/workspace.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";

// Stance id -> a SHALL sentence the default ontology maps back to that stance.
const SENTENCE: Record<string, string> = {
  "mod:esm": "THE code SHALL use ESM modules.",
  "err:result-types": "THE engine SHALL return Result types.",
  "typing:strict-ts": "THE code SHALL use strict TypeScript.",
  "state:signals": "THE UI SHALL use signals.",
  "css:pure-css": "THE UI SHALL use pure CSS.",
};

const repo = generateHauntedRepo(DEMO_SEED);
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function requirementsFor(spec: SpecInvariant): string {
  const stanceLines = spec.stances.map((s) => SENTENCE[s] ?? `UNMAPPED ${s}`);
  const ids = spec.requirementIds.map((id) => `<!-- ${id} -->`).join(" ");
  return `# ${spec.specName}\n\n${ids}\n\n${stanceLines.join("\n\n")}\n`;
}

async function materialise(fsx: WorkspaceFs): Promise<void> {
  for (const [path, text] of repo.workspace.files) await fsx.writeAtomic(path, text);
  const ledger = repo.ledger.map((e) => stableLine(e, KEY_ORDERS.ledgerLine)).join("");
  await fsx.writeAtomic(".kiro/lethe/ledger.jsonl", ledger);
  for (const spec of repo.specs) {
    await fsx.writeAtomic(`.kiro/specs/${spec.specName}/requirements.md`, requirementsFor(spec));
    await fsx.writeAtomic(`.kiro/specs/${spec.specName}/tasks.md`, "- [x] 1. done\n- [ ] 2. open\n");
  }
}

// The fixture exposes files, not engrams: expected engrams come from core parseDocument over its files.
function expectedEngrams(): EngramNode[] {
  const out: EngramNode[] = [];
  for (const path of [...repo.workspace.files.keys()].sort(byCodeUnits)) {
    if (!path.startsWith(".kiro/steering/")) continue;
    const parsed = parseDocument(path, repo.workspace.files.get(path) ?? "", repo.cfg);
    if (!parsed.ok) throw new Error(`fixture file ${path} does not parse`);
    out.push(...parsed.value.engrams);
  }
  return out;
}

const norm = (s: SpecInvariant) => ({
  specName: s.specName,
  active: s.active,
  requirementIds: [...s.requirementIds].sort(byCodeUnits),
  stances: [...s.stances].sort(byCodeUnits),
});

let root = "";
let fsx: WorkspaceFs;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-haunted-")));
  fsx = createWorkspaceFs(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("loadWorkspace over the haunted repo", () => {
  it("yields the fixture's engrams, specs and ledger", async () => {
    await materialise(fsx);
    const r = await loadWorkspace(fsx, { includeSpecs: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const want = expectedEngrams();
    expect(want.length).toBeGreaterThan(40);
    expect(r.value.engrams.map((e) => [e.id, e.file, e.body, e.contentHash])).toEqual(
      want.map((e) => [e.id, e.file, e.body, e.contentHash]),
    );
    expect([...r.value.steeringFiles]).toEqual(
      [...repo.workspace.files].filter(([p]) => p.startsWith(".kiro/steering/")).sort((a, b) => byCodeUnits(a[0], b[0])),
    );
    expect(r.value.specs.map(norm)).toEqual([...repo.specs].sort((a, b) => byCodeUnits(a.specName, b.specName)).map(norm));
    expect(r.value.ledger.events).toEqual(repo.ledger);
    expect(r.value.ledger.rewritten).toBe(false);
    expect(r.value.diagnostics).toEqual([]);
    expect(r.value.anySteeringSkipped).toBe(false);
    expect(r.value.neverRewrite).toEqual([]);
  });

  it("two loads are deep-equal (with and without spec engrams)", async () => {
    await materialise(fsx);
    for (const includeSpecs of [false, true]) {
      const a = await loadWorkspace(fsx, { includeSpecs, needTombstones: true });
      const b = await loadWorkspace(fsx, { includeSpecs, needTombstones: true });
      expect(a.ok && b.ok).toBe(true);
      expect(b).toEqual(a);
    }
  });
});
