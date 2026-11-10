// Tests for task 1.4: new index exports and the optional `ontology` pipeline input.
// Refs: Req 5.2, Req 10.3, INV-7, REQ-CON-5, REQ-CRY-7
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { consolidateOnce, runConsolidation, scoreWorkspace } from "../src/consolidate/pipeline.js";
import type { PipelineInput } from "../src/consolidate/pipeline.js";
import { planConsolidation } from "../src/consolidate/plan.js";
import { detectContradictions } from "../src/contradiction/detect.js";
import { deriveSpecStances as deriveFromModule } from "../src/contradiction/spec-stances.js";
import { applyPlan } from "../src/crypt/apply.js";
import { globMatch as globFromModule } from "../src/decay/glob.js";
import { DEMO_SEED, generateHauntedRepo } from "../src/fixtures/index.js";
import { deriveSpecStances, globMatch } from "../src/index.js";
import type { Ontology } from "../src/types.js";

const NOW = "2026-03-01T00:00:00.000Z";
const FILE = ".kiro/steering/db.md";

const dbOntology: Ontology = [
  {
    id: "db",
    description: "database choice",
    stances: [
      { id: "db:pg", label: "Postgres", patterns: ["\\bpostgres\\b"], negationAware: true },
      { id: "db:my", label: "MySQL", patterns: ["\\bmysql\\b"], negationAware: true },
    ],
  },
];

function dbInput(extra: Partial<PipelineInput> = {}): PipelineInput {
  const text = ["## Postgres", "Use Postgres.", "## MySQL", "Use MySQL.", ""].join("\n");
  return {
    workspace: { files: new Map([[FILE, text]]), tombstones: [] },
    states: [],
    specs: [],
    ledger: [],
    nowCommit: 10,
    nowISO: NOW,
    cfg: DEFAULT_CONFIG,
    ...extra,
  };
}

function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Map ? { map: [...v.entries()] } : v));
}

describe("index exports (task 1.3)", () => {
  it("globMatch and deriveSpecStances are functions matching their modules", () => {
    expect(typeof globMatch).toBe("function");
    expect(typeof deriveSpecStances).toBe("function");
    expect(globMatch).toBe(globFromModule);
    expect(deriveSpecStances).toBe(deriveFromModule);
    expect(globMatch("src/**/*.ts", "src/a/b.ts")).toBe(true);
    expect(globMatch("src/*.ts", "src/a/b.ts")).toBe(globFromModule("src/*.ts", "src/a/b.ts"));
    expect(globMatch("src/**/*.ts", "lib/a.js")).toBe(false);
  });
});

describe("runConsolidation ontology option", () => {
  it("without ontology equals the explicit previous composition, byte for byte", () => {
    const repo = generateHauntedRepo(DEMO_SEED, DEFAULT_CONFIG);
    const r = runConsolidation(repo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const sw = scoreWorkspace(repo);
    const reports = detectContradictions(sw.scored, repo.specs);
    expect(reports.ok).toBe(true);
    if (!reports.ok) return;
    const plan = planConsolidation(sw.scored, reports.value, repo.cfg);
    const applied = applyPlan(repo.workspace, plan, repo.nowCommit, repo.nowISO, repo.cfg);
    const expected = { scoredWorkspace: sw, reports: reports.value, plan, applied };

    expect(r.value).toEqual(expected);
    expect(toJson(r.value)).toBe(toJson(expected));
  });

  it("a user ontology adds an axis that is absent without it", () => {
    const without = runConsolidation(dbInput());
    expect(without.ok).toBe(true);
    if (!without.ok) return;
    expect(without.value.reports.some((x) => x.axis === "db")).toBe(false);

    const withOnt = runConsolidation(dbInput({ ontology: dbOntology }));
    expect(withOnt.ok).toBe(true);
    if (!withOnt.ok) return;
    expect(withOnt.value.reports.filter((x) => x.axis === "db")).toHaveLength(1);
  });

  it("an invalid user pattern returns ONTOLOGY_INVALID_PATTERN", () => {
    const bad: Ontology = [
      { id: "db", description: "d", stances: [{ id: "db:pg", label: "pg", patterns: ["("], negationAware: true }] },
    ];
    const r = runConsolidation(dbInput({ ontology: bad }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("ONTOLOGY_INVALID_PATTERN");
  });

  it("consolidateOnce preserves the ontology field", () => {
    const input = dbInput({ ontology: dbOntology });
    const r = consolidateOnce(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ontology).toBe(dbOntology);
  });
});
