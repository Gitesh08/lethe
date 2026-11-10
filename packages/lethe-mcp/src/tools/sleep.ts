// lethe_consolidate_sleep tool. Refs: Req 1.4, 4.1, REQ-MCP-3
import { fail, ok } from "../envelope/envelope.js";
import { defaultGateRunner } from "../gate/gate.js";
import { sleepOp, sleepSummary, type SleepData } from "../ops/sleep.js";
import { ConsolidateSleepInput } from "./schemas.js";
import { defineTool, type ToolDef } from "./tool.js";

const DESCRIPTION =
  "Call this to run Lethe's sleep consolidation: archive decayed or defeated rules to the crypt with byte-exact tombstones, merge duplicates, and demote rules to fit the Hot token budget. " +
  "The default is a dry-run, safe: it reports what would change and writes nothing. Pass apply: true to change files (atomic writes, with a backup). " +
  "A property-based safety gate runs first; if it fails, nothing is applied. " +
  "Never combine skipGate with apply: that is refused with INVALID_INPUT. " +
  "Returns archived, merged, and demoted engrams, token counts before and after, budget status (budget_infeasible is reported, never forced), and the gate result.";

const base: ToolDef<SleepData> = defineTool({
  name: "lethe_consolidate_sleep",
  description: DESCRIPTION,
  mutating: true,
  inputSchema: ConsolidateSleepInput,
  operation: async (ctx, args) => {
    const r = await sleepOp(ctx, {
      apply: args.apply,
      skipGate: args.skipGate,
      gateRuns: args.gateRuns,
      budgetTokens: args.budgetTokens,
    });
    return r.ok ? ok(sleepSummary(r.value), r.value) : fail(r.error);
  },
});

/** The MCP server is a production transport: when no gate is injected, use the real property gate. */
export const sleepTool: ToolDef<SleepData> = {
  ...base,
  run: (raw, deps = {}) => base.run(raw, { ...deps, gate: deps.gate ?? defaultGateRunner }),
};
