// Fixed fixture clock: the haunted repo lives on a 150-commit / 60-day timeline.
// Pure: derives every timestamp from a constant epoch with `Date.UTC` / `Date.parse`
// and `new Date(ms)` (never the wall clock). Refs: REQ-SBX-1, REQ-SBX-2, INV-7

/** The demo timeline: 150 commits across 60 days => 0.4 days per commit. */
export const NOW_COMMIT = 150;
export const DAYS_PER_COMMIT = 60 / 150;

const MS_PER_DAY = 86_400_000;
/** Commit 0 of the timeline (2026-09-21T12:00:00Z). */
const BASE_MS = Date.UTC(2026, 8, 21, 12, 0, 0, 0);

/** ISO timestamp of commit `commit` on the fixture timeline. */
export function isoAtCommit(commit: number): string {
  return new Date(BASE_MS + Math.round(commit * DAYS_PER_COMMIT * MS_PER_DAY)).toISOString();
}

/** Advance an ISO timestamp by `commits` fixture commits (an unparsable input is returned as-is). */
export function advanceISO(iso: string, commits: number): string {
  const base = Date.parse(iso);
  if (Number.isNaN(base)) return iso;
  return new Date(base + Math.round(commits * DAYS_PER_COMMIT * MS_PER_DAY)).toISOString();
}
