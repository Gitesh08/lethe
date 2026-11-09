// Per-file half of applyPlan: validate entries against the CURRENT file text,
// build tombstones, and cut the spans out (last to first so offsets stay valid).
// Pure and total: problems are returned as `skipped`, never thrown.
// Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-6, INV-1, INV-3, INV-7
import { parseDocument } from "../parse/document.js";
import type { EngramNode, LetheConfig, ScoredEngram, TombstoneRecord } from "../types.js";
import { toTombstone } from "./archive.js";

export type SkipReason =
  | "file-missing"
  | "span-mismatch"
  | "parse-failed"
  | "duplicate-entry"
  | "protected";

export interface Skipped {
  readonly id: string;
  readonly reason: SkipReason;
}

/** One engram scheduled for burial (already flattened from toArchive / toMerge). */
export interface BuryEntry {
  readonly scored: ScoredEngram;
  readonly reason: TombstoneRecord["reason"];
  readonly defeatedBy?: string;
}

export interface FileOutcome {
  readonly text: string;
  readonly tombstones: readonly TombstoneRecord[];
  readonly skipped: readonly Skipped[];
}

interface Accepted {
  readonly entry: BuryEntry;
  readonly index: number;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

function skipAll(entries: readonly BuryEntry[], reason: SkipReason): Skipped[] {
  return entries.map((e) => ({ id: e.scored.node.id, reason }));
}

/** Staleness check: the engram must still exist with the same span and body. */
function isFresh(live: EngramNode | undefined, planned: EngramNode, text: string): live is EngramNode {
  if (live === undefined) return false;
  if (live.span.start !== planned.span.start || live.span.end !== planned.span.end) return false;
  return live.body === planned.body && text.slice(live.span.start, live.span.end).endsWith(planned.body);
}

function locate(
  engrams: readonly EngramNode[],
  text: string,
  entries: readonly BuryEntry[],
): { accepted: Accepted[]; skipped: Skipped[] } {
  const accepted: Accepted[] = [];
  const skipped: Skipped[] = [];
  for (const entry of entries) {
    const planned = entry.scored.node;
    const index = engrams.findIndex((g) => g.id === planned.id);
    const live = engrams[index];
    if (index < 0 || !isFresh(live, planned, text)) {
      skipped.push({ id: planned.id, reason: "span-mismatch" });
      continue;
    }
    const { start, end } = live.span;
    accepted.push({ entry, index, raw: text.slice(start, end), start, end });
  }
  return { accepted, skipped };
}

/** Descending by start; an entry overlapping an already-kept later span is skipped. */
function dropOverlaps(accepted: readonly Accepted[]): { kept: Accepted[]; skipped: Skipped[] } {
  const sorted = [...accepted].sort((a, b) => b.start - a.start || b.end - a.end);
  const kept: Accepted[] = [];
  const skipped: Skipped[] = [];
  let boundary = Number.POSITIVE_INFINITY;
  for (const a of sorted) {
    if (a.end > boundary) {
      skipped.push({ id: a.entry.scored.node.id, reason: "span-mismatch" });
      continue;
    }
    kept.push(a);
    boundary = a.start;
  }
  return { kept, skipped };
}

/**
 * Apply all entries of one file. `text` undefined means the file is not in the
 * workspace. On any file-level failure the text is returned untouched.
 */
export function processFile(
  file: string,
  text: string | undefined,
  entries: readonly BuryEntry[],
  nowCommit: number,
  nowISO: string,
  cfg: LetheConfig,
): FileOutcome {
  if (text === undefined) return { text: "", tombstones: [], skipped: skipAll(entries, "file-missing") };
  const parsed = parseDocument(file, text, cfg);
  if (!parsed.ok) return { text, tombstones: [], skipped: skipAll(entries, "parse-failed") };

  const engrams = parsed.value.engrams;
  const found = locate(engrams, text, entries);
  const { kept, skipped: overlapped } = dropOverlaps(found.accepted);

  let out = text;
  const tombstones: TombstoneRecord[] = [];
  for (const a of kept) {
    const neighborBefore = a.index > 0 ? engrams[a.index - 1]?.id : undefined;
    tombstones.push(
      toTombstone(
        a.entry.scored, a.entry.reason, nowCommit, nowISO,
        a.index, a.raw, neighborBefore, a.entry.defeatedBy,
      ),
    );
    out = out.slice(0, a.start) + out.slice(a.end);
  }
  return { text: out, tombstones, skipped: [...found.skipped, ...overlapped] };
}
