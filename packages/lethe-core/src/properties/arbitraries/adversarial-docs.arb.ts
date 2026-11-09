// Markdown document builders for adversarial workspaces: real text, rendered from a small
// structural description so ids can be learned by parsing it (never guessed).
// Refs: REQ-PBT-4
import fc from "fast-check";

export type Eol = "lf" | "crlf" | "mixed";

export interface SectionSpec {
  readonly heading: string;
  readonly sentences: readonly string[];
  readonly pin: boolean;
  readonly specs: readonly string[];
  readonly globs: readonly string[];
}

export interface Format {
  readonly frontmatter: boolean;
  readonly eol: Eol;
  readonly trailing: boolean;
}

export interface DocSpec extends Format {
  readonly path: string;
  readonly title: boolean;
  readonly sections: readonly SectionSpec[];
}

export const SPEC_NAMES: readonly string[] = ["lethe-core", "lethe-mcp", "spec-a"];
export const GHOST_SPEC = "ghost-spec";
export const PATH_POOL: readonly string[] = [
  ".kiro/steering/a.md",
  ".kiro/steering/b.md",
  ".kiro/steering/c.md",
  "docs/d.md",
];
const GLOB_POOL: readonly string[] = ["src/**", "apps/web/**", "docs/*.md", "**/*.ts"];
const HEAD_WORDS: readonly string[] = ["Rules", "State", "Styling", "Testing", "Notes"];

function annotation(s: SectionSpec): string | null {
  const parts: string[] = [];
  if (s.pin) parts.push("pin=true");
  if (s.specs.length > 0) parts.push(`spec=${s.specs.join(",")}`);
  if (s.globs.length > 0) parts.push(`globs=${s.globs.join(",")}`);
  return parts.length === 0 ? null : `<!-- lethe: ${parts.join("; ")} -->`;
}

function separator(eol: Eol, index: number): string {
  if (eol === "lf") return "\n";
  if (eol === "crlf") return "\r\n";
  return index % 3 === 0 ? "\r\n" : "\n";
}

function joinLines(lines: readonly string[], eol: Eol, trailing: boolean): string {
  let out = "";
  lines.forEach((line, i) => {
    out += line;
    if (i < lines.length - 1 || trailing) out += separator(eol, i);
  });
  return out;
}

/** Render the markdown text of a document. */
export function renderDoc(d: DocSpec): string {
  const lines: string[] = [];
  if (d.frontmatter) lines.push("---", "inclusion: always", "---");
  if (d.title) lines.push("# Title");
  for (const s of d.sections) {
    lines.push(`## ${s.heading}`);
    const a = annotation(s);
    if (a !== null) lines.push(a);
    lines.push(...s.sentences);
  }
  return joinLines(lines, d.eol, d.trailing);
}

/** Copy `sentences`, replacing up to `k` trailing words of the last sentence. */
function mutate(sentences: readonly string[], k: number): readonly string[] {
  const out = [...sentences];
  const last = out.length - 1;
  const words = (out[last] ?? "").split(" ");
  for (let j = 0; j < k; j += 1) {
    const idx = words.length - 1 - j;
    if (idx >= 0) words[idx] = "altered";
  }
  out[last] = words.join(" ");
  return out;
}

export interface DocOpts {
  readonly pool: readonly string[];
  readonly links: fc.Arbitrary<readonly string[]>;
  readonly format: fc.Arbitrary<Format>;
  readonly tails: readonly string[];
  readonly minSections: number;
  readonly maxSections: number;
  readonly minFiles: number;
  readonly maxFiles: number;
}

interface RawSection {
  readonly sentences: readonly string[];
  readonly pin: boolean;
  readonly specs: readonly string[];
  readonly globs: readonly string[];
  readonly word: string;
  readonly tail: string;
  readonly dup: number;
}

function rawSectionArb(o: DocOpts): fc.Arbitrary<RawSection> {
  return fc.record({
    sentences: fc.array(fc.constantFrom(...o.pool), { minLength: 1, maxLength: 3 }),
    pin: fc.oneof({ weight: 4, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
    specs: o.links,
    globs: fc.oneof(
      { weight: 4, arbitrary: fc.constant<readonly string[]>([]) },
      { weight: 1, arbitrary: fc.subarray([...GLOB_POOL], { minLength: 1, maxLength: 2 }) },
    ),
    word: fc.constantFrom(...HEAD_WORDS),
    tail: fc.constantFrom(...o.tails),
    dup: fc.oneof({ weight: 2, arbitrary: fc.constant(-1) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 2 }) }),
  });
}

/** Sections whose bodies sometimes copy the previous section with 0-2 words changed. */
function resolveSections(raws: readonly RawSection[]): readonly SectionSpec[] {
  const out: SectionSpec[] = [];
  raws.forEach((r, i) => {
    const prev = out[i - 1];
    const sentences = r.dup >= 0 && prev !== undefined ? mutate(prev.sentences, r.dup) : r.sentences;
    out.push({ heading: `${r.word}${i}${r.tail}`, sentences, pin: r.pin, specs: r.specs, globs: r.globs });
  });
  return out;
}

export function sectionsArb(o: DocOpts): fc.Arbitrary<readonly SectionSpec[]> {
  return fc
    .array(rawSectionArb(o), { minLength: o.minSections, maxLength: o.maxSections })
    .map(resolveSections);
}

export function docArb(path: string, o: DocOpts): fc.Arbitrary<DocSpec> {
  return fc
    .tuple(o.format, sectionsArb(o))
    .map(([format, sections]) => ({ path, title: true, ...format, sections }));
}

/** Documents at unique paths; the order is random so "first" is an arbitrary file. */
export function docsArb(o: DocOpts): fc.Arbitrary<readonly DocSpec[]> {
  return fc
    .uniqueArray(fc.constantFrom(...PATH_POOL), { minLength: o.minFiles, maxLength: o.maxFiles })
    .chain((paths) => fc.tuple(...paths.map((p) => docArb(p, o))));
}
