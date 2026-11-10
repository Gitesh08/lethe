// Shared "stamp-plus-checkpoint, then write state.json" step used by adopt (Req 23.11) and record (Req 12.7).
//
// API:
//   computeCheckpointStep(loaded, ctx, ledgerBytes) -> { result, stateText }
//     Pure given its inputs. Archived ids come from `loaded.tombstones` when they were loaded (else none);
//     `anySteeringSkipped` comes from `loaded`. `stateText` is the byte-deterministic state.json for
//     (ctx.nowCommit, ctx.nowISO, result.cursor, result.states).
//   readLedgerBytes(ctx) -> Result<Uint8Array>   (absent ledger = empty bytes)
//   writeStateIfChanged(ctx, stateText) -> Result<boolean>
//     Atomic write of state.json only when the bytes differ from the file on disk (idempotence, Req 23.10).
//     Never creates a Backup_Dir and never journals; returns whether a write happened.
//   runCheckpointStep(ctx, loaded) -> Result<{ result, written }>   convenience: read ledger, compute, write.
// Callers must hold the lock (withMutation) before calling the writer functions.
import { ok, type Result } from "@lethe/core";
import type { ToolError } from "../envelope/errors.js";
import { LEDGER_REL } from "../load/ledger-file.js";
import { STATE_PATH } from "../load/state-file.js";
import type { LoadedWorkspace } from "../load/workspace.js";
import { computeCheckpoint, type CheckpointResult } from "../persist/checkpoint.js";
import { serializeState } from "../persist/state-serialize.js";
import type { RunContext } from "./context.js";

export interface CheckpointStep {
  readonly result: CheckpointResult;
  readonly stateText: string;
}

export async function readLedgerBytes(ctx: RunContext): Promise<Result<Uint8Array, ToolError>> {
  const raw = await ctx.fsx.readBytes(LEDGER_REL);
  if (!raw.ok) return raw;
  return ok(raw.value ?? new Uint8Array(0));
}

export function computeCheckpointStep(loaded: LoadedWorkspace, ctx: RunContext, ledgerBytes: Uint8Array): CheckpointStep {
  const result = computeCheckpoint({
    engrams: loaded.engrams,
    persisted: loaded.persisted.states,
    persistedCursor: loaded.persisted.cursor,
    ledger: loaded.ledger,
    ledgerBytes,
    specs: loaded.specs,
    cfg: loaded.cfg,
    nowCommit: ctx.nowCommit,
    nowISO: ctx.nowISO,
    archivedIds: (loaded.tombstones ?? []).map((t) => t.id),
    anySteeringSkipped: loaded.anySteeringSkipped,
  });
  const stateText = serializeState({ commit: ctx.nowCommit, at: ctx.nowISO, ledger: result.cursor, engrams: result.states });
  return { result, stateText };
}

export async function writeStateIfChanged(ctx: RunContext, stateText: string): Promise<Result<boolean, ToolError>> {
  const current = await ctx.fsx.readText(STATE_PATH);
  if (!current.ok) return current;
  if (current.value === stateText) return ok(false);
  const w = await ctx.fsx.writeAtomic(STATE_PATH, stateText);
  if (!w.ok) return w;
  return ok(true);
}

export async function runCheckpointStep(
  ctx: RunContext,
  loaded: LoadedWorkspace,
): Promise<Result<{ readonly result: CheckpointResult; readonly written: boolean }, ToolError>> {
  const bytes = await readLedgerBytes(ctx);
  if (!bytes.ok) return bytes;
  const { result, stateText } = computeCheckpointStep(loaded, ctx, bytes.value);
  const written = await writeStateIfChanged(ctx, stateText);
  if (!written.ok) return written;
  return ok({ result, written: written.value });
}
