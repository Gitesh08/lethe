// toTombstone: build a schema-1 TombstoneRecord from a scored engram.
// Pure and total: no clock, no IO, nothing shared by reference with the input.
// Refs: REQ-CRY-1, REQ-CRY-3, INV-3, INV-7
import type { ScoredEngram, TombstoneRecord } from "../types.js";

/**
 * @param raw exact file text of the engram (`fileText.slice(span.start, span.end)`),
 *   stored verbatim so resurrection is byte-exact.
 * `defeatedBy` and `neighborBefore` are omitted from the record when undefined
 * (exactOptionalPropertyTypes).
 */
export function toTombstone(
  scored: ScoredEngram,
  reason: TombstoneRecord["reason"],
  nowCommit: number,
  nowISO: string,
  index: number,
  raw: string,
  neighborBefore?: string,
  defeatedBy?: string,
): TombstoneRecord {
  const { node, state } = scored;
  const position =
    neighborBefore === undefined ? { index } : { index, neighborBefore };
  const base: TombstoneRecord = {
    schema: 1,
    id: node.id,
    file: node.file,
    headingPath: [...node.headingPath],
    body: node.body,
    raw,
    contentHash: node.contentHash,
    tokens: node.tokens,
    meta: {
      globs: [...node.globs],
      specLinks: [...node.specLinks],
      pinned: node.pinned,
    },
    state: { ...state },
    reason,
    retentionAtDeath: scored.retention,
    buriedAtCommit: nowCommit,
    buriedAt: nowISO,
    position,
  };
  return defeatedBy === undefined ? base : { ...base, defeatedBy };
}
