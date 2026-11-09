// resurrect: put a buried engram back into its file, byte-exact (INV-3).
// Refs: REQ-CRY-3, REQ-CRY-7, INV-3, INV-7
//
// Deliberate deviations from the architecture-doc signature
// `resurrect(workspace, tomb, nowCommit, nowISO) => VirtualWorkspace`:
//  1. Extra `cfg`: the file is re-parsed (granularity) to find neighbors / indexes.
//  2. Returns `Result<{ workspace, state, placement }>`: errors are returned, not thrown.
//  3. Returns the fresh EngramState (REQ 4.11: stability = cfg.s0, deltaC = 0). The
//     workspace holds no states, so the caller (state.json owner) must store it.
//     score() synthesizes exactly this state for an engram without one.
//
// Placement refines the pure index rule: after the surviving neighbor, else the
// original index, else a `## Resurrected` section (see place.ts). A raw that
// carries an H2 heading therefore lands as a sibling section.
// The tombstone must match a workspace record EXACTLY (id, buriedAtCommit,
// buriedAt, raw); exactly that one record is removed.
import { err, ok } from "../result.js";
import { parseDocument } from "../parse/document.js";
import type {
  EngramState, LetheConfig, LetheError, Result, TombstoneRecord, VirtualWorkspace,
} from "../types.js";
import { placeRaw } from "./place.js";

export interface ResurrectResult {
  readonly workspace: VirtualWorkspace;
  readonly state: EngramState;
  readonly placement: "neighbor" | "index" | "fallback" | "new-file";
}

function sameRecord(a: TombstoneRecord, b: TombstoneRecord): boolean {
  return (
    a.id === b.id &&
    a.buriedAtCommit === b.buriedAtCommit &&
    a.buriedAt === b.buriedAt &&
    a.raw === b.raw
  );
}

function withFile(ws: VirtualWorkspace, file: string, text: string, rest: readonly TombstoneRecord[]): VirtualWorkspace {
  const files = new Map(ws.files);
  files.set(file, text);
  return { files, tombstones: rest };
}

export function resurrect(
  workspace: VirtualWorkspace,
  tomb: TombstoneRecord,
  nowCommit: number,
  nowISO: string,
  cfg: LetheConfig,
): Result<ResurrectResult, LetheError> {
  if ((tomb.schema as number) !== 1) {
    return err({
      code: "CONFIG_INVALID",
      message: `unsupported tombstone schema ${String(tomb.schema)} for ${tomb.id}`,
    });
  }
  const at = workspace.tombstones.findIndex((t) => sameRecord(t, tomb));
  if (at < 0) {
    return err({ code: "TOMBSTONE_NOT_FOUND", message: `tombstone not found for ${tomb.id}` });
  }
  const rest = workspace.tombstones.filter((_, i) => i !== at);
  const state: EngramState = {
    id: tomb.id,
    stability: cfg.s0,
    lastReinforcedCommit: nowCommit,
    lastReinforcedAt: nowISO,
    reinforcements: 0,
  };

  const text = workspace.files.get(tomb.file);
  if (text === undefined) {
    return ok({ workspace: withFile(workspace, tomb.file, tomb.raw, rest), state, placement: "new-file" });
  }
  const parsed = parseDocument(tomb.file, text, cfg);
  if (!parsed.ok) return err(parsed.error);
  const engrams = parsed.value.engrams;
  if (engrams.some((g) => g.id === tomb.id)) {
    return err({
      code: "PARSE_DUPLICATE_ID",
      message: `engram ${tomb.id} already exists in ${tomb.file}; resolve manually`,
    });
  }
  const placed = placeRaw(text, engrams, tomb);
  return ok({
    workspace: withFile(workspace, tomb.file, placed.text, rest),
    state,
    placement: placed.placement,
  });
}
