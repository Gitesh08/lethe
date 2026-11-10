// Serializer for .kiro/lethe/state.json (engrams keyed by id, ascending). Refs: Req 10.7, Req 10.12
import type { EngramState } from "@lethe/core";
import type { LedgerCursor } from "./ledger-cursor.js";
import { KEY_ORDERS, stableStringify } from "./stable-json.js";

export interface StateFileData {
  readonly commit: number;
  readonly at: string;
  readonly ledger: LedgerCursor;
  readonly engrams: ReadonlyArray<EngramState>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Byte-deterministic state.json text; engrams sorted by id (code-unit order), id used as the key. */
export function serializeState(data: StateFileData): string {
  const sorted = [...data.engrams].sort((x, y) => byCodeUnit(x.id, y.id));
  // Null prototype: an id of "__proto__" must become an own key, not set the prototype.
  const engrams: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const s of sorted) {
    engrams[s.id] = {
      stability: s.stability,
      lastReinforcedCommit: s.lastReinforcedCommit,
      lastReinforcedAt: s.lastReinforcedAt,
      reinforcements: s.reinforcements,
    };
  }
  const doc = {
    version: 1,
    commit: data.commit,
    at: data.at,
    ledger: {
      lines: data.ledger.lines,
      bytes: data.ledger.bytes,
      lastLineSha256: data.ledger.lastLineSha256,
    },
    engrams,
  };
  return stableStringify(doc, KEY_ORDERS.state);
}
