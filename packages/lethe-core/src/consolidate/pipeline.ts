// Pure end-to-end consolidation pipeline: parse -> score -> detect -> plan -> apply.
// Refs: REQ-CRY-1, REQ-CRY-2, REQ-CRY-4, INV-4, INV-7
//
// DRY-RUN SEMANTICS: nothing is written anywhere. `applied.workspace` is the
// would-be state; the caller (MCP layer, tests, web bridge) decides whether to adopt it.
import { validateConfig } from "../config.js";
import { detectContradictions } from "../contradiction/detect.js";
import { applyPlan } from "../crypt/apply.js";
import type { ApplyResult } from "../crypt/apply.js";
import { score } from "../decay/score.js";
import { parseDocument } from "../parse/document.js";
import { err, ok } from "../result.js";
import type {
  ConsolidationPlan,
  ContradictionReport,
  EngramNode,
  EngramState,
  LedgerEvent,
  LetheConfig,
  LetheError,
  Ontology,
  Result,
  ScoredEngram,
  SpecInvariant,
  VirtualWorkspace,
} from "../types.js";
import { planConsolidation } from "./plan.js";

export interface PipelineInput {
  readonly workspace: VirtualWorkspace;
  readonly states: readonly EngramState[];
  readonly specs: readonly SpecInvariant[];
  readonly ledger: readonly LedgerEvent[];
  readonly nowCommit: number;
  readonly nowISO: string;
  readonly cfg: LetheConfig;
  /** Optional user ontology merged over DEFAULT_AXES; absent => default axes only. */
  readonly ontology?: Ontology;
}

export interface ScoredWorkspace {
  readonly engrams: readonly EngramNode[];
  readonly scored: readonly ScoredEngram[];
  readonly parseErrors: ReadonlyArray<{ readonly file: string; readonly error: LetheError }>;
  /** Present when cfg / nowCommit is invalid; engrams and scored are then empty. */
  readonly configError?: LetheError;
}

export interface PipelineResult {
  readonly scoredWorkspace: ScoredWorkspace;
  readonly reports: readonly ContradictionReport[];
  readonly plan: ConsolidationPlan;
  readonly applied: ApplyResult;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function configFailure(error: LetheError): ScoredWorkspace {
  return { engrams: [], scored: [], parseErrors: [], configError: error };
}

function checkInputs(input: PipelineInput): Result<LetheConfig, LetheError> {
  const cfg = validateConfig(input.cfg);
  if (!cfg.ok) return cfg;
  if (!Number.isFinite(input.nowCommit) || input.nowCommit < 0) {
    return err({
      code: "CONFIG_INVALID",
      message: `nowCommit must be a finite number >= 0; got ${String(input.nowCommit)}`,
    });
  }
  return cfg;
}

/** Parse every workspace file (ascending path order) and score the engrams. */
export function scoreWorkspace(input: PipelineInput): ScoredWorkspace {
  const checked = checkInputs(input);
  if (!checked.ok) return configFailure(checked.error);
  const cfg = checked.value;
  const engrams: EngramNode[] = [];
  const parseErrors: Array<{ file: string; error: LetheError }> = [];
  const paths = [...input.workspace.files.keys()].sort(cmp);
  for (const file of paths) {
    const parsed = parseDocument(file, input.workspace.files.get(file) ?? "", cfg);
    if (parsed.ok) engrams.push(...parsed.value.engrams);
    else parseErrors.push({ file, error: parsed.error });
  }
  const scored = score({
    engrams,
    states: input.states,
    specs: input.specs,
    ledger: input.ledger,
    nowCommit: input.nowCommit,
    nowISO: input.nowISO,
    cfg,
  });
  return { engrams, scored, parseErrors };
}

/** scoreWorkspace -> detect -> plan -> apply. Pure; the caller decides what to keep. */
export function runConsolidation(input: PipelineInput): Result<PipelineResult, LetheError> {
  const sw = scoreWorkspace(input);
  if (sw.configError !== undefined) return err(sw.configError);
  const reports = input.ontology === undefined
    ? detectContradictions(sw.scored, input.specs)
    : detectContradictions(sw.scored, input.specs, input.ontology);
  if (!reports.ok) return err(reports.error);
  const plan = planConsolidation(sw.scored, reports.value, input.cfg);
  const applied = applyPlan(input.workspace, plan, input.nowCommit, input.nowISO, input.cfg);
  return ok({ scoredWorkspace: sw, reports: reports.value, plan, applied });
}

/** Run the pipeline once and return the input with the would-be workspace swapped in. */
export function consolidateOnce(input: PipelineInput): Result<PipelineInput, LetheError> {
  const r = runConsolidation(input);
  if (!r.ok) return err(r.error);
  return ok({ ...input, workspace: r.value.applied.workspace });
}
