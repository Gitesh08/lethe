// Loads .kiro/lethe/state.json (checkpointed states + ledger cursor). Refs: Req 10.6, Req 23
import { err, ok } from "@lethe/core";
import type { EngramState, Result } from "@lethe/core";
import { z } from "zod";
import { toolError } from "../envelope/errors.js";
import type { ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { ZERO_CURSOR } from "../persist/ledger-cursor.js";
import type { LedgerCursor } from "../persist/ledger-cursor.js";

const IsoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/, {
  message: "must be an ISO 8601 instant",
});

export const STATE_PATH = ".kiro/lethe/state.json";

const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const LedgerCursorSchema = z
  .strictObject({
    lines: Count,
    bytes: Count,
    lastLineSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  })
  .refine((c) => (c.lines === 0) === (c.lastLineSha256 === null), {
    message: "lastLineSha256 must be null exactly when lines is 0",
    path: ["lastLineSha256"],
  });

const EngramStateSchema = z.strictObject({
  stability: z.number().positive().finite(),
  lastReinforcedCommit: Count,
  lastReinforcedAt: IsoInstant,
  reinforcements: Count,
});

export const StateFileSchema = z.strictObject({
  version: z.literal(1),
  commit: Count,
  at: IsoInstant,
  ledger: LedgerCursorSchema,
  engrams: z.record(z.string().min(1), EngramStateSchema),
});

export interface LoadedState {
  readonly states: ReadonlyArray<EngramState>;
  readonly cursor: LedgerCursor;
  /** Commit and instant of the last checkpoint; undefined when the file is absent. */
  readonly commit: number | undefined;
  readonly at: string | undefined;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function invalid(why: string, keyPath: string): ToolError {
  return toolError("CONFIG_INVALID", `${STATE_PATH} is invalid: ${why}`, { file: STATE_PATH, path: keyPath });
}

/** Parses state.json text. Malformed JSON or schema violations are CONFIG_INVALID naming the key path. */
export function parseStateText(text: string): Result<LoadedState, ToolError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err(invalid("not valid JSON", "(root)"));
  }
  const parsed = StateFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const keyPath = issue === undefined || issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
    return err(invalid(issue?.message ?? "schema violation", keyPath));
  }
  const d = parsed.data;
  // Read entries from the raw JSON object: zod's record output drops an own "__proto__" key.
  // Values were already validated above, so re-parsing each one is safe and total.
  const rawEngrams = (raw as { readonly engrams: Readonly<Record<string, unknown>> }).engrams;
  const states: EngramState[] = Object.entries(rawEngrams)
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([id, v]) => ({ id, ...EngramStateSchema.parse(v) }));
  return ok({ states, cursor: d.ledger, commit: d.commit, at: d.at });
}

/** Reads state.json; absent means no states and a zero cursor (Req 10.6). */
export async function loadStateFile(fsx: WorkspaceFs): Promise<Result<LoadedState, ToolError>> {
  const r = await fsx.readText(STATE_PATH);
  if (!r.ok) return r;
  if (r.value === undefined) return ok({ states: [], cursor: ZERO_CURSOR, commit: undefined, at: undefined });
  return parseStateText(r.value);
}
