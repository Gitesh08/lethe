// Table tests for commit-counter resolution. Refs: Req 11.2, Req 11.3, Req 11.4
// COMMIT_BEFORE_CHECKPOINT (Req 23.13) is raised by the score tool, not by resolveCommitCounter.
import { describe, expect, it, vi } from "vitest";
import type { GitRunner } from "../src/io/git.js";
import { resolveCommitCounter, type CommitSource } from "../src/load/commit-counter.js";

const NOW = "2026-03-04T05:06:07.000Z";
const clock = (): (() => Date) => vi.fn(() => new Date(NOW));
const spyGit = (n: number | undefined) => {
  const commitCount = vi.fn(async (_root: string) => n);
  const git: GitRunner = { commitCount, changedFiles: async () => undefined };
  return { git, commitCount };
};
const spyFallbacks = (state: number | undefined, ledger: number | undefined) =>
  vi.fn(async () => ({ state, ledger }));

type Row = readonly [
  label: string,
  override: number | undefined,
  git: number | undefined,
  state: number | undefined,
  ledger: number | undefined,
  commit: number,
  source: CommitSource,
];

const rows: ReadonlyArray<Row> = [
  ["override beats everything", 7, 9, 50, 60, 7, "override"],
  ["override of zero is still an override", 0, 9, 50, 60, 0, "override"],
  ["git beats fallbacks", undefined, 12, 50, 60, 12, "git"],
  ["git reporting zero is a git value", undefined, 0, 50, 60, 0, "git"],
  ["state above ledger", undefined, undefined, 50, 40, 50, "state"],
  ["state equals ledger max (tie goes to state)", undefined, undefined, 45, 45, 45, "state"],
  ["ledger above state", undefined, undefined, 30, 40, 40, "ledger"],
  ["state only", undefined, undefined, 8, undefined, 8, "state"],
  ["ledger only", undefined, undefined, undefined, 6, 6, "ledger"],
  ["state zero, ledger absent", undefined, undefined, 0, undefined, 0, "state"],
  ["ledger zero, state absent", undefined, undefined, undefined, 0, 0, "zero"],
  ["nothing available", undefined, undefined, undefined, undefined, 0, "zero"],
];

describe("resolveCommitCounter table", () => {
  it.each(rows)("%s", async (_l, override, git, state, ledger, commit, source) => {
    const g = spyGit(git);
    const fb = spyFallbacks(state, ledger);
    const c = clock();
    const r = await resolveCommitCounter({ root: "/w", commit: override, git: g.git, clock: c, readFallbacks: fb });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ nowCommit: commit, commitSource: source, nowISO: NOW });
    const unavailable = source === "state" || source === "ledger" || source === "zero";
    expect(r.value.diagnostics.map((d) => d.code)).toEqual(unavailable ? ["GIT_COMMIT_COUNT_UNAVAILABLE"] : []);
    expect(g.commitCount).toHaveBeenCalledTimes(override === undefined ? 1 : 0);
    expect(fb).toHaveBeenCalledTimes(unavailable ? 1 : 0);
  });

  it("an override invokes neither git nor the fallback reader", async () => {
    const g = spyGit(5);
    const fb = spyFallbacks(1, 2);
    await resolveCommitCounter({ root: "/w", commit: 3, now: "2026-01-01T00:00:00Z", git: g.git, readFallbacks: fb });
    expect(g.commitCount).not.toHaveBeenCalled();
    expect(fb).not.toHaveBeenCalled();
  });

  it("passes the workspace root to git", async () => {
    const g = spyGit(5);
    await resolveCommitCounter({ root: "/some/root", git: g.git, clock: clock(), readFallbacks: spyFallbacks(0, 0) });
    expect(g.commitCount).toHaveBeenCalledWith("/some/root");
  });
});

describe("resolveCommitCounter invalid now", () => {
  it.each([
    ["missing zone", "2026-01-02T03:04:05"],
    ["impossible date", "2026-02-30T00:00:00Z"],
    ["lowercase t", "2026-01-02t03:04:05Z"],
    ["lowercase z", "2026-01-02T03:04:05z"],
    ["offset +24:00 with hour 24", "2026-01-02T24:00:00+24:00"],
    ["date only", "2026-01-02"],
    ["empty", ""],
  ])("%s -> INVALID_INPUT before git, fallbacks, or clock", async (_l, now) => {
    const g = spyGit(3);
    const fb = spyFallbacks(1, 1);
    const c = clock();
    const r = await resolveCommitCounter({ root: "/w", commit: 4, now, git: g.git, clock: c, readFallbacks: fb });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INVALID_INPUT");
    expect(g.commitCount).not.toHaveBeenCalled();
    expect(fb).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });
});
