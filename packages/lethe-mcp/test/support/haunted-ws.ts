// Shared test helper: materialise the seeded haunted repo into a real directory. Refs: Req 21.8
// Fixture-native: steering files and ledger events. Synthesised here: ledger.jsonl bytes (stableLine) and
// .kiro/specs/<name>/{requirements,tasks}.md, because the fixture ships specs as values only.
import { type SpecInvariant } from "@lethe/core";
import { DEMO_SEED, generateHauntedRepo, type HauntedRepo } from "@lethe/core/fixtures";
import { createWorkspaceFs } from "../../src/io/workspace-fs.js";
import { KEY_ORDERS, stableLine } from "../../src/persist/stable-json.js";

// Stance id -> a SHALL sentence the default ontology maps back to that stance.
const SENTENCE: Record<string, string> = {
  "mod:esm": "THE code SHALL use ESM modules.",
  "err:result-types": "THE engine SHALL return Result types.",
  "typing:strict-ts": "THE code SHALL use strict TypeScript.",
  "state:signals": "THE UI SHALL use signals.",
  "css:pure-css": "THE UI SHALL use pure CSS.",
};

export interface MaterialiseOptions {
  /** Fixture seed; defaults to DEMO_SEED. */
  readonly seed?: number;
  /** Write the ledger and spec files too (default true). */
  readonly withHistory?: boolean;
}

export function requirementsFor(spec: SpecInvariant): string {
  const stanceLines = spec.stances.map((s) => SENTENCE[s] ?? `UNMAPPED ${s}`);
  const ids = spec.requirementIds.map((id) => `<!-- ${id} -->`).join(" ");
  return `# ${spec.specName}\n\n${ids}\n\n${stanceLines.join("\n\n")}\n`;
}

/** Writes the haunted repo under `root` (an existing real directory) and returns the generated repo. */
export async function materialiseHaunted(root: string, opts: MaterialiseOptions = {}): Promise<HauntedRepo> {
  const repo = generateHauntedRepo(opts.seed ?? DEMO_SEED);
  const fsx = createWorkspaceFs(root);
  const must = async (p: string, text: string): Promise<void> => {
    const w = await fsx.writeAtomic(p, text);
    if (!w.ok) throw new Error(`materialise ${p}: ${w.error.message}`);
  };
  for (const [path, text] of repo.workspace.files) await must(path, text);
  if (opts.withHistory === false) return repo;
  await must(".kiro/lethe/ledger.jsonl", repo.ledger.map((e) => stableLine(e, KEY_ORDERS.ledgerLine)).join(""));
  for (const spec of repo.specs) {
    await must(`.kiro/specs/${spec.specName}/requirements.md`, requirementsFor(spec));
    await must(`.kiro/specs/${spec.specName}/tasks.md`, "- [x] 1. done\n- [ ] 2. open\n");
  }
  return repo;
}
