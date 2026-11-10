// Interrupted-apply recovery end to end: cut a sleep / resurrect apply off at every meaningful write position with
// the faulty fs, then recover with the real fs and prove every file is either all pre-apply or all post-apply bytes.
// Refs: Req 8.5, Req 8.7, Req 21.7, INV-3
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubTo } from "@lethe/core/fixtures";
import { afterEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { acquireLock, LOCK_PATH } from "../src/io/lock.js";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { adoptOp } from "../src/ops/adopt.js";
import { buildContext, type ContextDeps, type RunContext } from "../src/ops/context.js";
import { resurrectOp } from "../src/ops/resurrect.js";
import { sleepOp } from "../src/ops/sleep.js";
import { recoverInterruptedApply } from "../src/persist/recover.js";
import { createFaultyFs, type FaultyFs } from "./helpers/faulty-fs.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const baseDeps: ContextDeps = { git: noGit, gate: stubGate("passed"), log: () => undefined, lock: { waitMs: 0 } };
const PENDING = ".kiro/lethe/pending.json";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

type Snapshot = ReadonlyMap<string, string>;

/** Every file except the backup tree and the lock, as base64 bytes keyed by workspace-relative path. */
function snapshot(root: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel === "" ? name : `${rel}/${name}`;
    if (r === ".kiro/lethe/backup" || r === LOCK_PATH) continue;
    if (statSync(join(root, r)).isDirectory()) {
      for (const [k, v] of snapshot(root, r)) out.set(k, v);
    } else out.set(r, readFileSync(join(root, r)).toString("base64"));
  }
  return out;
}

const same = (a: Snapshot, b: Snapshot): boolean => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

interface Crash {
  readonly root: string;
  readonly faulty: FaultyFs;
  readonly ok: boolean;
  readonly pre: Snapshot;
  readonly post: Snapshot;
  readonly commit: number;
  readonly now: string;
}

async function mk(root: string, commit: number, now: string, deps: ContextDeps): Promise<RunContext> {
  const r = await buildContext({ workspacePath: root, commit, now }, deps);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Fresh haunted workspace (adopted; for resurrect also slept), then the apply op under a faulty fs. */
async function crashRun(kind: "sleep" | "resurrect", failFrom: number): Promise<Crash> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-recover-")));
  roots.push(root);
  const repo = await materialiseHaunted(root);
  const later = scrubTo(repo, 150);
  const adopt = await adoptOp(await mk(root, repo.nowCommit, repo.nowISO, baseDeps), { apply: true });
  expect(adopt.ok).toBe(true);
  const sleepIn = { apply: true, skipGate: false, gateRuns: 20 };
  let archivedId = "";
  if (kind === "resurrect") {
    const s = await sleepOp(await mk(root, later.nowCommit, later.nowISO, baseDeps), sleepIn);
    if (!s.ok) throw new Error(s.error.message);
    archivedId = s.value.archived[0]?.id ?? "";
    expect(archivedId).not.toBe("");
  }
  const pre = snapshot(root);
  let faulty: FaultyFs | undefined;
  const ctx = await mk(root, later.nowCommit, later.nowISO, {
    ...baseDeps,
    fsx: (r) => (faulty = createFaultyFs(createWorkspaceFs(r), failFrom)).fsx,
  });
  const res = kind === "sleep" ? await sleepOp(ctx, sleepIn) : await resurrectOp(ctx, { query: archivedId, apply: true });
  if (faulty === undefined) throw new Error("fsx factory was not used");
  return { root, faulty, ok: res.ok, pre, post: snapshot(root), commit: later.nowCommit, now: later.nowISO };
}

/** Write positions worth cutting at: everything the apply does after taking the lock. */
function positions(calls: readonly string[]): number[] {
  const out: number[] = [];
  calls.forEach((c, i) => {
    if (!c.endsWith(LOCK_PATH) && !c.startsWith("mkdirp .kiro/lethe ") && c !== "mkdirp .kiro/lethe") out.push(i + 1);
  });
  return out;
}

