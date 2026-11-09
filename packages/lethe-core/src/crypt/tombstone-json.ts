// tombstones.json text <-> TombstoneRecord[]. Pure; the caller does the file IO.
// Format: { "version": 1, "tombstones": [...] } sorted by (buriedAtCommit, id),
// fixed key order, 2-space indent, trailing newline (02-architecture section 7).
// Refs: REQ-CRY-1, REQ-CRY-3, INV-3, P9
import { err, ok } from "../result.js";
import type { LetheError, Result, TombstoneRecord } from "../types.js";
import { toTombstoneRecord } from "./tombstone-guards.js";

/** Fixed key order of a serialized record; `defeatedBy` is skipped when absent. */
export const KEY_ORDER = [
  "schema", "id", "file", "headingPath", "body", "raw", "contentHash", "tokens",
  "meta", "state", "reason", "retentionAtDeath", "buriedAtCommit", "buriedAt",
  "defeatedBy", "position",
] as const;

function compareTombstones(a: TombstoneRecord, b: TombstoneRecord): number {
  if (a.buriedAtCommit !== b.buriedAtCommit) return a.buriedAtCommit < b.buriedAtCommit ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sorted copy using the canonical total order. */
export function sortTombstones(list: readonly TombstoneRecord[]): TombstoneRecord[] {
  return [...list].sort(compareTombstones);
}

function ordered(t: TombstoneRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (key === "defeatedBy" && t.defeatedBy === undefined) continue;
    out[key] = canonical(key, t);
  }
  return out;
}

function canonical(key: (typeof KEY_ORDER)[number], t: TombstoneRecord): unknown {
  switch (key) {
    case "meta":
      return { globs: t.meta.globs, specLinks: t.meta.specLinks, pinned: t.meta.pinned };
    case "state":
      return {
        id: t.state.id,
        stability: t.state.stability,
        lastReinforcedCommit: t.state.lastReinforcedCommit,
        lastReinforcedAt: t.state.lastReinforcedAt,
        reinforcements: t.state.reinforcements,
      };
    case "position":
      return t.position.neighborBefore === undefined
        ? { index: t.position.index }
        : { index: t.position.index, neighborBefore: t.position.neighborBefore };
    default:
      return t[key];
  }
}

export function serializeTombstones(list: readonly TombstoneRecord[]): string {
  const tombstones = sortTombstones(list).map(ordered);
  return `${JSON.stringify({ version: 1, tombstones }, null, 2)}\n`;
}

function bad(message: string): Result<never, LetheError> {
  return err({ code: "CONFIG_INVALID", message: `tombstones.json: ${message}` });
}

export function parseTombstones(text: string): Result<readonly TombstoneRecord[], LetheError> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return bad("invalid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return bad("root is not an object");
  const root = data as Readonly<Record<string, unknown>>;
  if (root["version"] !== 1) return bad(`unsupported version ${JSON.stringify(root["version"])}`);
  const items = root["tombstones"];
  if (!Array.isArray(items)) return bad("`tombstones` is not an array");
  const out: TombstoneRecord[] = [];
  for (const [i, item] of (items as readonly unknown[]).entries()) {
    const rec = toTombstoneRecord(item);
    if (typeof rec === "string") return bad(`entry ${i}: ${rec}`);
    out.push(rec);
  }
  return ok(out);
}
