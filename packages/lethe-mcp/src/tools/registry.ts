// The only module importing the four tool modules. Refs: Req 1.1, 1.7, REQ-MCP-1
import { detectTool } from "./detect.js";
import { resurrectTool } from "./resurrect.js";
import { scoreTool } from "./score.js";
import { sleepTool } from "./sleep.js";
import type { ToolDef, ToolName } from "./tool.js";

/** Exactly four tools in a fixed order; a fifth element is a type error. */
export const TOOLS = [scoreTool, detectTool, sleepTool, resurrectTool] as const satisfies readonly [
  ToolDef<unknown>,
  ToolDef<unknown>,
  ToolDef<unknown>,
  ToolDef<unknown>,
];

export const TOOL_NAMES: ReadonlyArray<ToolName> = TOOLS.map((t) => t.name);

// A Map avoids prototype-key pitfalls ("__proto__", "constructor").
const BY_NAME: ReadonlyMap<string, ToolDef<unknown>> = new Map(TOOLS.map((t) => [t.name, t]));

/** Exact-match lookup by tool name. */
export function findTool(name: string): ToolDef<unknown> | undefined {
  return BY_NAME.get(name);
}
