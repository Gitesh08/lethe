// Consumable_Prefix selection and cursor advance. Pure. Refs: Req 23.1, Req 23.3
import type { LedgerEvent } from "@lethe/core";
import { hashLedgerSpan, type LedgerLine, type LedgerRead } from "../load/ledger-file.js";
import type { LedgerCursor } from "./ledger-cursor.js";

export interface PrefixResult {
  readonly events: ReadonlyArray<LedgerEvent>;
  readonly cursor: LedgerCursor;
}

/** Longest leading run of tail lines whose events have commit <= nowCommit (blank/skipped lines are consumable). */
export function selectPrefix(tail: ReadonlyArray<LedgerLine>, nowCommit: number): ReadonlyArray<LedgerLine> {
  const stop = tail.findIndex((l) => l.event !== null && l.event.commit > nowCommit);
  return stop === -1 ? tail : tail.slice(0, stop);
}

/** Cursor after the prefix; unchanged when nothing was consumed. Hash is over the last consumed line's bytes. */
export function advanceCursor(
  prefix: ReadonlyArray<LedgerLine>,
  from: LedgerCursor,
  bytes: Uint8Array,
): LedgerCursor {
  const last = prefix[prefix.length - 1];
  if (last === undefined) return from;
  const prev = prefix[prefix.length - 2];
  const start = prev === undefined ? from.bytes : prev.endByte;
  return { lines: last.lineNo, bytes: last.endByte, lastLineSha256: hashLedgerSpan(bytes, start, last.endByte) };
}

export function prefixEvents(prefix: ReadonlyArray<LedgerLine>): ReadonlyArray<LedgerEvent> {
  const out: LedgerEvent[] = [];
  for (const l of prefix) if (l.event !== null) out.push(l.event);
  return out;
}

/** Convenience: the whole prefix step for a non-rewritten ledger read. */
export function consumePrefix(read: LedgerRead, from: LedgerCursor, bytes: Uint8Array, nowCommit: number): PrefixResult {
  const prefix = selectPrefix(read.tail, nowCommit);
  return { events: prefixEvents(prefix), cursor: advanceCursor(prefix, from, bytes) };
}
