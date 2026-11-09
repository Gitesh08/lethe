// NFR-1 / REQ-NFR-1 (requirement 6.1) performance benchmarks for lethe-core.
//
// Deviation from tasks.md 18.4: the task text puts this benchmark in
// test/decay.unit.test.ts. It lives in this separate file because that file is
// already large and another agent is editing test/ in parallel.
//
// Thresholds (medians, generous to survive parallel test load):
//   score()               500 engrams, 500 events  < 50 ms  (NFR-1, median of 15)
//   runConsolidation()    500 engrams, 2 files     < 500 ms (median of 5)
//   detectContradictions  500 engrams              < 300 ms (median of 5)
//   findDuplicates        500 engrams              < 150 ms (median of 5)
// All inputs come from a tiny LCG so runs are reproducible (no Math.random).
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { findDuplicates } from "../src/consolidate/dedupe.js";
import { runConsolidation } from "../src/consolidate/pipeline.js";
import { detectContradictions } from "../src/contradiction/detect.js";
import { eventMatches } from "../src/decay/match-event.js";
import { reinforce } from "../src/decay/reinforce.js";
import { score } from "../src/decay/score.js";
import type {
  EngramNode,
  EngramState,
  LedgerEvent,
  ScoredEngram,
  SpecInvariant,
  VirtualWorkspace,
} from "../src/types.js";

const N = 500;
const NOW_COMMIT = 1000;
const NOW_ISO = "2026-11-20T10:00:00.000Z";
const cfg = DEFAULT_CONFIG;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

const GLOB_POOL = ["src/**/*.ts", "apps/web/**", "packages/*/src/**", "docs/**/*.md", "**/*.css", "test/**"] as const;
const SPEC_NAMES = ["lethe-core", "lethe-mcp", "lethe-web-sandbox"] as const;
const PATHS = [
  "src/decay/score.ts", "apps/web/app/page.tsx", "packages/lethe-core/src/index.ts",
  "docs/notes.md", "apps/web/app/globals.css", "test/a.test.ts", "README.md", "scripts/x.sh",
] as const;
const SENTENCES = [
  "Use Redux for state management.", "Use Zustand for state management.", "Never use Tailwind for styling.",
  "Use Tailwind for styling.", "Prefer pnpm as the package manager.", "Use bun as the package manager.",
  "Run tests with Vitest.", "Run tests with Jest.", "Keep every file small and focused.",
  "Write clear commit messages and review the diff.", "Document public functions with short comments.",
  "Handle errors by returning a typed result.", "Throw exceptions for every failure.",
];

function body(rng: () => number, i: number): string {
  const target = 40 + Math.floor(rng() * 161);
  let text = `Rule ${i}: `;
  while (text.length < target) text += `${pick(rng, SENTENCES)} `;
  return text.slice(0, target).trimEnd();
}

function makeNodes(rng: () => number): EngramNode[] {
  return Array.from({ length: N }, (_, i) => {
    const text = body(rng, i);
    const nGlobs = rng() < 0.6 ? 1 + Math.floor(rng() * 2) : 0;
    return {
      id: `steering/f${i % 2}.md#s${i}`,
      file: `steering/f${i % 2}.md`,
      headingPath: [`Section ${i}`],
      body: text,
      contentHash: `h${i}`,
      tokens: Math.ceil(text.length / 4),
      globs: Array.from({ length: nGlobs }, () => pick(rng, GLOB_POOL)),
      specLinks: rng() < 0.3 ? [pick(rng, SPEC_NAMES)] : [],
      pinned: rng() < 0.1,
      span: { start: 0, end: text.length },
    };
  });
}

function makeStates(rng: () => number, nodes: readonly EngramNode[]): EngramState[] {
  return nodes.map((n) => ({
    id: n.id,
    stability: 5 + rng() * 40,
    lastReinforcedCommit: Math.floor(rng() * NOW_COMMIT),
    lastReinforcedAt: "2026-10-01T00:00:00.000Z",
    reinforcements: Math.floor(rng() * 5),
  }));
}

const SPECS: readonly SpecInvariant[] = [
  { specName: "lethe-core", active: true, requirementIds: ["REQ-DEC-1"], stances: ["state-management:redux"] },
  { specName: "lethe-mcp", active: true, requirementIds: ["REQ-MCP-1"], stances: [] },
  { specName: "lethe-web-sandbox", active: false, requirementIds: ["REQ-WEB-1"], stances: [] },
];

