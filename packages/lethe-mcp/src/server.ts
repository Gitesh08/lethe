// MCP server factory: two handlers, four tools. Refs: Req 1.3, 1.5, 6.1, 6.3, 6.4, 6.6, REQ-MCP-6
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { envelopeText, fail, type Envelope } from "./envelope/envelope.js";
import { fromUnknown } from "./envelope/errors.js";
import type { Logger } from "./io/stdout.js";
import { log as stderrLog } from "./io/stdout.js";
import type { ContextDeps } from "./ops/context.js";
import { findTool, TOOLS } from "./tools/registry.js";
import { LETHE_MCP_VERSION } from "./version.js";

export interface ServerDeps {
  /** Diagnostics sink; defaults to the stderr logger (stdout is the protocol channel). */
  readonly log?: Logger;
  /** Passed to every tool run (test seams for git, clock, fs, ...). */
  readonly toolDeps?: ContextDeps;
}

/** One text block and structuredContent carrying the same envelope; `isError` mirrors `!ok`. */
function render(env: Envelope<unknown>): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: boolean;
} {
  return {
    content: [{ type: "text", text: envelopeText(env) }],
    structuredContent: { ...env },
    isError: !env.ok,
  };
}

/** Builds the (unconnected) Lethe MCP server. Connecting a transport is the caller's job. */
export function createLetheServer(deps: ServerDeps = {}): Server {
  const log = deps.log ?? stderrLog;
  const toolDeps: ContextDeps = { log, ...deps.toolDeps };
  const server = new Server({ name: "lethe", version: LETHE_MCP_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object" as const, ...t.jsonSchema },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = findTool(name);
    if (tool === undefined) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    try {
      return render(await tool.run(args ?? {}, toolDeps));
    } catch (e) {
      return render(fail(fromUnknown(e, log)));
    }
  });

  return server;
}
