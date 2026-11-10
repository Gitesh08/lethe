// Classifies lock-path errors that mean "contention", not failure (Windows reports a file that is
// mid-delete or briefly sharing-locked as EPERM/EBUSY/EACCES).
import type { ToolError } from "../envelope/errors.js";

const TRANSIENT_CODES: ReadonlySet<unknown> = new Set(["EPERM", "EBUSY", "EACCES"]);

export function isTransient(e: ToolError): boolean {
  // The guard's exists()->realpath() probe is not atomic: a lock file deleted in between reads as
  // "cannot be verified" (PATH_ESCAPE). LOCK_PATH is a constant, so a retry is safe; a real escape persists
  // and is surfaced when the wait budget ends.
  if (e.code === "PATH_ESCAPE") return true;
  if (e.code !== "IO_FAILED") return false;
  const d: unknown = e.detail;
  return typeof d === "object" && d !== null && TRANSIENT_CODES.has((d as { code?: unknown }).code);
}
