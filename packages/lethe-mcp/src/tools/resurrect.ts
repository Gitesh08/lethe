// lethe_resurrect_engram tool. Refs: Req 1.4, 5.1, REQ-MCP-3
import { fail, ok } from "../envelope/envelope.js";
import { resurrectOp, type ResurrectData } from "../ops/resurrect.js";
import { ResurrectEngramInput } from "./schemas.js";
import { defineTool, type ToolDef } from "./tool.js";

const DESCRIPTION =
  "Call this to bring an archived rule back from the crypt, by engram id or by text from its heading or body. " +
  "The default is a dry-run, safe: it lists the matching tombstones and writes nothing. Pass apply: true to change files (atomic writes, with a backup). " +
  "Restored rules start with fresh stability, so they are Hot again and decay anew from now. " +
  "Returns the matches and, when applied, where each rule was restored. TOMBSTONE_NOT_FOUND means nothing matched.";

export function resurrectSummary(d: ResurrectData): string {
  const n = d.matches.length;
  if (d.restored !== undefined) {
    return `Applied: restored ${d.restored.length} of ${n} match(es): ${d.restored.map((r) => r.id).join(", ")}.`;
  }
  return `Dry run: ${n} match(es): ${d.matches.map((m) => m.id).join(", ")}. Pass apply: true to restore.`;
}

export const resurrectTool: ToolDef<ResurrectData> = defineTool({
  name: "lethe_resurrect_engram",
  description: DESCRIPTION,
  mutating: true,
  inputSchema: ResurrectEngramInput,
  operation: async (ctx, args) => {
    const r = await resurrectOp(ctx, { query: args.query, apply: args.apply });
    return r.ok ? ok(resurrectSummary(r.value), r.value) : fail(r.error);
  },
});
