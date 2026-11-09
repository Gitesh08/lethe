// Duplicate-heavy workspaces: sections copied with 0-1 word changes so the merge path is exercised.
import fc from "fast-check";
import type { PipelineInput } from "../../consolidate/pipeline.js";
import type { LetheConfig } from "../../types.js";

const WORDS: readonly string[] = [
  "always", "write", "tests", "before", "merging", "keep", "functions", "small", "prefer", "pure",
  "modules", "document", "errors", "review", "changes", "name", "files", "clearly", "avoid", "globals",
  "log", "to", "stderr", "check", "types", "early",
];

const bodyArb: fc.Arbitrary<readonly string[]> = fc.array(fc.constantFrom(...WORDS), { minLength: 18, maxLength: 24 });

interface Copy {
  readonly pos: number;
  readonly word: string;
  readonly change: boolean;
}

const copyArb: fc.Arbitrary<Copy> = fc.record({
  pos: fc.nat({ max: 1000 }),
  word: fc.constantFrom(...WORDS),
  change: fc.boolean(),
});

function mutate(words: readonly string[], c: Copy): string {
  if (!c.change) return words.join(" ");
  const out = [...words];
  out[c.pos % out.length] = `${c.word}x`;
  return out.join(" ");
}

export function duplicateHeavyWorkspaceArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc
    .record({
      bases: fc.array(bodyArb, { minLength: 1, maxLength: 3 }),
      copies: fc.array(fc.record({ base: fc.nat({ max: 2 }), c: copyArb, pin: fc.boolean() }), { minLength: 1, maxLength: 6 }),
      nowCommit: fc.integer({ min: 0, max: 400 }),
    })
    .map(({ bases, copies, nowCommit }): PipelineInput => {
      const sections: string[] = [];
      bases.forEach((b, i) => sections.push(`## Base ${i}\n\n${b.join(" ")}\n`));
      copies.forEach((k, i) => {
        const base = bases[k.base % bases.length] ?? [];
        const pin = k.pin ? "<!-- lethe: pin=true -->\n" : "";
        sections.push(`## Copy ${i}\n${pin}\n${mutate(base, k.c)}\n`);
      });
      const text = `# Rules\n\n${sections.join("\n")}`;
      return {
        workspace: { files: new Map([[".kiro/steering/dups.md", text]]), tombstones: [] },
        states: [],
        specs: [],
        ledger: [],
        nowCommit,
        nowISO: "2026-01-01T00:00:00.000Z",
        cfg,
      };
    });
}
