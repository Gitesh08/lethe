// resurrectOp (design "Resurrect operation"; Req 5.2-5.5, REQ-CRY-7). Dry-run lists matches; apply restores
// byte-exact through core `resurrect`, all-or-nothing through the journaled write plan.
import {
  err, globMatch, ok, resurrect, serializeTombstones,
  type EngramState, type Result, type TombstoneRecord, type VirtualWorkspace,
} from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { mapCoreError, toolError, type ToolError } from "../envelope/errors.js";
import { LEDGER_REL } from "../load/ledger-file.js";
import { loadWorkspace, type LoadedWorkspace } from "../load/workspace.js";
import { computeCheckpoint } from "../persist/checkpoint.js";
import { serializeState } from "../persist/state-serialize.js";
import { buildWritePlan, executeWritePlan, type PlannedWrite } from "../persist/write-plan.js";
import type { RunContext } from "./context.js";
import { withMutation } from "./mutate.js";

/** Maximum number of matches an apply may restore at once. */
export const MAX_RESURRECT_MATCHES = 50;

export interface ResurrectOpInput {
  readonly query: string;
  readonly apply: boolean;
}

export interface ResurrectData {
  readonly matches: readonly TombstoneRecord[];
  readonly restored?: ReadonlyArray<{ readonly id: string; readonly file: string; readonly placement: "neighbor" | "index" | "fallback" | "new-file" }>;
  readonly commit: number;
  readonly now: string;
  readonly backupPath?: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Rules in order; the first rule with at least one match decides. Results keep the input order. */
export function matchTombstones(tombs: readonly TombstoneRecord[], query: string): TombstoneRecord[] {
  const exact = tombs.filter((t) => t.id === query);
  if (exact.length > 0) return exact;
  if (/[*?/]/.test(query)) {
    const globbed = tombs.filter((t) => globMatch(query, t.file));
    if (globbed.length > 0) return globbed;
  }
  const q = query.toLowerCase();
  return tombs.filter((t) => t.id.toLowerCase().includes(q) || t.body.toLowerCase().includes(q));
}

function selectMatches(loaded: LoadedWorkspace, query: string): Result<TombstoneRecord[], ToolError> {
  const matches = matchTombstones(loaded.tombstones ?? [], query);
  if (matches.length === 0) return err(toolError("TOMBSTONE_NOT_FOUND", `No archived engram matches "${query}".`));
  return ok(matches);
}

function dryData(ctx: RunContext, loaded: LoadedWorkspace, matches: TombstoneRecord[]): ResurrectData {
  return { matches, commit: ctx.nowCommit, now: ctx.nowISO, diagnostics: [...ctx.diagnostics, ...loaded.diagnostics] };
}

interface Restoration {
  readonly workspace: VirtualWorkspace;
  readonly states: EngramState[];
  readonly restored: Array<{ id: string; file: string; placement: "neighbor" | "index" | "fallback" | "new-file" }>;
}

function restoreAll(ctx: RunContext, loaded: LoadedWorkspace, matches: readonly TombstoneRecord[]): Result<Restoration, ToolError> {
  let workspace: VirtualWorkspace = { files: loaded.steeringFiles, tombstones: loaded.tombstones ?? [] };
  const states: EngramState[] = [];
  const restored: Restoration["restored"] = [];
  for (const tomb of matches) {
    const r = resurrect(workspace, tomb, ctx.nowCommit, ctx.nowISO, loaded.cfg);
    if (!r.ok) return err(mapCoreError(r.error));
    workspace = r.value.workspace;
    states.push(r.value.state);
    restored.push({ id: tomb.id, file: tomb.file, placement: r.value.placement });
  }
  return ok({ workspace, states, restored });
}

async function persistRestoration(
  ctx: RunContext,
  loaded: LoadedWorkspace,
  rest: Restoration,
): Promise<Result<{ backupPath?: string }, ToolError>> {
  const raw = await ctx.fsx.readBytes(LEDGER_REL);
  if (!raw.ok) return raw;
  const cp = computeCheckpoint({
    engrams: loaded.engrams, persisted: loaded.persisted.states, persistedCursor: loaded.persisted.cursor,
    ledger: loaded.ledger, ledgerBytes: raw.value ?? new Uint8Array(0), specs: loaded.specs, cfg: loaded.cfg,
    nowCommit: ctx.nowCommit, nowISO: ctx.nowISO, archivedIds: [], anySteeringSkipped: loaded.anySteeringSkipped,
  });
  ctx.diagnostics.push(...cp.diagnostics);
  const fresh = new Set(rest.states.map((s) => s.id));
  const engrams = [...cp.states.filter((s) => !fresh.has(s.id)), ...rest.states];
  const state = serializeState({ commit: ctx.nowCommit, at: ctx.nowISO, ledger: cp.cursor, engrams });
  const steering: PlannedWrite[] = [];
  for (const [rel, content] of rest.workspace.files) {
    if (loaded.steeringFiles.get(rel) !== content) steering.push({ rel, content });
  }
  const writes = buildWritePlan({ tombstones: serializeTombstones(rest.workspace.tombstones), steering, state });
  const out = await executeWritePlan({ fs: ctx.fsx, commit: ctx.nowCommit, nowISO: ctx.nowISO, pid: process.pid }, writes);
  if (!out.ok) return out;
  return ok(out.value.backupPath === undefined ? {} : { backupPath: out.value.backupPath });
}

async function applyBody(ctx: RunContext, loaded: LoadedWorkspace, query: string): Promise<Result<ResurrectData, ToolError>> {
  const sel = selectMatches(loaded, query);
  if (!sel.ok) return sel;
  if (sel.value.length > MAX_RESURRECT_MATCHES) {
    return err(toolError("INVALID_INPUT", `Query matches ${sel.value.length} engrams; narrow it to at most ${MAX_RESURRECT_MATCHES}.`, { matchCount: sel.value.length }));
  }
  const rest = restoreAll(ctx, loaded, sel.value);
  if (!rest.ok) return rest;
  const written = await persistRestoration(ctx, loaded, rest.value);
  if (!written.ok) return written;
  return ok({
    ...dryData(ctx, loaded, sel.value),
    restored: rest.value.restored,
    ...(written.value.backupPath === undefined ? {} : { backupPath: written.value.backupPath }),
    diagnostics: [...ctx.diagnostics, ...loaded.diagnostics],
  });
}

export async function resurrectOp(ctx: RunContext, input: ResurrectOpInput): Promise<Result<ResurrectData, ToolError>> {
  if (input.apply) return withMutation(ctx, (loaded) => applyBody(ctx, loaded, input.query));
  const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: false, needTombstones: true });
  if (!loaded.ok) return loaded;
  const sel = selectMatches(loaded.value, input.query);
  if (!sel.ok) return sel;
  return ok(dryData(ctx, loaded.value, sel.value));
}
