// Unit tests for the seeded haunted-repo fixture. Refs: REQ-SBX-1, REQ-SBX-2
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { consolidateOnce, runConsolidation, scoreWorkspace } from "../src/consolidate/pipeline.js";
import type { PipelineResult } from "../src/consolidate/pipeline.js";
import { resurrect } from "../src/crypt/resurrect.js";
import { DEMO_SEED, generateHauntedRepo, measureTokens, scrubTo } from "../src/fixtures/index.js";
import type { HauntedRepo } from "../src/fixtures/index.js";
import { parseDocument } from "../src/parse/document.js";
import type { TombstoneRecord, VirtualWorkspace } from "../src/types.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PLANTED_AXES = ["css-approach", "error-handling", "module-system", "state-management"];
const cfg = DEFAULT_CONFIG;

function repoOf(seed: number): HauntedRepo {
  return generateHauntedRepo(seed, cfg);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Map ? { map: [...v.entries()] } : v));
}

function run(repo: HauntedRepo): PipelineResult {
  const r = runConsolidation(repo);
  if (!r.ok) throw new Error(`pipeline failed: ${r.error.message}`);
  return r.value;
}

function buried(repo: HauntedRepo): number {
  const r = run(repo);
  return r.plan.toArchive.length + r.plan.toMerge.length;
}

describe("determinism (REQ-SBX-1)", () => {
  it("same seed gives byte-identical JSON; different seeds differ but stay valid", () => {
    expect(toJson(repoOf(1))).toBe(toJson(repoOf(1)));
    expect(toJson(repoOf(1))).not.toBe(toJson(repoOf(2)));
    for (const seed of [1, 2]) {
      const sw = scoreWorkspace(repoOf(seed));
      expect(sw.parseErrors).toEqual([]);
      expect(sw.engrams.length).toBeGreaterThanOrEqual(44);
    }
  });

  it("exports the documented demo seed", () => {
    expect(DEMO_SEED).toBe(1);
  });
});

describe("structure holds for every seed (REQ-SBX-1)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: files parse, 44-48 engrams, planted items present`, () => {
      const repo = repoOf(seed);
      expect(repo.workspace.files.size).toBe(6);
      for (const [file, text] of repo.workspace.files) {
        expect(text).not.toContain("\r");
        expect(parseDocument(file, text, cfg).ok).toBe(true);
      }
      const sw = scoreWorkspace(repo);
      expect(sw.parseErrors).toEqual([]);
      expect(sw.engrams.length).toBeGreaterThanOrEqual(44);
      expect(sw.engrams.length).toBeLessThanOrEqual(48);
      expect(repo.states).toHaveLength(sw.engrams.length);
      expect(repo.specs.filter((s) => s.active)).toHaveLength(3);
      expect(repo.ledger.length).toBeGreaterThanOrEqual(40);
      expect(repo.ledger.length).toBeLessThanOrEqual(80);

      const stale = sw.scored.filter((s) => !s.protected && s.retention < cfg.cryptMax);
      expect(stale.length).toBeGreaterThanOrEqual(6);

      const r = run(repo);
      const axes = new Set(r.reports.map((x) => x.axis));
      for (const axis of PLANTED_AXES) expect(axes.has(axis)).toBe(true);
      expect([...axes].sort()).toEqual(PLANTED_AXES);
      expect(r.reports.length).toBeGreaterThanOrEqual(3);
      expect(r.plan.toMerge.length).toBeGreaterThanOrEqual(2);
      expect(r.applied.skipped).toEqual([]);
    });
  }
});

