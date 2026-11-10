// Pre-image backups under .kiro/lethe/backup/<commit>[-n]/ (Req 8.3). All IO goes through WorkspaceFs.
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "./workspace-fs.js";

export const BACKUP_ROOT = ".kiro/lethe/backup";
const MAX_SUFFIX = 10_000;

export interface BackupResult {
  /** Workspace-relative Backup_Dir, or undefined when no file had a pre-image (nothing was created). */
  readonly backupPath: string | undefined;
  /** Relative paths whose pre-image was copied, in input order. */
  readonly copied: readonly string[];
}

/** Atomically claims the next free `<commit>`, `<commit>-2`, ... directory and returns its relative path. */
export async function planBackupDir(fsx: WorkspaceFs, commit: number): Promise<Result<string, ToolError>> {
  const parent = await fsx.mkdirp(BACKUP_ROOT);
  if (!parent.ok) return parent;
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const dir = `${BACKUP_ROOT}/${n === 1 ? String(commit) : `${commit}-${n}`}`;
    const claimed = await fsx.mkdirExclusive(dir);
    if (!claimed.ok) return claimed;
    if (claimed.value) return ok(dir);
  }
  return err(toolError("IO_FAILED", "No free backup directory name.", { path: `${BACKUP_ROOT}/${commit}` }));
}

/**
 * Copies the current bytes of each file in `files` (workspace-relative, forward slashes) to the Backup_Dir at the
 * same relative path. Files that do not exist have no pre-image and are skipped; when none exist nothing is created.
 */
export async function backupPreImages(
  fsx: WorkspaceFs,
  commit: number,
  files: readonly string[],
): Promise<Result<BackupResult, ToolError>> {
  const existing: string[] = [];
  for (const f of files) {
    const b = await fsx.readBytes(f);
    if (!b.ok) return b;
    if (b.value !== undefined) existing.push(f);
  }
  if (existing.length === 0) return ok({ backupPath: undefined, copied: [] });
  const dir = await planBackupDir(fsx, commit);
  if (!dir.ok) return dir;
  for (const f of existing) {
    const c = await fsx.copyTo(f, `${dir.value}/${f}`);
    if (!c.ok) return c;
  }
  return ok({ backupPath: dir.value, copied: existing });
}
