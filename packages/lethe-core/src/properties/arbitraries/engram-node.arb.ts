// Arbitrary EngramNode values (well-typed, internally consistent) for score/consolidate PBTs.
// Refs: REQ-PBT-4
import fc from "fast-check";
import type { EngramNode } from "../../types.js";

/** Globs that really match paths in FILE_POOL (ledger.arb.ts). */
export const GLOB_POOL: readonly string[] = [
  "src/**/*.ts",
  "docs/*.md",
  "apps/web/**/*.tsx",
  "packages/**/*.ts",
  "**/*.md",
];

const BODY_WORDS: readonly string[] = ["use", "never", "prefer", "state", "css", "tests", "avoid", "日本語"];

const bodyArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...BODY_WORDS), { minLength: 1, maxLength: 40 })
  .map((ws) => ws.join(" "));

export interface EngramNodeOptions {
  readonly specLinks: fc.Arbitrary<readonly string[]>;
  readonly pinned?: fc.Arbitrary<boolean>;
}

function toNode(
  id: string,
  body: string,
  globs: readonly string[],
  specLinks: readonly string[],
  pinned: boolean,
): EngramNode {
  const hashAt = id.indexOf("#");
  const file = hashAt < 0 ? id : id.slice(0, hashAt);
  const heading = hashAt < 0 ? id : id.slice(hashAt + 1);
  return {
    id,
    file,
    headingPath: [heading],
    body,
    contentHash: `h${body.length.toString(16)}-${id.length.toString(16)}`,
    tokens: Math.ceil(body.length / 4),
    globs,
    specLinks,
    pinned,
    span: { start: 0, end: body.length },
  };
}

/** EngramNode with the given id; links come from `opts`, globs from GLOB_POOL. */
export function engramNodeArb(id: string, opts: EngramNodeOptions): fc.Arbitrary<EngramNode> {
  return fc
    .tuple(
      bodyArb,
      fc.option(fc.subarray([...GLOB_POOL], { maxLength: 2 }), { nil: [], freq: 2 }),
      opts.specLinks,
      opts.pinned ?? fc.boolean(),
    )
    .map(([body, globs, links, pinned]) => toNode(id, body, globs, links, pinned));
}