function makeLedger(rng: () => number, nodes: readonly EngramNode[]): LedgerEvent[] {
  const types = ["task_passed", "spec_cited", "manual_pin"] as const;
  let commit = 0;
  return Array.from({ length: N }, (_, i) => {
    commit += Math.floor(rng() * 3);
    const files = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => pick(rng, PATHS));
    const cited = [pick(rng, SPEC_NAMES), pick(rng, nodes).id];
    return {
      type: pick(rng, types),
      at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z`,
      commit: Math.min(commit, NOW_COMMIT),
      filesTouched: files,
      cited,
    };
  });
}

function makeWorkspace(rng: () => number): VirtualWorkspace {
  const files = new Map<string, string>();
  for (let f = 0; f < 2; f += 1) {
    let text = `# File ${f}\n\n`;
    for (let s = 0; s < N / 2; s += 1) {
      const idx = f * (N / 2) + s;
      const ann = rng() < 0.1 ? "<!-- lethe: pin=true -->\n" : rng() < 0.5 ? `<!-- lethe: globs=${pick(rng, GLOB_POOL)} -->\n` : "";
      text += `## Section ${idx}\n${ann}${body(rng, idx)}\n\n`;
    }
    files.set(`steering/f${f}.md`, text);
  }
  return { files, tombstones: [] };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function bench(runs: number, fn: () => unknown): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return median(times);
}

function fmt(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

describe("NFR-1 performance (500 engrams)", () => {
  const rng = makeRng(20261120);
  const nodes = makeNodes(rng);
  const states = makeStates(rng, nodes);
  const ledger = makeLedger(rng, nodes);
  const input = { engrams: nodes, states, specs: SPECS, ledger, nowCommit: NOW_COMMIT, nowISO: NOW_ISO, cfg };

  it("score() of 500 engrams with a 500-event ledger has median < 50 ms", () => {
    score(input);
    score(input);
    let last: ScoredEngram[] = [];
    const med = bench(15, () => {
      last = score(input);
    });
    console.info(`[perf] score(500 engrams, 500 events) median of 15: ${fmt(med)}`);
    expect(last).toHaveLength(N);
    for (const s of last) {
      expect(s.retention).toBeGreaterThan(0);
      expect(s.retention).toBeLessThanOrEqual(1);
      expect(["hot", "warm", "crypt"]).toContain(s.tier);
    }
    expect(med).toBeLessThan(50);
  });

  it("score() equals the brute-force eventMatches + reinforce reference (bit-identical states)", () => {
    const known = new Map(states.map((s) => [s.id, s] as const));
    const events = ledger.filter((e) => e.commit <= NOW_COMMIT);
    const out = new Map(score(input).map((s) => [s.node.id, s.state] as const));
    for (const node of nodes) {
      let st = known.get(node.id)!;
      for (const ev of events) if (eventMatches(node, ev)) st = reinforce(st, ev, cfg);
      expect(out.get(node.id)).toEqual(st);
    }
  });

  const scored = score(input);

  it("detectContradictions on 500 engrams has median < 300 ms", () => {
    detectContradictions(scored, SPECS);
    const med = bench(5, () => detectContradictions(scored, SPECS));
    console.info(`[perf] detectContradictions(500) median of 5: ${fmt(med)}`);
    expect(detectContradictions(scored, SPECS).ok).toBe(true);
    expect(med).toBeLessThan(300);
  });

  it("findDuplicates on 500 engrams has median < 150 ms", () => {
    findDuplicates(scored, cfg);
    const med = bench(5, () => findDuplicates(scored, cfg));
    console.info(`[perf] findDuplicates(500) median of 5: ${fmt(med)}`);
    expect(med).toBeLessThan(150);
  });

  it("runConsolidation on a 500-engram, 2-file workspace has median < 500 ms", () => {
    const workspace = makeWorkspace(makeRng(77));
    const pin = { workspace, states: [], specs: SPECS, ledger, nowCommit: NOW_COMMIT, nowISO: NOW_ISO, cfg };
    const first = runConsolidation(pin);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.scoredWorkspace.engrams).toHaveLength(N);
    const med = bench(5, () => runConsolidation(pin));
    console.info(`[perf] runConsolidation(500 engrams, 2 files) median of 5: ${fmt(med)}`);
    expect(med).toBeLessThan(500);
  });
});
