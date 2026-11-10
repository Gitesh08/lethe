// Shared helpers for loading zod-validated JSON files under .kiro/lethe/. Refs: Req 10.4, Req 10.5
import { err, ok, type Result } from "@lethe/core";
import type { z } from "zod";
import { toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";

/** CONFIG_INVALID naming the file and (when known) the key path. */
export function configInvalid(file: string, key: string | undefined, problem: string): ToolError {
  const where = key === undefined || key === "" ? file : `${file}: key "${key}"`;
  return toolError("CONFIG_INVALID", `${where}: ${problem}`, key === undefined || key === "" ? { file } : { file, key });
}

function describeIssue(file: string, issue: z.core.$ZodIssue): ToolError {
  if (issue.code === "unrecognized_keys") {
    const keys = [...issue.keys].sort();
    const base = issue.path.map(String).join(".");
    const first = keys[0] ?? "";
    const key = base === "" ? first : `${base}.${first}`;
    return configInvalid(file, key, `unknown key${keys.length > 1 ? "s" : ""} ${keys.map((k) => `"${k}"`).join(", ")}`);
  }
  return configInvalid(file, issue.path.map(String).join("."), issue.message);
}

/** Reads `rel`; absent → ok(undefined). Bad JSON or schema mismatch → CONFIG_INVALID naming file and key. */
export async function readJsonFile<S extends z.ZodType>(
  fs: WorkspaceFs,
  rel: string,
  schema: S,
): Promise<Result<z.output<S> | undefined, ToolError>> {
  const text = await fs.readText(rel);
  if (!text.ok) return text;
  if (text.value === undefined) return ok(undefined);
  let json: unknown;
  try {
    json = JSON.parse(text.value);
  } catch {
    return err(configInvalid(rel, undefined, "not valid JSON"));
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return ok(parsed.data as z.output<S>);
  const issue = parsed.error.issues[0];
  return err(issue === undefined ? configInvalid(rel, undefined, "invalid") : describeIssue(rel, issue));
}
