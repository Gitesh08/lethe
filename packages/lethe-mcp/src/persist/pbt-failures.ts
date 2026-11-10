// Writes .kiro/lethe/pbt-failures.json (Req 14.4). The text is produced ONLY by core's
// appendPbtFailure(existingText, pbtFailureEntry(failure, nowISO)); a malformed existing file is replaced
// by a fresh one exactly as core specifies. Core's helpers live in the lazily imported
// "@lethe/core/properties" module (Req 14.6), so the caller (gate/*) injects them via `PbtFailureCore`;
// this module never imports fast-check or the property modules.
import { type Result } from "@lethe/core";
import type { ToolError } from "../envelope/errors.js";
import { withLock, type LockOptions } from "../io/lock.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";

export const PBT_FAILURES_REL = ".kiro/lethe/pbt-failures.json";

/** Structural view of core's failed gate result (what pbtFailureEntry reads). */
export interface GateFailure {
  readonly status: "failed";
  readonly propertyId: string;
  readonly seed: number;
  readonly counterexample: unknown;
  readonly message: string;
}

/** The two core helpers, taken from the lazily imported `@lethe/core/properties` module. */
export interface PbtFailureCore<E> {
  readonly pbtFailureEntry: (result: GateFailure, atISO: string) => E;
  readonly appendPbtFailure: (existingText: string | undefined, entry: E) => string;
}

/**
 * Appends one failure record. The CALLER MUST ALREADY HOLD the workspace lock (the apply path holds it for
 * the whole operation); use `recordPbtFailure` when no lock is held. Atomic write via `writeAtomic`.
 */
export async function writePbtFailure<E>(
  fsx: WorkspaceFs,
  core: PbtFailureCore<E>,
  failure: GateFailure,
  nowISO: string,
): Promise<Result<void, ToolError>> {
  const existing = await fsx.readText(PBT_FAILURES_REL);
  if (!existing.ok) return existing;
  const entry = core.pbtFailureEntry(failure, nowISO);
  const text = core.appendPbtFailure(existing.value, entry);
  return fsx.writeAtomic(PBT_FAILURES_REL, text);
}

/** Takes the lock (dry-run gate failures, Req 14.4/9.1), then `writePbtFailure`. */
export async function recordPbtFailure<E>(
  fsx: WorkspaceFs,
  lock: LockOptions,
  core: PbtFailureCore<E>,
  failure: GateFailure,
  nowISO: string,
): Promise<Result<void, ToolError>> {
  const r = await withLock(fsx, lock, () => writePbtFailure(fsx, core, failure, nowISO));
  return r.ok ? r.value : r;
}
