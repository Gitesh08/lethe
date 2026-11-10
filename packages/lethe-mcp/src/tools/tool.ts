// Shared tool definition shape and builder. Refs: Req 1.1, 1.4, 6.6
import type { z } from "zod";
import { fail, type Envelope } from "../envelope/envelope.js";
import { parseInput } from "../envelope/zod-error.js";
import { buildContext, type ContextDeps, type RunContext } from "../ops/context.js";
import { inputJsonSchema } from "./schemas.js";

export type ToolName =
  | "lethe_score_memories"
  | "lethe_detect_contradictions"
  | "lethe_consolidate_sleep"
  | "lethe_resurrect_engram";

/** Fields every tool input carries; `buildContext` reads them. */
interface CommonInput {
  readonly workspacePath: string;
  readonly atCommit?: number | undefined;
  readonly now?: string | undefined;
}

export interface ToolDef<D = unknown> {
  readonly name: ToolName;
  /** Written for the model (03-rules section 8): when to call, what it returns, safety. */
  readonly description: string;
  readonly mutating: boolean;
  /** Strict zod schema of what a client may send. */
  readonly inputSchema: z.ZodType;
  /** JSON Schema of `inputSchema` (io: "input"), computed once. */
  readonly jsonSchema: Record<string, unknown>;
  /** Validates `raw` (INVALID_INPUT on failure), builds the RunContext, runs the operation. Never throws on bad input. */
  readonly run: (raw: unknown, deps?: ContextDeps) => Promise<Envelope<D>>;
}

export interface ToolSpec<S extends z.ZodType<CommonInput>, D> {
  readonly name: ToolName;
  readonly description: string;
  readonly mutating: boolean;
  readonly inputSchema: S;
  readonly operation: (ctx: RunContext, args: z.output<S>) => Promise<Envelope<D>>;
}

export function defineTool<S extends z.ZodType<CommonInput>, D>(spec: ToolSpec<S, D>): ToolDef<D> {
  const run = async (raw: unknown, deps: ContextDeps = {}): Promise<Envelope<D>> => {
    const parsed = parseInput(spec.inputSchema, raw);
    if (!parsed.ok) return fail(parsed.error);
    const args = parsed.value;
    const ctx = await buildContext({ workspacePath: args.workspacePath, commit: args.atCommit, now: args.now }, deps);
    if (!ctx.ok) return fail(ctx.error);
    return spec.operation(ctx.value, args);
  };
  return {
    name: spec.name,
    description: spec.description,
    mutating: spec.mutating,
    inputSchema: spec.inputSchema,
    jsonSchema: inputJsonSchema(spec.inputSchema),
    run,
  };
}
