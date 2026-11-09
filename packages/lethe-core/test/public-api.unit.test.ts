// Public API snapshot + happy path through the barrel only. Refs: REQ-CORE-API (task 18.1), INV-3, INV-7
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const EXPECTED_RUNTIME_EXPORTS: readonly string[] = [
  "DEFAULT_AXES",
  "DEFAULT_CONFIG",
  "LETHE_CORE_VERSION",
  "applyDefeats",
  "applyPlan",
  "computeDeltaC",
  "computeRetention",
  "computeWeight",
  "consolidateOnce",
  "detectContradictions",
  "err",
  "generateHauntedRepo",
  "jaccard",
  "match",
  "mergeOntology",
  "ok",
  "parseDocument",
  "parseTombstones",
  "planConsolidation",
  "reinforce",
  "resurrect",
  "runConsolidation",
  "score",
  "scoreChecked",
  "scoreWorkspace",
  "serializeDocument",
  "serializeTombstones",
  "sha256",
  "slugify",
  "tierOf",
  "toTombstone",
  "validateConfig",
  "validateOntology",
];

describe("public API surface", () => {
  it("exports exactly the documented runtime names", () => {
    expect(Object.keys(api).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
  });

  it("exports the core functions, config and version with the right kinds", () => {
    for (const name of [
      "parseDocument",
      "serializeDocument",
      "score",
      "reinforce",
      "detectContradictions",
      "planConsolidation",
      "applyPlan",
      "resurrect",
      "validateConfig",
    ] as const) {
      expect(typeof api[name]).toBe("function");
    }
    expect(typeof api.DEFAULT_CONFIG).toBe("object");
    expect(api.LETHE_CORE_VERSION).toBe("0.1.0");
  });

  it("does not leak the property-test gate into the engine entry point", () => {
    expect("runPbtGate" in api).toBe(false);
  });
});

const FILE = ".kiro/steering/a.md";
const TEXT = [
  "## Stale",
  "Keep functions small and tidy.",
  "## Signals",
  "Use signals for state.",
  "## Redux",
  "Use Redux for state.",
  "",
].join("\n");
const NOW = "2026-03-01T00:00:00.000Z";

describe("happy path through the public barrel", () => {
  it("parse -> score -> detect -> plan -> apply -> resurrect", () => {
    const cfg = api.DEFAULT_CONFIG;
    const parsed = api.parseDocument(FILE, TEXT, cfg);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(api.serializeDocument(parsed.value)).toBe(TEXT);
    const engrams = parsed.value.engrams;
    expect(engrams).toHaveLength(3);

    const stale = engrams[0];
    if (stale === undefined) throw new Error("no engram");
    const states = [
      { id: stale.id, stability: 0.5, lastReinforcedCommit: 0, lastReinforcedAt: NOW, reinforcements: 0 },
    ];
    const scored = api.score({ engrams, states, specs: [], ledger: [], nowCommit: 100, nowISO: NOW, cfg });
    expect(scored).toHaveLength(3);
    for (const s of scored) expect(s.retention).toBeGreaterThan(0);

    const reports = api.detectContradictions(scored, []);
    if (!reports.ok) throw new Error(reports.error.message);
    expect(reports.value.length).toBeGreaterThanOrEqual(1);

    const plan = api.planConsolidation(scored, reports.value, cfg);
    expect(plan.toArchive.length).toBeGreaterThanOrEqual(1);

    const workspace = { files: new Map([[FILE, TEXT]]), tombstones: [] };
    const applied = api.applyPlan(workspace, plan, 100, NOW, cfg);
    expect(applied.tombstones.length).toBeGreaterThanOrEqual(1);
    expect(applied.workspace.files.get(FILE)).not.toBe(TEXT);

    const tomb = applied.tombstones[0];
    if (tomb === undefined) throw new Error("no tombstone");
    const back = api.resurrect(applied.workspace, tomb, 101, NOW, cfg);
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.workspace.files.get(FILE)).toContain(tomb.body);
  });
});
