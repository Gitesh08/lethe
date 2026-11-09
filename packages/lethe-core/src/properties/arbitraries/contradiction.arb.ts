// Arbitraries for contradiction detection PBTs (P5, P11): scored engrams whose bodies
// really trigger the default ontology, plus spec invariants.
// Refs: REQ-CON-3, REQ-PBT-4, INV-5
import fc from "fast-check";
import type { LetheConfig, ScoredEngram, SpecInvariant, Tier } from "../../types.js";

/** Affirmative and negated sentences over several default axes. */
export const SENTENCE_POOL: readonly string[] = [
  "Use RxJS BehaviorSubject for state.",
  "Use signals for state.",
  "Do not use signals for state.",
  "Never use RxJS.",
  "Use Redux for state.",
  "Do not use Tailwind.",
  "Use Tailwind.",
  "Use pure CSS only.",
  "Avoid CSS-in-JS.",
  "Use CSS Modules.",
  "Use React.",
  "Use Angular.",
  "Prefer pnpm.",
  "Always run bun install.",
  "Do not use npm.",
  "Use yarn.",
  "Use Vitest.",
  "Use Jest.",
  "Never use Jest.",
  "Use ESM only.",
  "Use CommonJS require() calls.",
  "Return Result types instead.",
  "Throw errors for failures.",
  "Default to Server Components.",
  "Mark files with use client.",
];

export const NOISE_POOL: readonly string[] = [
  "Keep functions small.",
  "Write clear commit messages.",
  "日本語のメモ。",
  "Caf\u00e9 conventions apply.",
];

/** Variants: CRLF-adjacent, zero-width spaces, fullwidth/uppercase, unicode padding. */
function variant(s: string, k: number): string {
  switch (k) {
    case 1:
      return s.toUpperCase();
    case 2:
      return s.replace(" ", " \u200b");
    case 3:
      return `\u00a0${s}\u00a0`;
    case 4:
      return `${s}\r`;
    default:
      return s;
  }
}

const sentenceArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...SENTENCE_POOL) }, { weight: 1, arbitrary: fc.constantFrom(...NOISE_POOL) }),
    fc.oneof({ weight: 3, arbitrary: fc.constant(0) }, { weight: 2, arbitrary: fc.integer({ min: 1, max: 4 }) }),
  )
  .map(([s, k]) => variant(s, k));

const bodyArb: fc.Arbitrary<string> = fc
  .tuple(fc.array(sentenceArb, { minLength: 1, maxLength: 4 }), fc.constantFrom(" ", "\n", "\r\n"))
  .map(([ss, sep]) => ss.join(sep));

/** Random, tied and epsilon-adjacent retention values in (0, 1]. */
const retentionBaseArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: 1e-6, max: 1, noNaN: true, noDefaultInfinity: true }) },
  { weight: 3, arbitrary: fc.constantFrom(0.2, 0.5, 0.6, 0.9, 1) },
);
const nudgeArb: fc.Arbitrary<number> = fc.constantFrom(0, 0, 1e-14, -1e-14, 5e-14);

function tierOf(r: number, cfg: LetheConfig): Tier {
  if (r >= cfg.hotMin) return "hot";
  return r < cfg.cryptMax ? "crypt" : "warm";
}

function clampR(r: number): number {
  return Math.min(1, Math.max(1e-9, r));
}

interface Draft {
  readonly n: number;
  readonly body: string;
  readonly base: number;
  readonly nudge: number;
  readonly commit: number;
  readonly prot: boolean;
}

function toScored(d: Draft, cfg: LetheConfig, tag: string): ScoredEngram {
  const id = `.kiro/steering/${tag}${d.n}.md#rules`;
  const retention = clampR(d.base + d.nudge);
  return {
    node: {
      id,
      file: `.kiro/steering/${tag}${d.n}.md`,
      headingPath: ["rules"],
      body: d.body,
      contentHash: `h${d.n}`,
      tokens: Math.ceil(d.body.length / 4),
      globs: [],
      specLinks: [],
      pinned: d.prot,
      span: { start: 0, end: d.body.length },
    },
    state: { id, stability: 5, lastReinforcedCommit: d.commit, lastReinforcedAt: "2026-06-01T00:00:00.000Z", reinforcements: 0 },
    deltaC: 0,
    weight: 1,
    retention,
    rawRetention: retention,
    tier: tierOf(retention, cfg),
    status: "active",
    protected: d.prot,
  };
}

const KNOWN_STANCES: readonly string[] = [
  "state:signals", "state:rxjs-subjects", "state:redux", "css:tailwind", "css:pure-css",
  "fw:react", "fw:angular", "pm:pnpm", "pm:bun", "test:jest", "test:vitest", "mod:esm", "mod:commonjs",
];

const specArb: fc.Arbitrary<SpecInvariant> = fc
  .tuple(
    fc.integer({ min: 0, max: 3 }),
    fc.boolean(),
    fc.array(fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...KNOWN_STANCES) }, { weight: 1, arbitrary: fc.constantFrom("unknown:thing", "") }), { maxLength: 3 }),
  )
  .map(([i, active, stances]) => ({ specName: `spec-${i}`, active, requirementIds: [`REQ-X-${i}`], stances }));

const specsArb: fc.Arbitrary<readonly SpecInvariant[]> = fc.array(specArb, { maxLength: 3 });

function draftsArb(min: number, max: number): fc.Arbitrary<readonly Draft[]> {
  return fc
    .tuple(fc.uniqueArray(fc.integer({ min: 0, max: 99 }), { minLength: min, maxLength: max }), fc.constantFrom("all", "none", "mix"))
    .chain(([ns, mode]) =>
      fc.tuple(
        ...ns.map((n) =>
          fc.record({
            n: fc.constant(n),
            body: bodyArb,
            base: retentionBaseArb,
            nudge: nudgeArb,
            commit: fc.oneof(fc.constantFrom(10, 10, 20), fc.integer({ min: 0, max: 500 })),
            prot: mode === "all" ? fc.constant(true) : mode === "none" ? fc.constant(false) : fc.boolean(),
          }),
        ),
      ),
    );
}

type Input = { scored: readonly ScoredEngram[]; specs: readonly SpecInvariant[] };

function build(min: number, max: number, cfg: LetheConfig): fc.Arbitrary<Input> {
  return fc
    .tuple(draftsArb(min, max), specsArb)
    .map(([ds, specs]) => ({ scored: ds.map((d) => toScored(d, cfg, "c")), specs }));
}

/** 2..8 engrams with unique ids plus 0..3 specs. */
export function contradictionInputArb(cfg: LetheConfig): fc.Arbitrary<Input> {
  return build(2, 8, cfg);
}

/** Exactly two engrams plus specs. */
export function contradictionPairArb(cfg: LetheConfig): fc.Arbitrary<Input> {
  return build(2, 2, cfg);
}
