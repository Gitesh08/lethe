// Loads .kiro/lethe/config.json (zod strict) merged over DEFAULT_CONFIG. Refs: Req 10.4
import { DEFAULT_CONFIG, err, ok, validateConfig, type LetheConfig, type Result } from "@lethe/core";
import { z } from "zod";
import type { ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { configInvalid, readJsonFile } from "./json-file.js";

export const CONFIG_PATH = ".kiro/lethe/config.json";

const num = z.number();

/** Shape of config.json: `version: 1`, every other key optional, unknown keys rejected. */
export const configFileSchema = z
  .object({
    version: z.literal(1),
    s0: num.optional(),
    sMax: num.optional(),
    sMin: num.optional(),
    beta: num.optional(),
    alpha: num.optional(),
    wDefault: num.optional(),
    wSpec: num.optional(),
    specFloor: num.optional(),
    hotMin: num.optional(),
    cryptMax: num.optional(),
    budgetTokens: num.optional(),
    dedupeJaccard: num.optional(),
    granularity: z.enum(["section", "bullet"]).optional(),
    activeSpecs: z.array(z.string()).optional(),
  })
  .strict();

export type ConfigFile = z.output<typeof configFileSchema>;

export interface LoadedConfig {
  readonly config: LetheConfig;
  /** Explicit active-spec names, or undefined when config.json does not list any. */
  readonly activeSpecs: readonly string[] | undefined;
}

/** Overrides only (no `version`/`activeSpecs`, no undefined values). */
function overrides(file: ConfigFile): Record<string, unknown> {
  const { version: _v, activeSpecs: _a, ...rest } = file;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
}

/** Key named at the start of a core validateConfig message ("sMax must be …"). */
function keyOf(message: string): string | undefined {
  const m = /^(\w+)\b/.exec(message);
  return m?.[1];
}

/** Absent file → defaults. Otherwise zod-check, merge over DEFAULT_CONFIG, then validateConfig. */
export async function loadConfigFile(fs: WorkspaceFs): Promise<Result<LoadedConfig, ToolError>> {
  const read = await readJsonFile(fs, CONFIG_PATH, configFileSchema);
  if (!read.ok) return read;
  if (read.value === undefined) return ok({ config: DEFAULT_CONFIG, activeSpecs: undefined });
  const v = validateConfig({ ...DEFAULT_CONFIG, ...overrides(read.value) });
  if (!v.ok) return err(configInvalid(CONFIG_PATH, keyOf(v.error.message), v.error.message));
  return ok({ config: v.value, activeSpecs: read.value.activeSpecs });
}
