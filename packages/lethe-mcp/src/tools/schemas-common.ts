// Shared zod 4 building blocks for tool inputs. Refs: Req 1.2, Req 1.6
import { posix, win32 } from "node:path";
import { z } from "zod";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

/** Absolute path (win32 or posix style), 1..4096 chars, no NUL. Existence is checked later by resolveWorkspace. */
export const WorkspacePath = z
  .string()
  .min(1)
  .max(4096)
  .refine((p) => !p.includes("\0"), { message: "must not contain NUL" })
  .refine((p) => win32.isAbsolute(p) || posix.isAbsolute(p), { message: "must be an absolute path" });

/** ISO 8601 instant with `Z` or a numeric offset. */
export const IsoInstant = z
  .string()
  .regex(ISO_INSTANT, { message: "must be YYYY-MM-DDTHH:mm:ss(.fff)?(Z|±HH:mm)" })
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "must be a valid instant" });

/** Commit counter: integer 0..Number.MAX_SAFE_INTEGER. */
export const Commit = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
