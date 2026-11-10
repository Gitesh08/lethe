// RunContext + buildContext (design "RunContext"; Req 4.6, 11.5). Every environmental dependency is a seam.
import { err, ok, type Result } from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import type { ToolError } from "../envelope/errors.js";
import { unconfiguredGate, type GateRunner } from "../gate/gate.js";
import { nodeGit, type GitRunner } from "../io/git.js";
import type { LockOptions } from "../io/lock.js";
import { resolveWorkspace, type FsProbe } from "../io/path-guard.js";
import { log as stderrLog, type Logger } from "../io/stdout.js";
import { createWorkspaceFs, nodeFsProbe, type WorkspaceFs, type WorkspaceFsOptions } from "../io/workspace-fs.js";
import { fsFallbackReader, resolveCommitCounter, type CommitSource } from "../load/commit-counter.js";

/** Observable steps of a mutation, in order (used by tests to record the sequence). */
export type TraceStep = "lock" | "recover" | "load" | "body" | "release" | "plan" | "gate" | "backup" | "write";

export interface RunContext {
  /** Realpath of the workspace; the confinement root for the whole call. */
  readonly root: string;
  readonly nowCommit: number;
  readonly commitSource: CommitSource;
  /** Clock read once per invocation. */
  readonly nowISO: string;
  /** Append-only collector, returned in data.diagnostics. */
  readonly diagnostics: Diagnostic[];
  readonly gate: GateRunner;
  readonly git: GitRunner;
  readonly fsx: WorkspaceFs;
  readonly lock: LockOptions;
  readonly log: Logger;
  readonly trace?: (step: TraceStep) => void;
}

export interface ContextInput {
  readonly workspacePath: string;
  /** Commit override (`atCommit` / `--commit`). */
  readonly commit?: number | undefined;
  /** `now` override (`--now`). */
  readonly now?: string | undefined;
}

export interface ContextDeps {
  readonly probe?: FsProbe;
  readonly platform?: string;
  readonly fsOptions?: WorkspaceFsOptions;
  /** Replaces the filesystem; receives the resolved workspace root. Default: `createWorkspaceFs(root, ...)`. */
  readonly fsx?: (root: string) => WorkspaceFs;
  readonly git?: GitRunner;
  readonly clock?: () => Date;
  readonly lock?: LockOptions;
  readonly log?: Logger;
  readonly gate?: GateRunner;
  readonly trace?: (step: TraceStep) => void;
}

/** Resolves the workspace, builds the guarded fs, and resolves the commit counter and `now` once. */
export async function buildContext(input: ContextInput, deps: ContextDeps = {}): Promise<Result<RunContext, ToolError>> {
  const probe = deps.probe ?? nodeFsProbe;
  const root = resolveWorkspace(input.workspacePath, probe, deps.platform);
  if (!root.ok) return err(root.error);
  const fsx = makeFs(root.value, probe, deps);
  const git = deps.git ?? nodeGit;
  const counter = await resolveCommitCounter({
    root: root.value,
    commit: input.commit,
    now: input.now,
    git,
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
    readFallbacks: fsFallbackReader(fsx),
  });
  if (!counter.ok) return err(counter.error);
  const { nowCommit, commitSource, nowISO, diagnostics } = counter.value;
  return ok({
    root: root.value,
    nowCommit,
    commitSource,
    nowISO,
    diagnostics: [...diagnostics],
    git,
    fsx,
    ...seams(deps),
  });
}

function makeFs(root: string, probe: FsProbe, deps: ContextDeps): WorkspaceFs {
  return deps.fsx === undefined ? createWorkspaceFs(root, { probe, ...deps.fsOptions }) : deps.fsx(root);
}

/** Optional seams with their defaults. */
function seams(deps: ContextDeps): Pick<RunContext, "gate" | "lock" | "log" | "trace"> {
  return {
    gate: deps.gate ?? unconfiguredGate,
    lock: deps.lock ?? {},
    log: deps.log ?? stderrLog,
    ...(deps.trace === undefined ? {} : { trace: deps.trace }),
  };
}
