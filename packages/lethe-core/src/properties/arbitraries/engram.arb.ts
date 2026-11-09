// Arbitraries producing synthetic markdown documents for parser PBTs.
// Refs: REQ-PBT-4
import * as fc from "fast-check";

const WORDS: readonly string[] = [
  "alpha", "state", "use", "never", "avoid", "prefer", "css", "tests",
  "日本語", "中文", "한국어", "مرحبا", "שלום", "e\u0301", "a\u0308\u0323",
  "zero\u200Bwidth", "😀", "👩‍💻", "𝒳", "naïve", "Ünï", "`code`", "**bold**",
];

const TITLES: readonly string[] = [
  "Rules", "Notes", "Setup", "State", "Styling", "日本語の見出し",
  "عنوان", "כותרת", "Cafe\u0301", "Zero\u200BWidth", "Emoji 😀", "  Padded  ",
];

const ANNOTATION_KEYS: readonly string[] = [
  "globs", "spec", "pin", "unknown", "x-custom", "pin=", "",
];

const wordArb = fc.constantFrom(...WORDS);

const lineArb: fc.Arbitrary<string> = fc
  .array(wordArb, { minLength: 0, maxLength: 8 })
  .map((ws) => ws.join(" "));

const bulletsArb: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(fc.constantFrom(0, 2, 4), fc.constantFrom("-", "*", "1."), lineArb),
    { minLength: 1, maxLength: 5 },
  )
  .map((items) => items.map(([ind, m, t]) => `${" ".repeat(ind)}${m} ${t}`).join("\n"));

const bodyArb: fc.Arbitrary<string> = fc
  .array(fc.oneof({ weight: 3, arbitrary: lineArb }, { weight: 1, arbitrary: bulletsArb }), {
    minLength: 0,
    maxLength: 4,
  })
  .map((parts) => parts.join("\n"));

const annotationArb: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.constantFrom(...ANNOTATION_KEYS),
      fc.constantFrom("true", "false", "src/**/*.ts,*.md", "lethe-core", "", "??"),
    ),
    { minLength: 0, maxLength: 3 },
  )
  .map((kv) => `<!-- lethe: ${kv.map(([k, v]) => `${k}=${v}`).join("; ")} -->`);

function headingArb(titles: readonly string[]): fc.Arbitrary<string> {
  return fc
    .tuple(fc.constantFrom("##", "###"), fc.constantFrom(...titles))
    .map(([hashes, title]) => `${hashes} ${title}`);
}

function sectionArb(titles: readonly string[]): fc.Arbitrary<string> {
  return fc
    .tuple(headingArb(titles), fc.option(annotationArb, { nil: undefined }), bodyArb)
    .map(([h, ann, body]) => [h, ann, body].filter((p) => p !== undefined).join("\n"));
}

const frontmatterArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.tuple(fc.constantFrom("inclusion", "name", "tags"), lineArb), {
      minLength: 0,
      maxLength: 3,
    }),
    fc.boolean(),
  )
  .map(([pairs, closed]) => {
    const lines = pairs.map(([k, v]) => `${k}: ${v}`);
    return ["---", ...lines, ...(closed ? ["---"] : [])].join("\n");
  });

/** How each "\n" is rendered: all LF, all CRLF, or a cycled mixed pattern. */
const eolArb: fc.Arbitrary<readonly boolean[]> = fc.oneof(
  fc.constant<readonly boolean[]>([false]),
  fc.constant<readonly boolean[]>([true]),
  fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
);

function applyEol(text: string, crlf: readonly boolean[]): string {
  let i = 0;
  return text.replace(/\n/g, () => (crlf[i++ % crlf.length] === true ? "\r\n" : "\n"));
}

function build(
  titles: readonly string[],
  fmWeight: number,
): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.option(frontmatterArb, { freq: fmWeight, nil: undefined }),
      bodyArb,
      fc.array(sectionArb(titles), { minLength: 0, maxLength: 10 }),
      eolArb,
      fc.boolean(),
    )
    .map(([fm, preamble, sections, eol, trailingNl]) => {
      const raw = [fm, preamble, ...sections].filter((p) => p !== undefined).join("\n");
      const text = applyEol(raw + (trailingNl ? "\n" : ""), eol);
      return text;
    });
}

/** General synthetic markdown documents (includes empty and zero-heading docs). */
export const markdownDocumentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constant("") },
  { weight: 12, arbitrary: build(TITLES, 3) },
);

const COLLIDING_TITLES: readonly string[] = ["Rules", "rules", "Rules!", "Cafe\u0301", "Café"];

/** Biased toward nasty cases: duplicate-id collisions, unicode + CRLF, empty. */
export const adversarialMarkdownArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constant("") },
  { weight: 1, arbitrary: fc.constantFrom("---\n", "---\r\n", "---", "## ", "###", "\r\n", "\n\n") },
  { weight: 5, arbitrary: build(COLLIDING_TITLES, 2) },
  {
    weight: 5,
    arbitrary: build(COLLIDING_TITLES, 2).map((t) => applyEol(t.replace(/\r\n/g, "\n"), [true])),
  },
);
