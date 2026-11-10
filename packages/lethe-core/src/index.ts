// Public API of @lethe/core (engine entry point). Pure: no IO, no clock, no fast-check.
//
// Entry points:
//   "@lethe/core"            this file: the engine (+ generateHauntedRepo, pure and fast-check free)
//   "@lethe/core/fixtures"   generateHauntedRepo, scrubTo, measureTokens, DEMO_SEED, types
//   "@lethe/core/properties" property definitions and runPbtGate (needs the optional fast-check peer)
//
// DELIBERATE DEVIATION from task 18.1: runPbtGate is NOT exported here. It imports fast-check and
// src/properties/arbitraries, which would break the engine's purity boundary (INV-7, enforced by
// test/boundary.unit.test.ts). It stays behind "@lethe/core/properties". generateHauntedRepo is
// re-exported here because the fixtures graph is pure; the boundary test keeps that honest.
export const LETHE_CORE_VERSION = "0.1.0" as const;

export type {
  Annotation,
  Axis,
  ConsolidationPlan,
  ContradictionReport,
  EngramNode,
  EngramState,
  EngramStatus,
  ErrorCode,
  LedgerEvent,
  LetheConfig,
  LetheError,
  Ontology,
  ParsedDoc,
  Result,
  ScoredEngram,
  SleepConsolidationResult,
  SpecInvariant,
  Stance,
  StanceMatch,
  Tier,
  TombstoneRecord,
  VirtualWorkspace,
} from "./types.js";
export type { CompiledOntology } from "./contradiction/compiled-types.js";
export type { RawSection } from "./parse/section.js";
export type { HauntedRepo } from "./fixtures/haunted-repo.js";
export type { ScoreInput } from "./decay/score.js";
export type { PipelineInput, PipelineResult, ScoredWorkspace } from "./consolidate/pipeline.js";
export type { ApplyResult } from "./crypt/apply.js";
export type { ResurrectResult } from "./crypt/resurrect.js";

export { DEFAULT_CONFIG, validateConfig } from "./config.js";
export { err, match, ok } from "./result.js";
export { parseDocument, serializeDocument } from "./parse/document.js";
export { sha256 } from "./parse/hash.js";
export { slugify } from "./parse/slug.js";
export { score, scoreChecked } from "./decay/score.js";
export { reinforce } from "./decay/reinforce.js";
export { computeRetention } from "./decay/retention.js";
export { computeDeltaC } from "./decay/delta.js";
export { computeWeight } from "./decay/weight.js";
export { globMatch } from "./decay/glob.js";
export { deriveSpecStances } from "./contradiction/spec-stances.js";
export { tierOf } from "./decay/tier.js";
export { detectContradictions } from "./contradiction/detect.js";
export { applyDefeats } from "./contradiction/defeat.js";
export { DEFAULT_AXES } from "./contradiction/default-ontology.js";
export { mergeOntology } from "./contradiction/merge-ontology.js";
export { validateOntology } from "./contradiction/validate-ontology.js";
export { planConsolidation } from "./consolidate/plan.js";
export { jaccard } from "./consolidate/jaccard.js";
export { consolidateOnce, runConsolidation, scoreWorkspace } from "./consolidate/pipeline.js";
export { applyPlan } from "./crypt/apply.js";
export { resurrect } from "./crypt/resurrect.js";
export { toTombstone } from "./crypt/archive.js";
export { parseTombstones, serializeTombstones } from "./crypt/tombstone-json.js";
export { generateHauntedRepo } from "./fixtures/haunted-repo.js";
