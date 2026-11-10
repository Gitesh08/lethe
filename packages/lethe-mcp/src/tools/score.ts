// lethe_score_memories tool. Refs: Req 1.4, 2.6, REQ-MCP-2
import { scoreMemories, type ScoreData } from "../ops/score.js";
import { ScoreMemoriesInput } from "./schemas.js";
import { defineTool, type ToolDef } from "./tool.js";

const DESCRIPTION =
  "Call this to see how strongly each steering rule is still remembered. It returns, per rule (engram), " +
  "retention R, tier (hot, warm, crypt), token counts, and firstSeen, plus tier totals and whether the Hot tier fits the token budget. " +
  "Read-only and safe: nothing is written. " +
  "Reinforcement-derived figures (stability, reinforcements) are estimated utility from recorded events, not proof that a rule is useful. " +
  "Engrams with firstSeen \"synthesised\" have not started decaying yet. " +
  "Set includeSpecs to also score spec documents.";

export const scoreTool: ToolDef<ScoreData> = defineTool({
  name: "lethe_score_memories",
  description: DESCRIPTION,
  mutating: false,
  inputSchema: ScoreMemoriesInput,
  operation: (ctx, args) => scoreMemories(ctx, { includeSpecs: args.includeSpecs }),
});
