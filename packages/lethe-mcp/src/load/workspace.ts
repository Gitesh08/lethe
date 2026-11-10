// Orchestrates the loaders into one LoadedWorkspace (Req 10.1, Req 2.4). Read-only; fixed error order.
import {
  err, ok, validateOntology,
  type Axis, type CompiledOntology, type EngramNode, type LetheConfig, type Result, type SpecInvariant, type TombstoneRecord,
} from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { mapCoreError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { loadConfigFile } from "./config-file.js";
import { loadLedger, type LedgerRead } from "./ledger-file.js";
import { loadOntologyFile } from "./ontology-file.js";
import { deriveSpecs } from "./specs.js";
import { loadStateFile, type LoadedState } from "./state-file.js";
import { collectSteering, SPECS_DIR } from "./steering.js";
import { loadTombstones } from "./tombstone-file.js";

export interface LoadedWorkspace {
  readonly cfg: LetheConfig;
  /** Default axes merged with .kiro/lethe/ontology.json (defaults only when the file is absent). */
  readonly ontology: readonly Axis[];
  readonly compiled: CompiledOntology;
  readonly steeringFiles: ReadonlyMap<string, string>;
  /** Steering engrams, ascending path order. */
  readonly engrams: readonly EngramNode[];
  /** Spec engrams; empty unless `includeSpecs`. */
  readonly specEngrams: readonly EngramNode[];
  /** Always derived from .kiro/specs, regardless of `includeSpecs`. */
  readonly specs: readonly SpecInvariant[];
  /** Checkpointed states plus ledger cursor (empty/zero when state.json is absent). */
  readonly persisted: LoadedState;
  readonly ledger: LedgerRead;
  /** Only present when `needTombstones` was requested. */
  readonly tombstones: readonly TombstoneRecord[] | undefined;
  readonly neverRewrite: readonly string[];
  readonly anySteeringSkipped: boolean;
  readonly parseDiagnostics: readonly Diagnostic[];
  /** parseDiagnostics followed by ledger diagnostics. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadOptions {
  readonly includeSpecs: boolean;
  readonly needTombstones?: boolean;
}

const underSpecs = (d: Diagnostic): boolean => d.file !== undefined && d.file.startsWith(`${SPECS_DIR}/`);

interface Settings {
  readonly cfg: LetheConfig;
  readonly activeSpecs: readonly string[] | undefined;
  readonly axes: readonly Axis[];
  readonly compiled: CompiledOntology;
}

/** Config then ontology (merged and compiled); first error wins. */
async function loadSettings(fsx: WorkspaceFs): Promise<Result<Settings, ToolError>> {
  const loadedCfg = await loadConfigFile(fsx);
  if (!loadedCfg.ok) return loadedCfg;
  const axes = await loadOntologyFile(fsx);
  if (!axes.ok) return axes;
  const compiled = validateOntology(axes.value);
  if (!compiled.ok) return err(mapCoreError(compiled.error));
  return ok({ cfg: loadedCfg.value.config, activeSpecs: loadedCfg.value.activeSpecs, axes: axes.value, compiled: compiled.value });
}

/** Loads config, ontology, steering, specs, state, ledger (and tombstones on request); first error wins. */
export async function loadWorkspace(fsx: WorkspaceFs, opts: LoadOptions): Promise<Result<LoadedWorkspace, ToolError>> {
  const settings = await loadSettings(fsx);
  if (!settings.ok) return settings;
  const { cfg, activeSpecs, axes, compiled } = settings.value;

  // Specs are always read: stances and active-ness matter even when spec markdown is not scored.
  const steering = await collectSteering(fsx, cfg, { includeSpecs: true });
  if (!steering.ok) return steering;
  const s = steering.value;
  const specs = deriveSpecs(s.specFiles, compiled, activeSpecs);

  const persisted = await loadStateFile(fsx);
  if (!persisted.ok) return persisted;
  const ledger = await loadLedger(fsx, persisted.value.cursor);
  if (!ledger.ok) return ledger;

  const tombstones = await maybeTombstones(fsx, opts.needTombstones === true);
  if (!tombstones.ok) return tombstones;

  const inc = opts.includeSpecs;
  const parseDiagnostics = inc ? s.diagnostics : s.diagnostics.filter((d) => !underSpecs(d));
  return ok({
    cfg, ontology: axes, compiled, steeringFiles: s.steeringFiles,
    engrams: s.engrams, specEngrams: inc ? s.specEngrams : [], specs,
    persisted: persisted.value, ledger: ledger.value, tombstones: tombstones.value,
    neverRewrite: inc ? s.neverRewrite : s.neverRewrite.filter((p) => !p.startsWith(`${SPECS_DIR}/`)),
    anySteeringSkipped: s.anySteeringSkipped, parseDiagnostics,
    diagnostics: [...parseDiagnostics, ...ledger.value.diagnostics],
  });
}

async function maybeTombstones(fsx: WorkspaceFs, need: boolean): Promise<Result<readonly TombstoneRecord[] | undefined, ToolError>> {
  return need ? loadTombstones(fsx) : ok(undefined);
}
