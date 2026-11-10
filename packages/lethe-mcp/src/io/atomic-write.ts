// Atomic writer (Req 8.1, 8.2). Pure orchestration over an injectable AtomicFsOps seam;
// the node:fs implementation lives in io/workspace-fs.ts (layering rule fs-only-workspace-fs).
import { basename, dirname, join } from "node:path";
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";

export interface AtomicFileHandle {
  write(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Filesystem operations the atomic writer needs. Tests wrap or replace these to inject failures. */
export interface AtomicFsOps {
  mkdirp(dir: string): Promise<void>;
  /** Creates a new file, failing if it exists (`wx`). */
  openExclusive(path: string): Promise<AtomicFileHandle>;
  /** Best effort: copies the permission bits of `from` onto `to`; must not throw when `from` is absent. */
  copyMode(from: string, to: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file; must not throw when it is already absent. */
  unlink(path: string): Promise<void>;
  /** Best-effort directory fsync (no-op on Windows). */
  syncDir(dir: string): Promise<void>;
  delay(ms: number): Promise<void>;
}

export interface AtomicWriteOptions {
  /** Backoff before each rename retry; length = number of retries. Default [20, 50, 100]. */
  readonly renameBackoffMs?: ReadonlyArray<number>;
  readonly pid?: number;
  readonly platform?: string;
}

export const RENAME_BACKOFF_MS: ReadonlyArray<number> = [20, 50, 100];
const RETRYABLE = new Set(["EPERM", "EACCES", "EBUSY"]);
let counter = 0;

function errCode(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const c = (e as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

/** Unique sibling temp path: `.<base>.<pid>.<counter>.tmp` in the target's directory. */
export function tempPathFor(target: string, pid: number = process.pid): string {
  counter += 1;
  return join(dirname(target), `.${basename(target)}.${pid}.${counter}.tmp`);
}

async function renameWithRetry(
  ops: AtomicFsOps,
  from: string,
  to: string,
  backoff: ReadonlyArray<number>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await ops.rename(from, to);
      return;
    } catch (e) {
      const wait = backoff[attempt];
      const code = errCode(e);
      if (wait === undefined || code === undefined || !RETRYABLE.has(code)) throw e;
      await ops.delay(wait);
    }
  }
}

async function writeTemp(ops: AtomicFsOps, tmp: string, bytes: Uint8Array): Promise<void> {
  const h = await ops.openExclusive(tmp);
  try {
    await h.write(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
}

/**
 * Writes `content` exactly (UTF-8 for strings; no newline translation, BOM untouched) to the
 * absolute, already-guarded `target`. Never throws: failures return IO_FAILED and leave no temp file.
 */
export async function atomicWrite(
  ops: AtomicFsOps,
  target: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<Result<void, ToolError>> {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const tmp = tempPathFor(target, opts.pid);
  let created = false;
  try {
    await ops.mkdirp(dirname(target));
    created = true;
    await writeTemp(ops, tmp, bytes);
    if ((opts.platform ?? process.platform) !== "win32") await ops.copyMode(target, tmp);
    await renameWithRetry(ops, tmp, target, opts.renameBackoffMs ?? RENAME_BACKOFF_MS);
  } catch (e) {
    if (created) await ops.unlink(tmp).catch(() => undefined);
    return err(toolError("IO_FAILED", "Atomic write failed.", { code: errCode(e) ?? "UNKNOWN", path: target }));
  }
  if ((opts.platform ?? process.platform) !== "win32") await ops.syncDir(dirname(target)).catch(() => undefined);
  return ok(undefined);
}
