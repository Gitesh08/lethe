// Operation behind lethe_score_memories. Read-only: no write, no lock, git only for the commit count (via ctx).
// Refs: Req 2.2, 2.3, 2.4, 2.5, 2.6, 23.2, 23.5, 23.12
import { planConsolidation, type EngramNode, type EngramState, type ScoredEngram, type Tier } from "@lethe/core";
import type { Diagnostic } from "../envelope/diagnostics.js";
import { fail, ok, type Envelope } from "../envelope/envelope.js";
import type { CommitSource } from "../load/commit-counter.js";
import { loadWorkspace } from "../load/workspace.js";
import type { RunContext } from "./context.js";
import { checkpointView, type FirstSeen } from "./view.js";

export interface ScoreArgs {
  readonly includeSpecs: boolean;
}

export interface ScoredEngramView {
  readonly node: Omit<EngramNode, "body" | "span">;
  readonly state: EngramState;
  readonly deltaC: number;
  readonly weight: number;
  readonly retention: number;
  readonly rawRetention: number;
  readonly tier: Tier;
  readonly status: ScoredEngram["status"];
  readonly protected: boolean;
  readonly firstSeen: FirstSeen;
}

export interface ScoreData {
  readonly engrams: ReadonlyArray<ScoredEngramView>; // ascending node.id
  readonly tiers: { readonly hot: number; readonly warm: number; readonly crypt: number };
  readonly hotTokens: number;
  readonly budget: number;
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly commit: number;
  readonly commitSource: CommitSource;
  readonly now: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toView(s: ScoredEngram, firstSeen: FirstSeen): ScoredEngramView {
  const { body: _body, span: _span, ...node } = s.node;
  return {
    node, state: s.state, deltaC: s.deltaC, weight: s.weight, retention: s.retention, rawRetention: s.rawRetention,
    tier: s.tier, status: s.status, protected: s.protected, firstSeen,
  };
}

export async function scoreMemories(ctx: RunContext, args: ScoreArgs): Promise<Envelope<ScoreData>> {
  const loaded = await loadWorkspace(ctx.fsx, { includeSpecs: args.includeSpecs });
  if (!loaded.ok) return fail(loaded.error);
  const view = await checkpointView(ctx, loaded.value);
  if (!view.ok) return fail(view.error);
  const { scored, firstSeen } = view.value;

  const engrams = [...scored]
    .sort((a, b) => byCodeUnit(a.node.id, b.node.id))
    .map((s) => toView(s, firstSeen.get(s.node.id) ?? "synthesised"));
  const tiers = { hot: 0, warm: 0, crypt: 0 };
  let hotTokens = 0;
  for (const e of engrams) {
    tiers[e.tier] += 1;
    if (e.tier === "hot") hotTokens += e.node.tokens;
  }
  const plan = planConsolidation(scored, [], loaded.value.cfg);
  const diagnostics = [...ctx.diagnostics, ...loaded.value.diagnostics, ...view.value.diagnostics];
  const data: ScoreData = {
    engrams, tiers, hotTokens, budget: loaded.value.cfg.budgetTokens, budgetStatus: plan.budgetStatus,
    commit: ctx.nowCommit, commitSource: ctx.commitSource, now: ctx.nowISO, diagnostics,
  };
  return ok(summarise(data), data);
}

function summarise(d: ScoreData): string {
  const synth = d.engrams.filter((e) => e.firstSeen === "synthesised").length;
  const reinforced = d.engrams.reduce((n, e) => n + e.state.reinforcements, 0);
  const parts = [
    `${d.engrams.length} engrams: ${d.tiers.hot} hot, ${d.tiers.warm} warm, ${d.tiers.crypt} crypt`,
    `hot tokens ${d.hotTokens}/${d.budget} (${d.budgetStatus})`,
  ];
  if (synth > 0) parts.push(`${synth} not yet decaying (firstSeen synthesised)`);
  if (reinforced > 0) parts.push(`${reinforced} reinforcements (estimated utility)`);
  return `${parts.join("; ")}.`;
}
