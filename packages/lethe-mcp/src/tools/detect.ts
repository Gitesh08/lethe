// lethe_detect_contradictions tool. Refs: Req 1.4, 3.1, REQ-MCP-2
import { detectContradictionsOp, type DetectData } from "../ops/detect.js";
import { DetectContradictionsInput } from "./schemas.js";
import { defineTool, type ToolDef } from "./tool.js";

const DESCRIPTION =
  "Call this to find steering rules that contradict each other or an active spec, using a deterministic ontology of mutually exclusive stances (pattern-based, not semantic). " +
  "Read-only and safe: nothing is written. " +
  "Returns reports, each with the axis, both sides with evidence, severity, and a resolution (winner and loser, or unresolvable when both sides are protected). " +
  "scope \"steering-vs-specs\" keeps only steering-versus-spec conflicts; \"all\" (default) keeps every report.";

export const detectTool: ToolDef<DetectData> = defineTool({
  name: "lethe_detect_contradictions",
  description: DESCRIPTION,
  mutating: false,
  inputSchema: DetectContradictionsInput,
  operation: (ctx, args) => detectContradictionsOp(ctx, { scope: args.scope }),
});
