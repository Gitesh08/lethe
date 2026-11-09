// Unit tests for the consolidation pipeline. Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-4, INV-1, INV-4
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { consolidateOnce, runConsolidation, scoreWorkspace } from "../src/consolidate/pipeline.js";
import type { PipelineInput, PipelineResult } from "../src/consolidate/pipeline.js";
import type { EngramState } from "../src/types.js";

const NOW = "2026-03-01T00:00:00.000Z";
const NOW_COMMIT = 100;
const A = ".kiro/steering/a.md";
const B = ".kiro/steering/b.md";
const BAD = ".kiro/steering/bad.md";
const BAD_TEXT = "---\nunterminated: true\n## Orphan\nnever parsed\n";

const A_TEXT = [
  "# A",
  "## Stale",
  "Keep functions small and tidy.",
  "## Pinned",
  "<!-- lethe: pin=true -->",
  "An old but pinned rule about naming.",
  "## DupOne",
  "The quick brown fox jumps over the lazy dog today.",
  "## DupTwo",
  "The quick brown fox jumps over the lazy dog today.",
  "",
].join("\n");
const B_TEXT = ["## Signals", "Use signals for state.", "## Redux", "Use Redux for state.", ""].join("\n");

function state(id: string, stability: number, commit: number): EngramState {
  return { id, stability, lastReinforcedCommit: commit, lastReinforcedAt: NOW, reinforcements: 0 };
}

function idOf(file: string, heading: string): string {
  return `${file}#${heading}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function makeInput(extra: Partial<PipelineInput> = {}): PipelineInput {
  return {
    workspace: {
      files: new Map([[A, A_TEXT], [B, B_TEXT], [BAD, BAD_TEXT]]),
      tombstones: [],
    },
    states: [
      state(idOf(A, "Stale"), 0.5, 0),
      state(idOf(A, "Pinned"), 0.5, 0),
      state(idOf(A, "DupOne"), 5, NOW_COMMIT),
      state(idOf(A, "DupTwo"), 5, NOW_COMMIT),
      state(idOf(B, "Signals"), 5, NOW_COMMIT),
      state(idOf(B, "Redux"), 50, 90),
    ],
    specs: [],
    ledger: [],
    nowCommit: NOW_COMMIT,
    nowISO: NOW,
    cfg: DEFAULT_CONFIG,
    ...extra,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !(value instanceof Map) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function run(input: PipelineInput): PipelineResult {
  const r = runConsolidation(input);
  if (!r.ok) throw new Error(`pipeline failed: ${r.error.message}`);
  return r.value;
}

describe("scoreWorkspace", () => {
  it("lists unparseable files in parseErrors and contributes no engrams from them", () => {
    const sw = scoreWorkspace(makeInput());
    expect(sw.parseErrors.map((p) => [p.file, p.error.code])).toEqual([[BAD, "PARSE_INVALID_FRONTMATTER"]]);
    expect(sw.engrams.every((e) => e.file !== BAD)).toBe(true);
    expect(sw.engrams).toHaveLength(6);
    expect(sw.configError).toBeUndefined();
  });

  it("reports configError for a bad cfg and returns nothing scored", () => {
    const sw = scoreWorkspace(makeInput({ cfg: { ...DEFAULT_CONFIG, s0: -1 } }));
    expect(sw.configError?.code).toBe("CONFIG_INVALID");
    expect(sw.scored).toEqual([]);
    expect(sw.engrams).toEqual([]);
    expect(runConsolidation(makeInput({ cfg: { ...DEFAULT_CONFIG, s0: -1 } })).ok).toBe(false);
  });
});

describe("runConsolidation", () => {
  it("archives stale, duplicate and contradiction loser but never the pinned engram", () => {
    const r = run(makeInput());
    const archived = new Map(r.plan.toArchive.map((a) => [a.engram.node.id, a.reason]));
    expect(archived.get(idOf(A, "Stale"))).toBe("decayed");
    expect(archived.get(idOf(B, "Redux"))).toBe("contradiction");
    expect(archived.has(idOf(A, "Pinned"))).toBe(false);
    expect(r.plan.toMerge).toHaveLength(1);
    const dropped = r.plan.toMerge[0]?.drop.node.id ?? "";
    expect([idOf(A, "DupOne"), idOf(A, "DupTwo")]).toContain(dropped);
    expect(r.reports.length).toBeGreaterThan(0);
  });

  it("removes the buried spans, records tombstones and leaves other files untouched", () => {
    const input = makeInput();
    const r = run(input);
    const aText = r.applied.workspace.files.get(A) ?? "";
    const bText = r.applied.workspace.files.get(B) ?? "";
    expect(aText).not.toContain("## Stale");
    expect(aText).toContain("## Pinned");
    expect(aText.includes("## DupOne") !== aText.includes("## DupTwo")).toBe(true);
    expect(bText).toContain("## Signals");
    expect(bText).not.toContain("## Redux");
    expect(r.applied.workspace.files.get(BAD)).toBe(BAD_TEXT);
    expect(r.applied.tombstones.map((t) => t.reason).sort()).toEqual(["contradiction", "decayed", "duplicate"]);
    expect(r.applied.workspace.tombstones).toHaveLength(3);
    expect(input.workspace.files.get(A)).toBe(A_TEXT);
  });

  it("is deterministic and does not mutate frozen inputs", () => {
    const input = deepFreeze(makeInput());
    const first = run(input);
    const second = run(input);
    expect(second).toEqual(first);
  });
});

describe("consolidateOnce", () => {
  it("is idempotent: the second pass plans nothing and changes nothing", () => {
    const once = consolidateOnce(makeInput());
    if (!once.ok) throw new Error("first pass failed");
    const second = run(once.value);
    expect(second.plan.toArchive).toEqual([]);
    expect(second.plan.toMerge).toEqual([]);
    expect(second.applied.workspace.files).toEqual(once.value.workspace.files);
    expect(second.applied.workspace.tombstones).toEqual(once.value.workspace.tombstones);
  });

  it("keeps everything but the workspace unchanged and propagates config errors", () => {
    const input = makeInput();
    const once = consolidateOnce(input);
    if (!once.ok) throw new Error("first pass failed");
    expect(once.value.states).toBe(input.states);
    expect(once.value.nowCommit).toBe(input.nowCommit);
    expect(consolidateOnce(makeInput({ cfg: { ...DEFAULT_CONFIG, s0: -1 } })).ok).toBe(false);
  });
});
