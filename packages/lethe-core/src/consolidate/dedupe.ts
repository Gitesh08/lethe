// Near-duplicate resolution for consolidation.
// Refs: REQ-CRY-5 (requirement 4.9), INV-1, INV-4, P8, P9
import type { LetheConfig, ScoredEngram } from "../types.js";
import { jaccardSets, tokenize } from "./jaccard.js";

export interface DupePair {
  readonly keep: ScoredEngram;
  readonly drop: ScoredEngram;
  readonly similarity: number;
}

interface Entry {
  readonly e: ScoredEngram;
  readonly set: ReadonlySet<string>;
}

interface Candidate {
  readonly a: Entry; // a.e.node.id < b.e.node.id
  readonly b: Entry;
  readonly similarity: number;
}

function byId(x: Entry, y: Entry): number {
  return x.e.node.id < y.e.node.id ? -1 : x.e.node.id > y.e.node.id ? 1 : 0;
}

function byCandidate(x: Candidate, y: Candidate): number {
  if (x.similarity !== y.similarity) return x.similarity > y.similarity ? -1 : 1;
  const xa = x.a.e.node.id;
  const ya = y.a.e.node.id;
  if (xa !== ya) return xa < ya ? -1 : 1;
  const xb = x.b.e.node.id;
  const yb = y.b.e.node.id;
  return xb < yb ? -1 : xb > yb ? 1 : 0;
}

function buildEntries(scored: readonly ScoredEngram[]): readonly Entry[] {
  const out: Entry[] = [];
  for (const e of scored) {
    const set = tokenize(e.node.body);
    if (set.size > 0) out.push({ e, set });
  }
  // Total order on id makes the scan independent of input order. Engrams that
  // share an id are never paired with each other, so their relative order
  // cannot influence any emitted pair other than through identical ids.
  return out.sort(byId);
}

/** Pair test shared by the indexed and the exhaustive paths; null when not a candidate. */
function evaluate(a: Entry, b: Entry, threshold: number): Candidate | null {
  if (a.e.node.id === b.e.node.id) return null;
  if (a.e.protected && b.e.protected) return null; // both protected: ignored
  const lo = Math.min(a.set.size, b.set.size);
  const hi = Math.max(a.set.size, b.set.size);
  if (lo / hi < threshold) return null; // jaccard <= min/max, unreachable
  const similarity = jaccardSets(a.set, b.set);
  return similarity >= threshold ? { a, b, similarity } : null;
}

/** token -> ascending entry indexes containing it. */
function buildPostings(entries: readonly Entry[]): ReadonlyMap<string, readonly number[]> {
  const postings = new Map<string, number[]>();
  entries.forEach((entry, idx) => {
    for (const tok of entry.set) {
      const list = postings.get(tok);
      if (list === undefined) postings.set(tok, [idx]);
      else list.push(idx);
    }
  });
  return postings;
}

/** Indexes j > i sharing >= 1 token with entry i. Disjoint sets have similarity 0. */
function sharingLater(
  entry: Entry,
  i: number,
  postings: ReadonlyMap<string, readonly number[]>,
): readonly number[] {
  const out = new Set<number>();
  for (const tok of entry.set) {
    for (const j of postings.get(tok) ?? []) {
      if (j > i) out.add(j);
    }
  }
  // Ascending j reproduces the exhaustive scan order, which matters for stable-sort ties
  // between same-id twins.
  return [...out].sort((x, y) => x - y);
}

/**
 * Candidate generation via an inverted index. With threshold > 0 a pair with no
 * shared token has similarity 0 and can never qualify, so skipping it is lossless;
 * for threshold <= 0 every pair qualifies and we scan exhaustively.
 * The result is totally ordered by `byCandidate`, so scan order cannot matter.
 */
function collectCandidates(entries: readonly Entry[], threshold: number): readonly Candidate[] {
  const out: Candidate[] = [];
  const postings = threshold > 0 ? buildPostings(entries) : undefined;
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    if (a === undefined) continue;
    const others: Iterable<number> =
      postings === undefined
        ? Array.from({ length: entries.length - i - 1 }, (_, k) => i + 1 + k)
        : sharingLater(a, i, postings);
    for (const j of others) {
      const b = entries[j];
      const c = b === undefined ? null : evaluate(a, b, threshold);
      if (c !== null) out.push(c);
    }
  }
  return out.sort(byCandidate);
}

/** True when `x` should be kept over `y`. A protected engram always wins. */
function keepsOver(x: ScoredEngram, y: ScoredEngram): boolean {
  if (x.protected !== y.protected) return x.protected;
  if (x.retention !== y.retention) return x.retention > y.retention;
  return x.node.id < y.node.id;
}

/**
 * Find near-duplicate pairs (Jaccard >= cfg.dedupeJaccard, exact comparison).
 *
 * Extension of the task text ("scan over non-protected"): a protected engram
 * may be the `keep` side and absorb an unprotected duplicate, but is never the
 * `drop` side (INV-1). A pair of two protected engrams is ignored. Callers
 * must pre-filter engrams whose status is "defeated" or "duplicate".
 *
 * Resolution is greedy over pairs ordered by similarity descending (ties by
 * ascending lower id, then higher id). Once an engram is dropped it is never
 * revisited, so the surviving set contains no resolvable pair with
 * similarity >= threshold; this is what makes consolidation idempotent (P8).
 * A previously kept engram may later be dropped by a better one.
 * Output is in resolution order and independent of input order (P9).
 */
export function findDuplicates(
  scored: readonly ScoredEngram[],
  cfg: LetheConfig,
): readonly DupePair[] {
  const candidates = collectCandidates(buildEntries(scored), cfg.dedupeJaccard);
  const dropped = new Set<string>();
  const pairs: DupePair[] = [];
  for (const c of candidates) {
    const aId = c.a.e.node.id;
    const bId = c.b.e.node.id;
    if (dropped.has(aId) || dropped.has(bId)) continue;
    const aKeeps = keepsOver(c.a.e, c.b.e);
    const keep = aKeeps ? c.a.e : c.b.e;
    const drop = aKeeps ? c.b.e : c.a.e;
    dropped.add(drop.node.id);
    pairs.push({ keep, drop, similarity: c.similarity });
  }
  return pairs;
}
