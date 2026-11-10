// Test-only faulty filesystem: wraps a real WorkspaceFs and fails every mutating call from the Nth onward
// (1-based), including rollback attempts, so a crash is simulated and the journal (pending.json) survives.
// Mutating calls: writeAtomic, remove, mkdirp, mkdirExclusive, writeExclusive, copyTo, appendLine.
// Reads (readText, readBytes, listMarkdown) always pass through and are not counted.
import { err, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../../src/envelope/errors.js";
import type { WorkspaceFs } from "../../src/io/workspace-fs.js";

export interface FaultyFs {
  readonly fsx: WorkspaceFs;
  /** Every mutating call attempted, in order: "<method> <rel>" (failed ones included). */
  readonly calls: string[];
  /** True once a call has been failed. */
  tripped(): boolean;
}

export function createFaultyFs(base: WorkspaceFs, failFrom: number): FaultyFs {
  const calls: string[] = [];
  let trip = false;
  const gate = <T>(name: string, rel: string, run: () => Promise<Result<T, ToolError>>): Promise<Result<T, ToolError>> => {
    calls.push(`${name} ${rel}`);
    if (calls.length < failFrom) return run();
    trip = true;
    return Promise.resolve(err(toolError("IO_FAILED", "Injected write failure.", { path: rel, call: calls.length })));
  };
  const fsx: WorkspaceFs = {
    readText: (r) => base.readText(r),
    readBytes: (r) => base.readBytes(r),
    listMarkdown: (r) => base.listMarkdown(r),
    writeAtomic: (r, c) => gate("writeAtomic", r, () => base.writeAtomic(r, c)),
    remove: (r) => gate("remove", r, () => base.remove(r)),
    mkdirp: (r) => gate("mkdirp", r, () => base.mkdirp(r)),
    mkdirExclusive: (r) => gate("mkdirExclusive", r, () => base.mkdirExclusive(r)),
    writeExclusive: (r, c) => gate("writeExclusive", r, () => base.writeExclusive(r, c)),
    copyTo: (r, d) => gate("copyTo", r, () => base.copyTo(r, d)),
    appendLine: (r, l) => gate("appendLine", r, () => base.appendLine(r, l)),
  };
  return { fsx, calls, tripped: () => trip };
}
