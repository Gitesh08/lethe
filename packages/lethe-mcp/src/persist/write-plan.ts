// Ordered, journaled, rollback-safe multi-file apply (Req 8.3, 8.4, 8.5, 8.7, 8.10). The caller holds the lock.
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import { backupPreImages } from "../io/backup.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { deleteJournal, writeJournal, type JournalFile } from "./journal.js";

export const TOMBSTONES_PATH = ".kiro/crypt/tombstones.json";
export const STATE_PATH = ".kiro/lethe/state.json";

export interface PlannedWrite {
  readonly rel: string;
  readonly content: string;
}

export interface ApplyOutcome {
  /** Files actually written, in write order. Empty means nothing differed (no backup, no journal). */
  readonly written: readonly string[];
  readonly backupPath?: string;
}

export interface ApplyContext {
  readonly fs: WorkspaceFs;
  readonly commit: number;
  readonly nowISO: string;
  readonly pid: number;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Order: tombstones, steering files ascending by path, then state.json. Absent parts are skipped. */
export function buildWritePlan(parts: {
  readonly tombstones?: string;
  readonly steering: readonly PlannedWrite[];
  readonly state?: string;
}): readonly PlannedWrite[] {
  const steering = [...parts.steering].sort((a, b) => byCodeUnit(a.rel, b.rel));
  return [
    ...(parts.tombstones === undefined ? [] : [{ rel: TOMBSTONES_PATH, content: parts.tombstones }]),
    ...steering,
    ...(parts.state === undefined ? [] : [{ rel: STATE_PATH, content: parts.state }]),
  ];
}

interface Target extends PlannedWrite {
  readonly pre: Uint8Array | undefined;
}

const enc = new TextEncoder();

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

async function diffTargets(fsx: WorkspaceFs, writes: readonly PlannedWrite[]): Promise<Result<Target[], ToolError>> {
  const out: Target[] = [];
  for (const w of writes) {
    const cur = await fsx.readBytes(w.rel);
    if (!cur.ok) return cur;
    if (!sameBytes(cur.value, enc.encode(w.content))) out.push({ ...w, pre: cur.value });
  }
  return ok(out);
}

async function restoreOne(fsx: WorkspaceFs, t: Target, backupPath: string | undefined): Promise<boolean> {
  if (t.pre === undefined) return (await fsx.remove(t.rel)).ok;
  if ((await fsx.writeAtomic(t.rel, t.pre)).ok) return true;
  return backupPath !== undefined && (await fsx.copyTo(`${backupPath}/${t.rel}`, t.rel)).ok;
}

/** Restores in reverse order; returns the paths that could not be restored. */
async function rollback(fsx: WorkspaceFs, touched: readonly Target[], backupPath: string | undefined): Promise<string[]> {
  const stuck: string[] = [];
  for (const t of [...touched].reverse()) {
    if (!(await restoreOne(fsx, t, backupPath))) stuck.push(t.rel);
  }
  return stuck.reverse();
}

async function writeAll(
  fsx: WorkspaceFs,
  targets: readonly Target[],
  touched: Target[],
): Promise<ToolError | undefined> {
  for (const t of targets) {
    touched.push(t);
    const w = await fsx.writeAtomic(t.rel, t.content);
    if (!w.ok) return w.error;
  }
  return undefined;
}

async function failAndRollback(
  c: ApplyContext,
  cause: ToolError,
  touched: readonly Target[],
  backupPath: string | undefined,
): Promise<Result<ApplyOutcome, ToolError>> {
  const stuck = await rollback(c.fs, touched, backupPath);
  const detail: Record<string, unknown> = { applied: false, cause };
  if (stuck.length > 0) {
    detail["differing"] = stuck;
    if (backupPath !== undefined) detail["backupPath"] = backupPath;
    return err(toolError("IO_FAILED", "Apply failed and rollback was incomplete; pending.json kept.", detail));
  }
  await deleteJournal(c.fs);
  return err(toolError("IO_FAILED", "Apply failed; all files were restored.", detail));
}

/** Diff, back up, journal, write in order, delete the journal. On failure restore everything (see design). */
export async function executeWritePlan(
  c: ApplyContext,
  writes: readonly PlannedWrite[],
): Promise<Result<ApplyOutcome, ToolError>> {
  const diff = await diffTargets(c.fs, writes);
  if (!diff.ok) return diff;
  const targets = diff.value;
  if (targets.length === 0) return ok({ written: [] });
  const bk = await backupPreImages(c.fs, c.commit, targets.map((t) => t.rel));
  if (!bk.ok) return bk;
  const backupPath = bk.value.backupPath;
  const files: JournalFile[] = targets.map((t) => ({ path: t.rel, existed: t.pre !== undefined }));
  const j = await writeJournal(c.fs, {
    version: 1,
    startedAt: c.nowISO,
    pid: c.pid,
    ...(backupPath === undefined ? {} : { backupDir: backupPath }),
    files,
  });
  if (!j.ok) {
    await deleteJournal(c.fs);
    return j;
  }
  const touched: Target[] = [];
  const failure = await writeAll(c.fs, targets, touched);
  if (failure !== undefined) return failAndRollback(c, failure, touched, backupPath);
  const d = await deleteJournal(c.fs);
  if (!d.ok) return failAndRollback(c, d.error, touched, backupPath);
  return ok({ written: targets.map((t) => t.rel), ...(backupPath === undefined ? {} : { backupPath }) });
}
