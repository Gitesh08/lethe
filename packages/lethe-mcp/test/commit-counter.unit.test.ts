// Refs: Req 11.1, Req 11.2, Req 11.3, Req 11.4
import { ok } from "@lethe/core";
import { describe, expect, it, vi } from "vitest";
import type { GitRunner } from "../src/io/git.js";
import type { WorkspaceFs } from "../src/io/workspace-fs.js";
import { fsFallbackReader, isIsoInstant, resolveCommitCounter } from "../src/load/commit-counter.js";

const gitOf = (n: number | undefined): GitRunner & { calls: number } => {
  const g = { calls: 0, commitCount: async () => { g.calls++; return n; }, changedFiles: async () => undefined };
  return g;
};
const clock = (): (() => Date) => vi.fn(() => new Date("2026-01-02T03:04:05.000Z"));
const fb = (state: number | undefined, ledger: number | undefined) => async () => ({ state, ledger });
const base = { root: "/w" };

describe("resolveCommitCounter", () => {
  it("override wins and never runs git or fallbacks", async () => {
    const git = gitOf(9);
    const readFallbacks = vi.fn(fb(1, 2));
    const r = await resolveCommitCounter({ ...base, commit: 7, git, clock: clock(), readFallbacks });
    expect(r.ok && r.value).toMatchObject({ nowCommit: 7, commitSource: "override", diagnostics: [] });
    expect(git.calls).toBe(0);
    expect(readFallbacks).not.toHaveBeenCalled();
  });

  it("uses git when available, reading the clock exactly once", async () => {
    const c = clock();
    const readFallbacks = vi.fn(fb(1, 2));
    const r = await resolveCommitCounter({ ...base, git: gitOf(12), clock: c, readFallbacks });
    expect(r.ok && r.value).toMatchObject({ nowCommit: 12, commitSource: "git", nowISO: "2026-01-02T03:04:05.000Z" });
    expect(c).toHaveBeenCalledTimes(1);
    expect(readFallbacks).not.toHaveBeenCalled();
  });

  it("does not read the clock when now is given", async () => {
    const c = clock();
    const r = await resolveCommitCounter({ ...base, now: "2026-05-05T00:00:00Z", git: gitOf(1), clock: c, readFallbacks: fb(0, 0) });
    expect(r.ok && r.value.nowISO).toBe("2026-05-05T00:00:00Z");
    expect(c).not.toHaveBeenCalled();
  });

  it.each([
    [40, 30, 40, "state"],
    [30, 40, 40, "ledger"],
    [undefined, 5, 5, "ledger"],
    [5, undefined, 5, "state"],
    [undefined, undefined, 0, "zero"],
    [undefined, 0, 0, "zero"],
  ] as const)("git unavailable: state=%s ledger=%s -> %s via %s", async (state, ledger, commit, source) => {
    const r = await resolveCommitCounter({ ...base, git: gitOf(undefined), clock: clock(), readFallbacks: fb(state, ledger) });
    expect(r.ok && r.value).toMatchObject({ nowCommit: commit, commitSource: source });
    expect(r.ok && r.value.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["GIT_COMMIT_COUNT_UNAVAILABLE", "git commit count unavailable"],
    ]);
  });

  it("rejects an invalid now with INVALID_INPUT before running git", async () => {
    const git = gitOf(3);
    const r = await resolveCommitCounter({ ...base, now: "2026-01-01", git, readFallbacks: fb(0, 0) });
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
    expect(git.calls).toBe(0);
  });
});

describe("isIsoInstant", () => {
  it.each(["2026-01-02T03:04:05Z", "2026-01-02T03:04:05.123+05:30", "2024-02-29T00:00:00-01:00"])("accepts %s", (s) => {
    expect(isIsoInstant(s)).toBe(true);
  });
  it.each(["2026-01-02", "2026-01-02T03:04:05", "2026-02-30T00:00:00Z", "2026-01-02T24:00:00Z", "2025-02-29T00:00:00Z", "x"])("rejects %s", (s) => {
    expect(isIsoInstant(s)).toBe(false);
  });
});

describe("fsFallbackReader", () => {
  it("reads state commit and highest ledger commit; absent files give undefined", async () => {
    const files: Record<string, string> = {
      ".kiro/lethe/ledger.jsonl":
        '{"type":"task_passed","at":"2026-01-01T00:00:00Z","commit":4}\n{"type":"manual_pin","at":"2026-01-01T00:00:00Z","commit":9}\n',
    };
    const fsx = {
      readText: async (p: string) => ok(files[p]),
      readBytes: async (p: string) => ok(files[p] === undefined ? undefined : new TextEncoder().encode(files[p])),
    } as unknown as WorkspaceFs;
    expect(await fsFallbackReader(fsx)()).toEqual({ state: undefined, ledger: 9 });
  });
});
