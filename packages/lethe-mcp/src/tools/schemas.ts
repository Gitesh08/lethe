// The four exported tool input schemas (all strict). Refs: Req 1.2, 2.1, 3.1, 4.1, 5.1
// Kept apart from the tool modules so the public index can export them without importing tool code.
import { z } from "zod";
import { Commit, IsoInstant, WorkspacePath } from "./schemas-common.js";

export const ScoreMemoriesInput = z
  .object({
    workspacePath: WorkspacePath,
    atCommit: Commit.optional(),
    now: IsoInstant.optional(),
    includeSpecs: z.boolean().default(false),
  })
  .strict();

export const DetectContradictionsInput = z
  .object({
    workspacePath: WorkspacePath,
    scope: z.enum(["steering-vs-specs", "all"]).default("all"),
    atCommit: Commit.optional(),
    now: IsoInstant.optional(),
  })
  .strict();

// `skipGate` + `apply` is accepted here on purpose: the operation returns INVALID_INPUT (Req 4.5, task 3.6).
export const ConsolidateSleepInput = z
  .object({
    workspacePath: WorkspacePath,
    apply: z.boolean().default(false),
    budgetTokens: z.number().int().min(1).optional(),
    skipGate: z.boolean().default(false),
    gateRuns: z.number().int().min(1).max(10000).default(100),
    atCommit: Commit.optional(),
    now: IsoInstant.optional(),
  })
  .strict();

export const ResurrectEngramInput = z
  .object({
    workspacePath: WorkspacePath,
    query: z.string().min(1).max(500),
    apply: z.boolean().default(false),
    atCommit: Commit.optional(),
    now: IsoInstant.optional(),
  })
  .strict();

/** Parsed (post-default) input types handed to operations. */
export type ScoreMemoriesArgs = z.output<typeof ScoreMemoriesInput>;
export type DetectContradictionsArgs = z.output<typeof DetectContradictionsInput>;
export type ConsolidateSleepArgs = z.output<typeof ConsolidateSleepInput>;
export type ResurrectEngramArgs = z.output<typeof ResurrectEngramInput>;

/** JSON Schema of what a client may send (defaults not required, `additionalProperties: false`). */
export function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
}
