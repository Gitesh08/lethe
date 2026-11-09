// Adversarial workspace arbitraries (REQ-PBT-4): real markdown, parsed to learn ids, then
// states / specs / ledger derived from those ids. Callers pass the cfg (small budgets force demotions).
import fc from "fast-check";
import type { PipelineInput } from "../../consolidate/pipeline.js";
import type { LetheConfig } from "../../types.js";
import { docsArb, GHOST_SPEC, SPEC_NAMES } from "./adversarial-docs.arb.js";
import type { DocOpts, DocSpec, Format, SectionSpec } from "./adversarial-docs.arb.js";
import { assemble, makeSpecs, nowCommitMixArb, specsArb } from "./adversarial-assemble.arb.js";
import type { AssembleOpts } from "./adversarial-assemble.arb.js";
import { NOISE_POOL, SENTENCE_POOL } from "./contradiction.arb.js";
import { anyLedgerArb, burstyLedgerArb } from "./ledger.arb.js";

const UNICODE_POOL: readonly string[] = [
  "状態管理にはシグナルを使う。",
  "استخدم الإشارات لإدارة الحالة.",
  "השתמש בסיגנלים לניהול מצב.",
  "Cafe\u0301 re\u0301sume\u0301 n\u0303 rules apply.",
  "Use\u200b signals\u200b for state.",
  "Ship it \u{1F680}\u{1F468}\u200D\u{1F469}\u200D\u{1F467} now.",
  "Do not use Tailwind \u2014 \u4e0d\u8981\u4f7f\u7528.",
];
const UNICODE_TAILS: readonly string[] = ["", " 状態", " حالة", " מצב", " e\u0301", " \u200b", " \u{1F680}"];
const GENERAL_POOL: readonly string[] = [...SENTENCE_POOL, ...NOISE_POOL, ...NOISE_POOL, ...NOISE_POOL];

const plainFormat: fc.Arbitrary<Format> = fc.record({
  frontmatter: fc.oneof({ weight: 3, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  eol: fc.constantFrom("lf" as const, "lf" as const, "crlf" as const),
  trailing: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
});
const wildFormat: fc.Arbitrary<Format> = fc.record({
  frontmatter: fc.boolean(),
  eol: fc.constantFrom("lf" as const, "crlf" as const, "mixed" as const),
  trailing: fc.boolean(),
});

const looseLinks: fc.Arbitrary<readonly string[]> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<readonly string[]>([]) },
  { weight: 1, arbitrary: fc.subarray([...SPEC_NAMES, GHOST_SPEC], { minLength: 1, maxLength: 2 }) },
);

const general: DocOpts = {
  pool: GENERAL_POOL,
  links: looseLinks,
  format: plainFormat,
  tails: [""],
  minSections: 1,
  maxSections: 8,
  minFiles: 1,
  maxFiles: 3,
};

const baseAssemble: AssembleOpts = {
  specs: specsArb,
  ledger: anyLedgerArb,
  nowCommit: () => nowCommitMixArb,
  kinds: ["none", "fresh", "stale", "stale"],
};

/** 1..3 files of 1..8 sections: contradictions, near-duplicates, pins, spec links, stale states. */
export function workspaceInputArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return assemble(cfg, docsArb(general), baseAssemble);
}

/** Every section carries `spec=<active spec>`, so every engram is protected. */
export function allSpecLinkedWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc.subarray([...SPEC_NAMES], { minLength: 1 }).chain((active) => {
    const links = fc.constantFrom(...active).map((n): readonly string[] => [n]);
    return assemble(cfg, docsArb({ ...general, links }), { ...baseAssemble, specs: fc.constant(makeSpecs(active)) });
  });
}

const dupSection = (heading: string): SectionSpec => ({
  heading,
  sentences: ["Use Vitest."],
  pin: false,
  specs: [],
  globs: [],
});

function withDuplicateIds(docs: readonly DocSpec[]): readonly DocSpec[] {
  return docs.map((d, i) =>
    i === 0 ? { ...d, sections: [...d.sections, dupSection("Rules"), dupSection("rules")] } : d,
  );
}

/** At least one file whose sections "## Rules" and "## rules" slug to one id (parse error). */
export function duplicateIdWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  const docs = docsArb({ ...general, minFiles: 1 }).map(withDuplicateIds);
  return assemble(cfg, docs, baseAssemble);
}

/** CJK, Arabic, Hebrew RTL, combining marks, zero-width spaces, emoji, mixed CRLF/LF. */
export function unicodeCrlfWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  const opts: DocOpts = { ...general, pool: [...UNICODE_POOL, ...SENTENCE_POOL], format: wildFormat, tails: UNICODE_TAILS };
  return assemble(cfg, docsArb(opts), baseAssemble);
}

const emptyDoc: fc.Arbitrary<DocSpec> = fc
  .record({ frontmatter: fc.boolean(), title: fc.boolean(), eol: fc.constantFrom("lf" as const, "crlf" as const), trailing: fc.boolean() })
  .map((f) => ({ ...f, path: ".kiro/steering/empty.md", sections: [] }));

/** No files at all, or a file with no sections. */
export function emptyWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  const docs = fc.oneof(
    fc.constant<readonly DocSpec[]>([]),
    emptyDoc.map((d): readonly DocSpec[] => [d]),
  );
  return assemble(cfg, docs, baseAssemble);
}

/** >= 20 ledger events inside a commit window <= 5. */
export function burstyLedgerWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  const nowCommit = (ledger: ReadonlyArray<{ readonly commit: number }>): fc.Arbitrary<number> => {
    const last = ledger.reduce((m, e) => Math.max(m, e.commit), 0);
    return fc.integer({ min: 0, max: 3000 }).map((extra) => last + extra);
  };
  return assemble(cfg, docsArb(general), { ...baseAssemble, ledger: burstyLedgerArb, nowCommit });
}

/** nowCommit >= 500 beyond every state's lastReinforcedCommit, no ledger events. */
export function longIdleWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return assemble(cfg, docsArb(general), {
    ...baseAssemble,
    ledger: fc.constant([]),
    kinds: ["stale", "aged"],
    nowCommit: () => fc.integer({ min: 1500, max: 100_000 }),
  });
}

/** Weighted mix of every adversarial shape. */
export function anyWorkspaceInputArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc.oneof(
    { weight: 6, arbitrary: workspaceInputArb(cfg) },
    { weight: 1, arbitrary: allSpecLinkedWorkspaceArb(cfg) },
    { weight: 1, arbitrary: duplicateIdWorkspaceArb(cfg) },
    { weight: 2, arbitrary: unicodeCrlfWorkspaceArb(cfg) },
    { weight: 1, arbitrary: emptyWorkspaceArb(cfg) },
    { weight: 1, arbitrary: burstyLedgerWorkspaceArb(cfg) },
    { weight: 1, arbitrary: longIdleWorkspaceArb(cfg) },
  );
}
