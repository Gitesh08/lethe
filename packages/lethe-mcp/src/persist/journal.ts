// pending.json (the Journal): written before the first target write, deleted after the last (Req 8.10).
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { KEY_ORDERS, stableStringify } from "./stable-json.js";

export const JOURNAL_PATH = ".kiro/lethe/pending.json";

export interface JournalFile {
  readonly path: string;
  readonly existed: boolean;
}

export interface Journal {
  readonly version: 1;
  readonly startedAt: string;
  readonly pid: number;
  /** Backup_Dir holding the pre-images, or undefined when no target existed before the apply. */
  readonly backupDir?: string;
  readonly files: readonly JournalFile[];
}

export function serializeJournal(j: Journal): string {
  return stableStringify(j, KEY_ORDERS.pendingJournal);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseFiles(files: readonly unknown[]): JournalFile[] | undefined {
  const out: JournalFile[] = [];
  for (const f of files) {
    if (!isRecord(f)) return undefined;
    const { path, existed } = f;
    if (typeof path !== "string" || typeof existed !== "boolean") return undefined;
    out.push({ path, existed });
  }
  return out;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Total parser: returns undefined for anything that is not a well-formed v1 Journal. */
export function parseJournal(text: string): Journal | undefined {
  const raw = parseJson(text);
  if (!isRecord(raw) || raw["version"] !== 1) return undefined;
  const { startedAt, pid, backupDir, files } = raw;
  if (typeof startedAt !== "string" || typeof pid !== "number" || !Array.isArray(files)) return undefined;
  if (backupDir !== undefined && typeof backupDir !== "string") return undefined;
  const parsed = parseFiles(files as readonly unknown[]);
  if (parsed === undefined) return undefined;
  const base = { version: 1 as const, startedAt, pid, files: parsed };
  return backupDir === undefined ? base : { ...base, backupDir };
}

export function writeJournal(fsx: WorkspaceFs, j: Journal): Promise<Result<void, ToolError>> {
  return fsx.writeAtomic(JOURNAL_PATH, serializeJournal(j));
}

/** ok(undefined) when absent; IO error result when present but unparseable. */
export async function readJournal(fsx: WorkspaceFs): Promise<Result<Journal | undefined, ToolError>> {
  const t = await fsx.readText(JOURNAL_PATH);
  if (!t.ok) return t;
  if (t.value === undefined) return ok(undefined);
  const j = parseJournal(t.value);
  return j === undefined
    ? err(toolError("IO_FAILED", "pending.json is not a valid journal.", { path: JOURNAL_PATH }))
    : ok(j);
}

export function deleteJournal(fsx: WorkspaceFs): Promise<Result<void, ToolError>> {
  return fsx.remove(JOURNAL_PATH);
}
