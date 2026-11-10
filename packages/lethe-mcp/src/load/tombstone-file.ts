// Loads .kiro/crypt/tombstones.json on demand (sleep/resurrect only). Refs: Req 10.11, Req 8.6
import { err, ok, parseTombstones, type Result, type TombstoneRecord } from "@lethe/core";
import { mapCoreError, toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";

export const TOMBSTONES_REL = ".kiro/crypt/tombstones.json";

/**
 * Absent file means an empty crypt. A present file must pass core's parseTombstones,
 * otherwise CONFIG_INVALID (same for apply and dry-run). Never cached; call lazily.
 */
export async function loadTombstones(
  fsx: Pick<WorkspaceFs, "readText">,
): Promise<Result<readonly TombstoneRecord[], ToolError>> {
  const read = await fsx.readText(TOMBSTONES_REL);
  if (!read.ok) return read;
  if (read.value === undefined) return ok([]);
  const parsed = parseTombstones(read.value);
  if (parsed.ok) return parsed;
  const mapped = mapCoreError(parsed.error);
  const detail = typeof mapped.detail === "object" && mapped.detail !== null ? mapped.detail : {};
  return err(toolError("CONFIG_INVALID", mapped.message, { ...detail, path: TOMBSTONES_REL }));
}
