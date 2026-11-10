// Path guard (Req 7). Pure apart from the injected FsProbe; only io/workspace-fs.ts touches node:fs.
import { posix, win32 } from "node:path";
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import { windowsViolation } from "./path-guard-win.js";

/** Minimal filesystem view used for real-path checks. Implemented over node:fs in workspace-fs.ts. */
export interface FsProbe {
  /** Canonical real path (symlinks, junctions resolved), or undefined when it cannot be resolved. */
  realpath(p: string): string | undefined;
  isDirectory(p: string): boolean;
  /** True when an entry exists, WITHOUT following a final symlink (a dangling link still exists). */
  exists(p: string): boolean;
}

type PathApi = typeof posix;

function api(platform: string): PathApi {
  return platform === "win32" ? win32 : posix;
}

function caseInsensitive(platform: string): boolean {
  return platform === "win32" || platform === "darwin";
}

function escape(rel: string, why: string): Result<never, ToolError> {
  return err(toolError("PATH_ESCAPE", `Path escapes the workspace: ${why}.`, { path: rel }));
}

/** True when `child` equals `root` or lies below it (both already absolute and normalised). */
function contains(p: PathApi, ci: boolean, root: string, child: string): boolean {
  const fold = (s: string): string => (ci ? s.toLowerCase() : s);
  const r = p.relative(fold(root), fold(child));
  if (r === "") return true;
  const first = r.split(/[\\/]/)[0];
  return first !== ".." && !p.isAbsolute(r);
}

/** Resolves an untrusted workspace path to its real directory path, once per call. */
export function resolveWorkspace(
  workspacePath: string,
  probe: FsProbe,
  platform: string = process.platform,
): Result<string, ToolError> {
  const bad = (m: string): Result<never, ToolError> =>
    err(toolError("INVALID_INPUT", `workspacePath ${m}.`));
  if (workspacePath.includes("\0")) return bad("contains a NUL byte");
  if (!api(platform).isAbsolute(workspacePath)) return bad("must be an absolute path");
  const real = probe.realpath(workspacePath);
  if (real === undefined) return bad("does not exist");
  if (!probe.isDirectory(real)) return bad("is not a directory");
  return ok(real);
}

function lexicalRejection(rel: string, platform: string): string | undefined {
  if (rel.includes("\0")) return "NUL byte";
  if (rel.startsWith("/") || rel.startsWith("\\")) return "absolute path";
  if (platform === "win32") return windowsViolation(rel);
  return undefined;
}

/** Real location of `abs`: realpath of the deepest existing ancestor plus the not-yet-existing remainder. */
function realLocation(p: PathApi, probe: FsProbe, abs: string): string | undefined {
  const tail: string[] = [];
  let cur = abs;
  while (!probe.exists(cur)) {
    const parent = p.dirname(cur);
    if (parent === cur) return undefined;
    tail.unshift(p.basename(cur));
    cur = parent;
  }
  const real = probe.realpath(cur);
  return real === undefined ? undefined : p.join(real, ...tail);
}

/**
 * Confines `rel` to `root` (a value returned by resolveWorkspace). Returns the absolute path
 * (lexically under `root`) or PATH_ESCAPE. Both separators are accepted on every host.
 */
export function guardPath(
  root: string,
  rel: string,
  probe: FsProbe,
  platform: string = process.platform,
): Result<string, ToolError> {
  const why = lexicalRejection(rel, platform);
  if (why !== undefined) return escape(rel, why);
  const p = api(platform);
  const ci = caseInsensitive(platform);
  const abs = p.resolve(root, ...rel.split(/[\\/]/));
  if (!contains(p, ci, root, abs)) return escape(rel, "resolves outside the workspace");
  const real = realLocation(p, probe, abs);
  if (real === undefined) return escape(rel, "real location cannot be verified");
  if (!contains(p, ci, root, real)) return escape(rel, "link or junction leaves the workspace");
  return ok(abs);
}
