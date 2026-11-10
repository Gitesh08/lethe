// withMutation (design "Operations"; Req 4.6, 8.10, 9.4): lock -> recover journal -> load -> body -> release.
import { type Result } from "@lethe/core";
import { type ToolError } from "../envelope/errors.js";
import { acquireLock } from "../io/lock.js";
import { loadWorkspace, type LoadedWorkspace } from "../load/workspace.js";
import { recoverInterruptedApply } from "../persist/recover.js";
import type { RunContext } from "./context.js";

export type MutationBody<T> = (loaded: LoadedWorkspace) => Promise<Result<T, ToolError>>;

/**
 * Runs `body` under the workspace lock on a freshly loaded workspace (specs included, tombstones included).
 * LOCKED / recovery / load errors are returned without running the body. The lock is released in `finally`,
 * also when the body throws (the exception then propagates to the transport).
 */
export async function withMutation<T>(ctx: RunContext, body: MutationBody<T>): Promise<Result<T, ToolError>> {
  const step = ctx.trace ?? (() => undefined);
  step("lock");
  const lock = await acquireLock(ctx.fsx, ctx.lock);
  if (!lock.ok) return lock;
  try {
    step("recover");
    const rec = await recoverInterruptedApply(ctx.fsx);
    if (!rec.ok) return rec;
    if (rec.value !== undefined) ctx.diagnostics.push(rec.value);
    step("load");
    const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: true, needTombstones: true });
    if (!loaded.ok) return loaded;
    step("body");
    return await body(loaded.value);
  } finally {
    step("release");
    await lock.value.release();
  }
}
