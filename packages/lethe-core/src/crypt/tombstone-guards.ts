// Hand-written guards that narrow `unknown` into TombstoneRecord.
// Refs: REQ-CRY-1, REQ-CRY-3, INV-3
import type { EngramState, TombstoneRecord } from "../types.js";

type Rec = Readonly<Record<string, unknown>>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStrArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function optStr(r: Rec, key: string): boolean {
  return !(key in r) || typeof r[key] === "string";
}

function toState(v: unknown): EngramState | null {
  if (!isRec(v)) return null;
  const { id, stability, lastReinforcedCommit, lastReinforcedAt, reinforcements } = v;
  if (typeof id !== "string" || typeof lastReinforcedAt !== "string") return null;
  if (!isNum(stability) || !isNum(lastReinforcedCommit) || !isNum(reinforcements)) return null;
  return { id, stability, lastReinforcedCommit, lastReinforcedAt, reinforcements };
}

function toMeta(v: unknown): TombstoneRecord["meta"] | null {
  if (!isRec(v)) return null;
  const { globs, specLinks, pinned } = v;
  if (!isStrArray(globs) || !isStrArray(specLinks) || typeof pinned !== "boolean") return null;
  return { globs: [...globs], specLinks: [...specLinks], pinned };
}

function toPosition(v: unknown): TombstoneRecord["position"] | null {
  if (!isRec(v) || !isNum(v["index"]) || !optStr(v, "neighborBefore")) return null;
  const nb = v["neighborBefore"];
  return typeof nb === "string" ? { index: v["index"], neighborBefore: nb } : { index: v["index"] };
}

function isReason(v: unknown): v is TombstoneRecord["reason"] {
  return v === "decayed" || v === "contradiction" || v === "duplicate";
}

interface Texts {
  readonly id: string;
  readonly file: string;
  readonly body: string;
  readonly raw: string;
  readonly contentHash: string;
  readonly buriedAt: string;
}

interface Nums {
  readonly tokens: number;
  readonly retentionAtDeath: number;
  readonly buriedAtCommit: number;
}

function toTexts(v: Rec): Texts | null {
  const { id, file, body, raw, contentHash, buriedAt } = v;
  if (typeof id !== "string" || typeof file !== "string" || typeof body !== "string") return null;
  if (typeof raw !== "string" || typeof contentHash !== "string" || typeof buriedAt !== "string") return null;
  return { id, file, body, raw, contentHash, buriedAt };
}

function toNums(v: Rec): Nums | null {
  const { tokens, retentionAtDeath, buriedAtCommit } = v;
  if (!isNum(tokens) || !isNum(retentionAtDeath) || !isNum(buriedAtCommit)) return null;
  return { tokens, retentionAtDeath, buriedAtCommit };
}

interface Parts {
  readonly meta: TombstoneRecord["meta"];
  readonly state: EngramState;
  readonly position: TombstoneRecord["position"];
}

function toParts(v: Rec): Parts | null {
  const meta = toMeta(v["meta"]);
  const state = toState(v["state"]);
  const position = toPosition(v["position"]);
  return meta === null || state === null || position === null ? null : { meta, state, position };
}

/** Returns the narrowed record or a human-readable problem description. */
export function toTombstoneRecord(v: unknown): TombstoneRecord | string {
  if (!isRec(v)) return "tombstone is not an object";
  if (v["schema"] !== 1) return `unsupported tombstone schema ${JSON.stringify(v["schema"])}`;
  const t = toTexts(v);
  if (t === null) return "tombstone has a missing or non-string text field";
  const n = toNums(v);
  if (n === null) return "tombstone has a missing or non-numeric number field";
  const { headingPath, reason } = v;
  if (!isStrArray(headingPath) || !isReason(reason) || !optStr(v, "defeatedBy")) return "tombstone has an invalid headingPath, reason or defeatedBy";
  const parts = toParts(v);
  if (parts === null) return "tombstone has an invalid meta, state or position";
  const { meta, state, position } = parts;
  const base: TombstoneRecord = {
    schema: 1, id: t.id, file: t.file, headingPath: [...headingPath], body: t.body, raw: t.raw,
    contentHash: t.contentHash, tokens: n.tokens, meta, state, reason,
    retentionAtDeath: n.retentionAtDeath, buriedAtCommit: n.buriedAtCommit, buriedAt: t.buriedAt, position,
  };
  const db = v["defeatedBy"];
  return typeof db === "string" ? { ...base, defeatedBy: db } : base;
}
