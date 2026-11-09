// Renders the haunted-repo steering files (frontmatter, H1 intro, H2/H3 sections).
// Pure; the only variation is the injected seeded rng. Refs: REQ-SBX-1

import type { Entry } from "./haunted-entry.js";
import { expandVariants } from "./haunted-rng.js";
import type { Rng } from "./haunted-rng.js";

export interface SteeringMeta {
  readonly path: string;
  readonly title: string;
  readonly intro: string;
  readonly frontmatter: readonly string[];
}

/** The six steering files, in file-number order (Entry.file is 1-based into this list). */
export const STEERING_FILES: readonly SteeringMeta[] = [
  { path: ".kiro/steering/01-product.md", title: "Lethe Product Brief", intro: "What the product is for and who it serves.", frontmatter: ["inclusion: manual"] },
  { path: ".kiro/steering/02-architecture.md", title: "System Architecture", intro: "How the engine, tools and studio fit together.", frontmatter: ["inclusion: fileMatch", 'fileMatchPattern: "packages/**/*.ts"'] },
  { path: ".kiro/steering/03-rules.md", title: "Engineering Rules", intro: "Rules that apply to every change.", frontmatter: ["inclusion: always"] },
  { path: ".kiro/steering/04-design-system.md", title: "Design System", intro: "Visual language for the studio.", frontmatter: ["inclusion: fileMatch", 'fileMatchPattern: "apps/web/**/*.css"'] },
  { path: ".kiro/steering/05-workflow.md", title: "Workflow", intro: "How work moves from spec to commit.", frontmatter: ["inclusion: manual"] },
  { path: ".kiro/steering/06-memory.md", title: "Project Memory Ledger", intro: "A short, living record of what was decided.", frontmatter: ["inclusion: always"] },
];

/** An H2 with its H3 children; blocks are the unit that may be reordered. */
function toBlocks(entries: readonly Entry[]): Entry[][] {
  const blocks: Entry[][] = [];
  for (const entry of entries) {
    const last = blocks[blocks.length - 1];
    if (entry.level === 3 && last !== undefined) last.push(entry);
    else blocks.push([entry]);
  }
  return blocks;
}

/** Seeded adjacent swaps: slight, reproducible ordering variation. */
function shuffleBlocks(blocks: Entry[][], rng: Rng): Entry[][] {
  const out = blocks.map((b) => b);
  for (let i = 0; i + 1 < out.length; i += 1) {
    if (rng.next() >= 0.3) continue;
    const a = out[i];
    const b = out[i + 1];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[i + 1] = a;
    }
  }
  return out;
}

function renderEntry(entry: Entry, rng: Rng): string {
  const heading = `${"#".repeat(entry.level)} ${entry.heading}`;
  const ann = entry.ann === undefined ? "" : `<!-- lethe: ${entry.ann} -->\n`;
  return `${heading}\n${ann}${expandVariants(entry.body, rng)}\n`;
}

function renderFile(meta: SteeringMeta, entries: readonly Entry[], rng: Rng): string {
  const sections = shuffleBlocks(toBlocks(entries), rng).flat().map((e) => renderEntry(e, rng));
  const front = `---\n${meta.frontmatter.join("\n")}\n---\n`;
  return `${front}# ${meta.title}\n\n${meta.intro}\n\n${sections.join("\n")}`;
}

/** Render every steering file from the authored entries (path -> text, ascending path order). */
export function buildFiles(entries: readonly Entry[], rng: Rng): Map<string, string> {
  const files = new Map<string, string>();
  STEERING_FILES.forEach((meta, i) => {
    const mine = entries.filter((e) => e.file === i + 1);
    files.set(meta.path, renderFile(meta, mine, rng));
  });
  return files;
}
