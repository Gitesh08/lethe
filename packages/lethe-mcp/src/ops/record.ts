// recordOp (design "Adopt and record"; Req 12.1-12.5, 12.7): append one ledger event, then stamp + checkpoint
// under a short lock budget. The append never takes the lock; a failed lock/checkpoint degrades to STATE_NOT_UPDATED.
import { isAbsolute, relative } from "node:path";
import { err, ok, type LedgerEvent, type Result } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import { toolError, type ToolError } from "../envelope/errors.js";
import { guardPath } from "../io/path-guard.js";
import { nodeFsProbe } from "../io/workspace-fs.js";
import { appendLedgerEvent } from "../persist/ledger-append.js";
import type { RunContext } from "./context.js";
import { runCheckpointStep } from "./checkpoint-step.js";
import { withMutation } from "./mutate.js";

export const FILES_CAP = 500;
export const RECORD_LOCK_WAIT_MS = 1000;

export type RecordType = LedgerEvent["type"];

export interface RecordInput {
  readonly type: RecordType;
  /** `--files a,b` already split. */
  readonly files?: ReadonlyArray<string>;
  readonly cited?: ReadonlyArray<string>;
  readonly filesFromGit?: boolean;
  /** Lock wait budget for the checkpoint step (default 1000 ms; Req 12.7). */
  readonly lockWaitMs?: number;
}

export interface RecordData {
  readonly event: LedgerEvent;
  /** True when state.json was stamped/checkpointed (false when it was already current or degraded). */
  readonly stateUpdated: boolean;
  /** True when the checkpoint step could not run (STATE_NOT_UPDATED reported). */
  readonly degraded: boolean;
  readonly matchesNoEngram: boolean;
  readonly summary: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clean = (xs: ReadonlyArray<string> | undefined): string[] =>
  (xs ?? []).map((x) => x.trim()).filter((x) => x !== "");

function toRelative(root: string, p: string): string {
  const rel = isAbsolute(p) ? relative(root, p) : p;
  return rel.replace(/\\/g, "/");
}

/** Guards every entry; failures are dropped with a stderr warning and a PATH_DROPPED diagnostic. */
function guardFiles(ctx: RunContext, files: ReadonlyArray<string>): string[] {
  const kept = new Set<string>();
  for (const f of files) {
    const rel = toRelative(ctx.root, f);
    const g = rel === "" ? undefined : guardPath(ctx.root, rel, nodeFsProbe);
    if (g === undefined || !g.ok) {
      ctx.log(`lethe record: dropped path outside the workspace: ${f}`);
      ctx.diagnostics.push(diagnostic("PATH_DROPPED", `Dropped a filesTouched entry that fails the path guard: ${f}`));
      continue;
    }
    kept.add(rel);
  }
  return [...kept].sort(byCodeUnit);
}

async function gitFiles(ctx: RunContext): Promise<string[]> {
  const names = await ctx.git.changedFiles(ctx.root);
  if (names === undefined) {
    ctx.diagnostics.push(diagnostic("GIT_FILES_UNAVAILABLE", "git could not list changed files; filesTouched is empty."));
    return [];
  }
  const sorted = [...new Set(names.map((n) => n.replace(/\\/g, "/")))].sort(byCodeUnit);
  if (sorted.length > FILES_CAP) {
    ctx.diagnostics.push(
      diagnostic("FILES_TRUNCATED", `git reported ${sorted.length} changed files; filesTouched truncated to ${FILES_CAP}.`),
    );
    return sorted.slice(0, FILES_CAP);
  }
  return sorted;
}

function describe(event: LedgerEvent, matchesNone: boolean): string {
  const files = event.filesTouched?.length ?? 0;
  const cited = event.cited?.length ?? 0;
  const base = `Recorded ${event.type} at commit ${event.commit} (${files} files, ${cited} cited); reinforcement is estimated utility.`;
  return matchesNone ? `${base} No files or citations were given, so it matches no engram.` : base;
}

/** Stamp + checkpoint under the short lock budget; returns whether state.json changed, or undefined when degraded. */
async function checkpointDegrading(ctx: RunContext, waitMs: number): Promise<boolean | undefined> {
  const budgeted: RunContext = { ...ctx, lock: { ...ctx.lock, waitMs } };
  const step = await withMutation(budgeted, (loaded) => runCheckpointStep(budgeted, loaded));
  if (step.ok) {
    ctx.diagnostics.push(...step.value.result.diagnostics);
    return step.value.written;
  }
  ctx.diagnostics.push(
    diagnostic("STATE_NOT_UPDATED", `Event appended, but state.json was not updated (${step.error.code}): ${step.error.message}`),
  );
  return undefined;
}

export async function recordOp(ctx: RunContext, input: RecordInput): Promise<Result<RecordData, ToolError>> {
  const cited = clean(input.cited);
  if ((input.type === "spec_cited" || input.type === "manual_pin") && cited.length === 0) {
    return err(toolError("INVALID_INPUT", `--cited is required for --type ${input.type}.`));
  }
  const fromGit = input.filesFromGit === true ? await gitFiles(ctx) : [];
  const files = guardFiles(ctx, [...clean(input.files), ...fromGit]);
  const event: LedgerEvent = {
    type: input.type,
    at: ctx.nowISO,
    commit: ctx.nowCommit,
    ...(files.length > 0 ? { filesTouched: files } : {}),
    ...(cited.length > 0 ? { cited } : {}),
  };
  const appended = await appendLedgerEvent(ctx.fsx, event);
  if (!appended.ok) return appended;

  const updated = await checkpointDegrading(ctx, input.lockWaitMs ?? RECORD_LOCK_WAIT_MS);
  const matchesNoEngram = files.length === 0 && cited.length === 0;
  return ok({
    event,
    stateUpdated: updated === true,
    degraded: updated === undefined,
    matchesNoEngram,
    summary: describe(event, matchesNoEngram),
    diagnostics: [...ctx.diagnostics],
  });
}