describe("contradictions, protection and dedupe", () => {
  const repo = repoOf(DEMO_SEED);
  const r = run(repo);
  const byId = new Map(r.scoredWorkspace.scored.map((s) => [s.node.id, s]));

  it("has a protected winner and a stale loser", () => {
    const resolved = r.reports.flatMap((x) => (x.resolution.kind === "resolved" ? [x.resolution] : []));
    expect(resolved.some((x) => byId.get(x.winner)?.protected === true)).toBe(true);
    expect(resolved.some((x) => {
      const loser = byId.get(x.loser);
      return loser !== undefined && !loser.protected && loser.retention < cfg.cryptMax;
    })).toBe(true);
    expect(r.reports.every((x) => x.resolution.kind === "resolved")).toBe(true);
  });

  it("pinned and spec-linked engrams exist and are never archived or merged away", () => {
    const protectedIds = r.scoredWorkspace.scored.filter((s) => s.protected).map((s) => s.node.id);
    expect(protectedIds.length).toBeGreaterThanOrEqual(8);
    expect(r.scoredWorkspace.scored.some((s) => s.node.pinned)).toBe(true);
    expect(r.scoredWorkspace.scored.some((s) => s.node.specLinks.length > 0)).toBe(true);
    const gone = new Set([...r.plan.toArchive.map((a) => a.engram.node.id), ...r.plan.toMerge.map((m) => m.drop.node.id)]);
    for (const id of protectedIds) expect(gone.has(id)).toBe(false);
    for (const s of r.scoredWorkspace.scored.filter((x) => x.protected)) expect(s.retention).toBeGreaterThanOrEqual(0.5);
  });

  it("contradiction losers are archived with reason contradiction", () => {
    const reasons = r.plan.toArchive.filter((a) => a.reason === "contradiction");
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("consolidation round trips (INV-3, INV-4)", () => {
  const repo = repoOf(DEMO_SEED);

  it("consolidateOnce is idempotent", () => {
    const once = consolidateOnce(repo);
    if (!once.ok) throw new Error("first pass failed");
    const twice = consolidateOnce(once.value);
    if (!twice.ok) throw new Error("second pass failed");
    const third = run(once.value);
    expect(third.plan.toArchive).toEqual([]);
    expect(third.plan.toMerge).toEqual([]);
    expect(toJson(twice.value.workspace)).toBe(toJson(once.value.workspace));
  });

  it("resurrecting every tombstone in ascending order restores every file byte-for-byte", () => {
    const applied = run(repo).applied.workspace;
    expect(applied.tombstones.length).toBeGreaterThanOrEqual(10);
    const ordered: TombstoneRecord[] = [...applied.tombstones].sort(
      (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.position.index - b.position.index,
    );
    let ws: VirtualWorkspace = applied;
    for (const tomb of ordered) {
      const back = resurrect(ws, tomb, repo.nowCommit, repo.nowISO, cfg);
      if (!back.ok) throw new Error(`resurrect failed: ${back.error.code} ${back.error.message}`);
      ws = back.value.workspace;
    }
    expect(ws.tombstones).toEqual([]);
    for (const [file, text] of repo.workspace.files) expect(ws.files.get(file)).toBe(text);
  });
});

describe("scrubTo (REQ-SBX-2)", () => {
  const repo = repoOf(DEMO_SEED);

  it("+0 is the identity and the clock advances 60/150 days per commit", () => {
    expect(scrubTo(repo, 0)).toEqual(repo);
    const later = scrubTo(repo, 150);
    expect(later.nowCommit).toBe(repo.nowCommit + 150);
    expect(Date.parse(later.nowISO) - Date.parse(repo.nowISO)).toBe(60 * 86_400_000);
    expect(later.workspace).toBe(repo.workspace);
    expect(later.ledger).toBe(repo.ledger);
  });

  it("+150 decays more: mean retention drops and more is buried", () => {
    const mean = (r: HauntedRepo): number => {
      const s = scoreWorkspace(r).scored;
      return s.reduce((acc, x) => acc + x.retention, 0) / s.length;
    };
    expect(mean(scrubTo(repo, 150))).toBeLessThan(mean(repo));
    expect(buried(scrubTo(repo, 150))).toBeGreaterThan(buried(repo));
  });

  it("buried count never decreases as the scrubber advances", () => {
    const counts = [0, 25, 50, 100, 150].map((n) => buried(scrubTo(repo, n)));
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i] ?? 0).toBeGreaterThanOrEqual(counts[i - 1] ?? 0);
    }
  });
});

describe("demo token metric (PRD section 10)", () => {
  it("default seed lands in the documented bounds", () => {
    const m = measureTokens(repoOf(DEMO_SEED));
    expect(m.fileTokens).toBeGreaterThanOrEqual(4500);
    expect(m.fileTokens).toBeLessThanOrEqual(5200);
    expect(m.hotAfterSleep).toBeLessThanOrEqual(1300);
    expect(m.hotBefore).toBeGreaterThanOrEqual(m.hotAfterSleep);
    expect(m.savedPercent).toBeGreaterThanOrEqual(70);
    expect(m.savedPercent).toBe(Math.round(((m.fileTokens - m.hotAfterSleep) / m.fileTokens) * 1000) / 10);
  });

  it("holds for every checked seed", () => {
    for (const seed of SEEDS) {
      const m = measureTokens(repoOf(seed));
      expect(m.fileTokens).toBeGreaterThanOrEqual(4500);
      expect(m.hotAfterSleep).toBeLessThanOrEqual(1300);
      expect(m.savedPercent).toBeGreaterThanOrEqual(70);
    }
  });
});

describe("fixture source hygiene (INV-7)", () => {
  const dir = new URL("../src/fixtures/", import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("uses no Math.random, Date.now or argument-less new Date()", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const name of sources) {
      const text = readFileSync(new URL(name, dir), "utf8");
      expect(text, name).not.toMatch(/Math\.random|Date\.now|new Date\(\s*\)/);
    }
  });

  it("keeps every file within 200 lines", () => {
    for (const name of sources) {
      const lines = readFileSync(new URL(name, dir), "utf8").split("\n").length;
      expect(lines, name).toBeLessThanOrEqual(200);
    }
  });
});
