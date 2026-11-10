// Rolls back an interrupted apply from pending.json (Req 8.10). The caller holds the lock.
import { err, ok, type Result } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import { toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { JOURNAL_PATH, deleteJournal, parseJournal, type Journal } from "./journal.js";

interface Restore {
  readonly path: string;
  /** Pre-image bytes for files that existed; undefined means the apply created the file. */
  readonly pre: Uint8Array | undefined;
}

function refuse(message: string, detail: Record<string, unknown>): Result<never, ToolError> {
  return err(toolError("IO_FAILED", `${message} pending.json was kept; restore from the backup by hand.`, detail));
}

/** Reads every pre-image first so a missing one aborts before any file is touched. */
async function collectRestores(fsx: WorkspaceFs, j: Journal): Promise<Result<Restore[], ToolError>> {
  const out: Restore[] = [];
  for (const f of j.files) {
    if (!f.existed) {
      out.push({ path: f.path, pre: undefined });
      continue;
    }
    const src = j.backupDir === undefined ? undefined : `${j.backupDir}/${f.path}`;
    const b = src === undefined ? undefined : await fsx.readBytes(src);
    if (b !== undefined && !b.ok) return b;
    if (b === undefined || b.value === undefined) {
      return refuse("Pre-image missing for an interrupted apply.", { path: f.path, backupDir: j.backupDir });
    }
    out.push({ path: f.path, pre: b.value });
  }
  return ok(out);
}

async function applyRestores(fsx: WorkspaceFs, restores: readonly Restore[]): Promise<Result<void, ToolError>> {
  for (const r of restores) {
    const done = r.pre === undefined ? await fsx.remove(r.path) : await fsx.writeAtomic(r.path, r.pre);
    if (!done.ok) return refuse("Restoring an interrupted apply failed.", { path: r.path, cause: done.error });
  }
  return ok(undefined);
}

/**
 * ok(undefined) when no journal exists (no-op). Otherwise restores every listed file byte-exact from the named
 * Backup_Dir, removes files the interrupted apply created, deletes the journal, and returns an
 * INTERRUPTED_APPLY_RECOVERED diagnostic. An unparseable journal or a missing pre-image is refused with IO_FAILED
 * and the journal is kept.
 */
export async function recoverInterruptedApply(fsx: WorkspaceFs): Promise<Result<Diagnostic | undefined, ToolError>> {
  const t = await fsx.readText(JOURNAL_PATH);
  if (!t.ok) return t;
  if (t.value === undefined) return ok(undefined);
  const j = parseJournal(t.value);
  if (j === undefined) return refuse("pending.json is not a valid journal.", { path: JOURNAL_PATH });
  const restores = await collectRestores(fsx, j);
  if (!restores.ok) return restores;
  const applied = await applyRestores(fsx, restores.value);
  if (!applied.ok) return applied;
  const d = await deleteJournal(fsx);
  if (!d.ok) return d;
  const names = j.files.map((f) => f.path).join(", ");
  return ok(diagnostic("INTERRUPTED_APPLY_RECOVERED", `An interrupted apply was rolled back (${names}).`, JOURNAL_PATH));
}
