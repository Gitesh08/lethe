// Golden: sleepOp(apply) on the haunted repo vs core runConsolidation on the SAME inputs, then resurrect everything.
// Refs: Req 21.8, Req 8.9, REQ-CRY-3, INV-3
// Construction: materialise files + ledger + synthesised specs (local helper), write state.json = the fixture's aged
// states with a zero ledger cursor, then sleepOp(apply) at repo.nowCommit (the demo starting point).
// Core input = steering files + states read back from state.json + the full ledger + loader specs/cfg/ontology.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConsolidation, serializeTombstones, type EngramState, type SpecInvariant, type TombstoneRecord } from "@lethe/core";
import { DEMO_SEED, generateHauntedRepo } from "@lethe/core/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadStateFile } from "../src/load/state-file.js";
import { loadWorkspace } from "../src/load/workspace.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { resurrectOp } from "../src/ops/resurrect.js";
import { sleepOp } from "../src/ops/sleep.js";
import { serializeState } from "../src/persist/state-serialize.js";
import { KEY_ORDERS, stableLine } from "../src/persist/stable-json.js";

const SENTENCE: Record<string, string> = {
  "mod:esm": "THE code SHALL use ESM modules.",
  "err:result-types": "THE engine SHALL return Result types.",
  "typing:strict-ts": "THE code SHALL use strict TypeScript.",
  "state:signals": "THE UI SHALL use signals.",
  "css:pure-css": "THE UI SHALL use pure CSS.",
};
const repo = generateHauntedRepo(DEMO_SEED);
const horizon = repo; // the demo starting point: nowCommit 150 (core: 1449 hot tokens before, 1183 after, 14 buried, 3 merged)
const originals = [...repo.workspace.files].filter(([p]) => p.startsWith(".kiro/steering/"));
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
let root = "";

function specText(s: SpecInvariant): string {
  const ids = s.requirementIds.map((id) => `<!-- ${id} -->`).join(" ");
  return `# ${s.specName}\n\n${ids}\n\n${s.stances.map((x) => SENTENCE[x] ?? `UNMAPPED ${x}`).join("\n\n")}\n`;
}

async function materialise(): Promise<void> {
  const fsx = createWorkspaceFs(root);
  for (const [p, t] of repo.workspace.files) await fsx.writeAtomic(p, t);
  await fsx.writeAtomic(".kiro/lethe/ledger.jsonl", repo.ledger.map((e) => stableLine(e, KEY_ORDERS.ledgerLine)).join(""));
  for (const s of repo.specs) {
    await fsx.writeAtomic(`.kiro/specs/${s.specName}/requirements.md`, specText(s));
    await fsx.writeAtomic(`.kiro/specs/${s.specName}/tasks.md`, "- [x] 1. done\n- [ ] 2. open\n");
  }
}

async function ctxAt(commit: number, now: string): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: root, commit, now },
    { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate: stubGate("passed") },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const ids = (xs: ReadonlyArray<{ id: string }>): string[] => xs.map((x) => x.id);

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-golden-")));
  await materialise();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("sleep golden (haunted repo)", () => {
  it("matches core runConsolidation, then resurrect restores every file byte-for-byte", async () => {
    // Persist the fixture's own aged states with a zero ledger cursor: the demo's actual starting point
    // (adopt would stamp fresh S0 states and make everything decay together).
    const cur = await loadStateFile(createWorkspaceFs(root));
    if (!cur.ok) throw new Error("state load failed");
    const seeded = serializeState({ commit: repo.nowCommit, at: repo.nowISO, ledger: cur.value.cursor, engrams: repo.states });
    await createWorkspaceFs(root).writeAtomic(".kiro/lethe/state.json", seeded);

    // Core input from the SAME persisted inputs the op will read.
    const fsx = createWorkspaceFs(root);
    const loaded = await loadWorkspace(fsx, { includeSpecs: true, needTombstones: true });
    const st = await loadStateFile(fsx);
    if (!loaded.ok || !st.ok) throw new Error("load failed");
    expect(loaded.value.ledger.events).toEqual(repo.ledger);
    const states: EngramState[] = [...st.value.states];
    const core = runConsolidation({
      workspace: { files: loaded.value.steeringFiles, tombstones: [] },
      states, specs: loaded.value.specs, ledger: loaded.value.ledger.events,
      nowCommit: horizon.nowCommit, nowISO: horizon.nowISO, cfg: loaded.value.cfg, ontology: loaded.value.ontology,
    });
    if (!core.ok) throw new Error(core.error.message);
    const { plan, applied } = core.value;

    const sleep = await sleepOp(await ctxAt(horizon.nowCommit, horizon.nowISO), { apply: true, skipGate: false, gateRuns: 20 });
    if (!sleep.ok) throw new Error(sleep.error.message);
    const d = sleep.value;
    expect(d.applied).toBe(true);

    const buried = new Set(ids(applied.tombstones));
    expect(ids(d.archived)).toEqual(ids(applied.tombstones.filter((t) => t.reason !== "duplicate")));
    expect(d.merged).toEqual(plan.toMerge.filter((m) => buried.has(m.drop.node.id)).map((m) => ({ keep: m.keep.node.id, drop: m.drop.node.id })));
    expect(d.demoted).toEqual(plan.toDemote);
    expect([d.tokensBefore, d.tokensAfter, d.budgetStatus]).toEqual([plan.tokensBefore, plan.tokensAfter, plan.budgetStatus]);
    for (const [p, text] of applied.workspace.files) expect(read(p)).toBe(text);
    expect(read(".kiro/crypt/tombstones.json")).toBe(serializeTombstones(applied.workspace.tombstones));
    console.error(`golden: archived=${d.archived.length} merged=${d.merged.length} demoted=${d.demoted.length} tokens ${d.tokensBefore}->${d.tokensAfter} (${d.budgetStatus}); tombstones=${applied.tombstones.length}`);
    expect([d.tokensBefore, d.tokensAfter, d.archived.length, d.merged.length]).toEqual([1449, 1183, 11, 3]);

    // Resurrect every tombstone (archived + merged duplicates), exact id, one at a time.
    // Ascending original position per file, so each neighbour is back before the rule that follows it.
    const tombs: TombstoneRecord[] = [...applied.tombstones].sort(
      (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.position.index - b.position.index),
    );
    for (const t of tombs) {
      const r = await resurrectOp(await ctxAt(horizon.nowCommit + 1, horizon.nowISO), { query: t.id, apply: true });
      if (!r.ok) throw new Error(`resurrect ${t.id}: ${r.error.message}`);
      expect(ids(r.value.matches)).toEqual([t.id]);
    }
    for (const [p, text] of originals) expect(read(p)).toBe(text);
    expect(JSON.parse(read(".kiro/crypt/tombstones.json")).tombstones).toEqual([]);
  }, 60_000);
});
