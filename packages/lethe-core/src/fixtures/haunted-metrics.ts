// Demo token metric for the haunted repo (PRD section 10). Refs: REQ-SBX-1, REQ-SBX-2
//
// Token counts are the engine's own (`ceil(body chars / 4)` per engram); intros and
// frontmatter are not engrams and are not counted.
//
//  fileTokens    tokens of ALL engrams currently in the files = what an always-included
//                steering setup injects into every prompt.
//  hotBefore     tokens of engrams in the Hot tier at nowCommit (plan.tokensBefore).
//  hotAfterSleep Hot-tier tokens of the survivors after `runConsolidation` (plan.tokensAfter):
//                archived, defeated and merged engrams are gone, budget demotion applied.
//  savedPercent  (fileTokens - hotAfterSleep) / fileTokens * 100, rounded to one decimal.
//
// Honest reading: "saved" compares the full file content against the post-sleep Hot injection.
// Warm survivors stay in the files (recoverable, not injected). Sleep itself only removes
// archived/defeated/merged text, so hotBefore -> hotAfterSleep shrinks by less than fileTokens does.
import { runConsolidation } from "../consolidate/pipeline.js";
import type { HauntedRepo } from "./haunted-repo.js";

export interface TokenMetrics {
  readonly fileTokens: number;
  readonly hotBefore: number;
  readonly hotAfterSleep: number;
  readonly savedPercent: number;
}

const ZERO: TokenMetrics = { fileTokens: 0, hotBefore: 0, hotAfterSleep: 0, savedPercent: 0 };

export function measureTokens(repo: HauntedRepo): TokenMetrics {
  const run = runConsolidation(repo);
  if (!run.ok) return ZERO;
  const { scoredWorkspace, plan } = run.value;
  let fileTokens = 0;
  for (const e of scoredWorkspace.engrams) fileTokens += e.tokens;
  const saved = fileTokens === 0 ? 0 : ((fileTokens - plan.tokensAfter) / fileTokens) * 100;
  return {
    fileTokens,
    hotBefore: plan.tokensBefore,
    hotAfterSleep: plan.tokensAfter,
    savedPercent: Math.round(saved * 10) / 10,
  };
}