async function recoverDirect(root: string): Promise<{ diag: string | undefined }> {
  const fsx = createWorkspaceFs(root);
  const lock = await acquireLock(fsx, { waitMs: 0 });
  if (!lock.ok) throw new Error(lock.error.message);
  try {
    const rec = await recoverInterruptedApply(fsx);
    if (!rec.ok) throw new Error(rec.error.message);
    return { diag: rec.value?.code };
  } finally {
    await lock.value.release();
  }
}

function describeKind(kind: "sleep" | "resurrect"): void {
  it(`${kind} apply: every cut-off position recovers to all-pre or all-post bytes`, async () => {
    const clean = await crashRun(kind, Number.MAX_SAFE_INTEGER);
    expect(clean.ok).toBe(true);
    expect(clean.faulty.tripped()).toBe(false);
    expect(same(clean.pre, clean.post)).toBe(false);
    const calls = clean.faulty.calls;
    const pos = positions(calls);
    // The meaningful targets are all cut: journal, tombstones, state and at least one steering file.
    expect(pos.map((p) => calls[p - 1])).toEqual(expect.arrayContaining([
      `writeAtomic ${PENDING}`, "writeAtomic .kiro/crypt/tombstones.json", "writeAtomic .kiro/lethe/state.json",
    ]));
    expect(calls.some((c) => c.startsWith("writeAtomic .kiro/steering/"))).toBe(true);

    for (const k of pos) {
      const crashed = await crashRun(kind, k);
      expect(crashed.faulty.tripped(), `position ${k} (${calls[k - 1]})`).toBe(true);
      expect(crashed.ok, `position ${k}`).toBe(false);
      const hadJournal = existsSync(join(crashed.root, PENDING));
      expect(same(crashed.pre, clean.pre), `pre snapshot, position ${k}`).toBe(true);
      // The crashed process died holding the lock.
      rmSync(join(crashed.root, LOCK_PATH), { force: true });

      const { diag } = await recoverDirect(crashed.root);
      const after = snapshot(crashed.root);
      expect(existsSync(join(crashed.root, PENDING)), `pending left, position ${k}`).toBe(false);
      expect(diag, `position ${k}`).toBe(hadJournal ? "INTERRUPTED_APPLY_RECOVERED" : undefined);
      for (const [file, bytes] of after) {
        expect([clean.pre.get(file), clean.post.get(file)], `${file} at position ${k}`).toContain(bytes);
      }
      expect(same(after, clean.pre) || same(after, clean.post), `mixed state at position ${k} (${calls[k - 1]})`).toBe(true);
    }
  }, 120_000);

  it(`${kind} apply: a following mutating op reports INTERRUPTED_APPLY_RECOVERED`, async () => {
    const clean = await crashRun(kind, Number.MAX_SAFE_INTEGER);
    const calls = clean.faulty.calls;
    const journalPos = calls.indexOf(`writeAtomic ${PENDING}`) + 1;
    const stateWrite = calls.indexOf("writeAtomic .kiro/lethe/state.json") + 1;
    for (const k of [journalPos + 1, stateWrite]) {
      const crashed = await crashRun(kind, k);
      expect(crashed.ok).toBe(false);
      expect(existsSync(join(crashed.root, PENDING))).toBe(true);
      rmSync(join(crashed.root, LOCK_PATH), { force: true });
      const ctx = await mk(crashed.root, crashed.commit, crashed.now, baseDeps);
      const res = await adoptOp(ctx, { apply: true });
      expect(res.ok).toBe(true);
      expect(ctx.diagnostics.map((d) => d.code)).toContain("INTERRUPTED_APPLY_RECOVERED");
      expect(existsSync(join(crashed.root, PENDING))).toBe(false);
    }
  }, 120_000);
}

describe("interrupted sleep apply", () => describeKind("sleep"));
describe("interrupted resurrect apply", () => describeKind("resurrect"));
