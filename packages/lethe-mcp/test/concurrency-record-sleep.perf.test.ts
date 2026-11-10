// Many `record` processes while a `sleep --apply` process runs (task 13.3). Refs: Req 9.6, 12.6, 23.2, 23.4
// Scenario (x3, fresh workspaces): fixture states with a zero cursor, `sleep --apply` is started, then 12
// `record --type task_passed` processes are spawned without waiting. Records that miss the 1000 ms lock budget
// degrade to STATE_NOT_UPDATED (exit 0) but still append their event.
// Assertions on the concurrent workspace: every ledger line is whole and parses; line count = initial + 12;
// state.json loads and its cursor is accepted by the ledger reader (no LEDGER_REWRITTEN); and the final score
// equals the oracle's.
// Oracle: a second fresh workspace where the SAME commands ran sequentially (sleep first, then the 12 records one
// by one). All records share one commit/now and each touches disjoint-or-identical files, so the end state is
// independent of interleaving iff every event is counted exactly once (no double fold, none lost). A double fold
// would raise `reinforcements`, a lost one would lower it. Compared per engram: state + retention + tier.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadStateFile } from "../src/load/state-file.js";
import { parseLedger, LEDGER_REL } from "../src/load/ledger-file.js";
import { serializeState } from "../src/persist/state-serialize.js";
import { spawnCli, type SpawnResult } from "./helpers/spawn-cli.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(PKG, "dist", "lethe.mjs");
const RECORDS = 12;
const FILE_SETS = [
  "apps/web/components/Canvas.tsx,apps/web/styles/tokens.css",
  "packages/lethe-core/src/decay/score.ts",
  "packages/lethe-mcp/src/server.ts,packages/lethe-mcp/src/io/atomic-write.ts",
];
const roots: string[] = [];

async function freshWorkspace(): Promise<{ root: string; initialLines: number; commit: number; now: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-rec-sleep-")));
  roots.push(root);
  const repo = await materialiseHaunted(root);
  const seeded = serializeState({
    commit: repo.nowCommit, at: repo.nowISO, ledger: { lines: 0, bytes: 0, lastLineSha256: null }, engrams: repo.states,
  });
  const w = await createWorkspaceFs(root).writeAtomic(".kiro/lethe/state.json", seeded);
  if (!w.ok) throw new Error(w.error.message);
  return { root, initialLines: repo.ledger.length, commit: repo.nowCommit, now: repo.nowISO };
}

const base = (root: string, commit: number, now: string): string[] => ["--workspace", root, "--commit", String(commit), "--now", now, "--json"];
const recordArgs = (root: string, commit: number, now: string, i: number): string[] =>
  ["record", ...base(root, commit, now), "--type", "task_passed", "--files", FILE_SETS[i % FILE_SETS.length] ?? ""];

async function scoreOf(root: string, commit: number, now: string): Promise<unknown> {
  const r = await spawnCli(BUNDLE, ["score", ...base(root, commit, now)], root);
  expect(r.code, r.stderr).toBe(0);
  const env = JSON.parse(r.stdout) as { ok: boolean; data: { engrams: ReadonlyArray<{ node: { id: string }; state: unknown; retention: number; tier: string }> } };
  expect(env.ok).toBe(true);
  return env.data.engrams.map((e) => ({ id: e.node.id, state: e.state, retention: e.retention, tier: e.tier }));
}

afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

describe("record processes during sleep --apply", () => {
  it.each([1, 2, 3])("run %i: no event lost or double-counted", async () => {
    const a = await freshWorkspace();
    const sleeping = spawnCli(BUNDLE, ["sleep", ...base(a.root, a.commit, a.now), "--apply"], a.root, 90_000);
    const recs: Promise<SpawnResult>[] = [];
    // Staggered start (0..~3.3 s) so some records meet the held lock and later ones may fold into the checkpoint.
    for (let i = 0; i < RECORDS; i++) {
      recs.push(delay(i * 300).then(() => spawnCli(BUNDLE, recordArgs(a.root, a.commit, a.now, i), a.root, 90_000)));
    }
    const [sleepRes, ...recRes] = await Promise.all([sleeping, ...recs]);
    expect(sleepRes?.code, sleepRes?.stderr).toBe(0);
    for (const r of recRes) expect(r.code, r.stderr).toBe(0);
    const degraded = recRes.filter((r) => r.stdout.includes("STATE_NOT_UPDATED")).length;
    console.error(`record-during-sleep: ${RECORDS} records, ${degraded} degraded (STATE_NOT_UPDATED)`);

    // Ledger integrity.
    const bytes = new Uint8Array(readFileSync(join(a.root, LEDGER_REL)));
    const full = parseLedger(bytes);
    expect(full.diagnostics.map((d) => d.code)).toEqual([]);
    expect(full.tail.length).toBe(a.initialLines + RECORDS);
    expect(full.events.length).toBe(a.initialLines + RECORDS);

    // Checkpoint is loadable and its cursor matches the ledger.
    const st = await loadStateFile(createWorkspaceFs(a.root));
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    const tail = parseLedger(bytes, st.value.cursor);
    expect(tail.rewritten).toBe(false);
    expect(tail.diagnostics.map((d) => d.code)).toEqual([]);

    // Oracle: same commands, strictly sequential.
    const b = await freshWorkspace();
    const s2 = await spawnCli(BUNDLE, ["sleep", ...base(b.root, b.commit, b.now), "--apply"], b.root, 90_000);
    expect(s2.code, s2.stderr).toBe(0);
    for (let i = 0; i < RECORDS; i++) {
      const r = await spawnCli(BUNDLE, recordArgs(b.root, b.commit, b.now, i), b.root, 90_000);
      expect(r.code, r.stderr).toBe(0);
    }
    expect(await scoreOf(a.root, a.commit, a.now)).toEqual(await scoreOf(b.root, b.commit, b.now));
  }, 120_000);
});
