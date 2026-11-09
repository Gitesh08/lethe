// Unit tests for the lethe-core parser (tasks 2.3, 3.4, 4.2).
// Refs: REQ-PAR-1, REQ-PAR-2, REQ-PAR-3, REQ-PAR-4, REQ-PAR-5, REQ-PAR-6
// Tests may import node:crypto; src may not (INV-7).

import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseAnnotation } from "../src/parse/annotation.js";
import { parseDocument, serializeDocument } from "../src/parse/document.js";
import { parseFrontmatter } from "../src/parse/frontmatter.js";
import { sha256 } from "../src/parse/hash.js";
import { splitSections } from "../src/parse/section.js";
import { slugify } from "../src/parse/slug.js";
import type { LetheConfig, ParsedDoc } from "../src/types.js";

const SECTION_CFG: LetheConfig = { ...DEFAULT_CONFIG, granularity: "section" };
const BULLET_CFG: LetheConfig = { ...DEFAULT_CONFIG, granularity: "bullet" };

function nodeSha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function parseOk(text: string, cfg: LetheConfig = SECTION_CFG, file = "steering/x.md"): ParsedDoc {
  const r = parseDocument(file, text, cfg);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

// ---------------------------------------------------------------------------
// 2.3 — sha256 + slugify
// ---------------------------------------------------------------------------
describe("sha256", () => {
  it("matches NIST vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with node:crypto for ASCII, CJK, Arabic, emoji and long inputs", () => {
    const inputs = ["hello world", "日本語のテキスト", "مرحبا بالعالم", "memory 🧠👻 crypt", "x".repeat(1000), "é ñ ü"];
    for (const s of inputs) expect(sha256(s)).toBe(nodeSha(s));
  });

  it("agrees with node:crypto on random unicode strings (after normalization)", () => {
    const normalize = (s: string): string =>
      s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n");
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 300 }), (s) => sha256(s) === nodeSha(normalize(s))),
      { numRuns: 100 },
    );
  });

  it("normalizes CRLF to LF", () => {
    expect(sha256("a\r\nb\r\n")).toBe(sha256("a\nb\n"));
  });

  it("ignores trailing whitespace on each line", () => {
    expect(sha256("a  \nb\t\n")).toBe(sha256("a\nb\n"));
  });

  it("still distinguishes different content", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("slugify", () => {
  it("joins path and headings with # then hyphenates", () => {
    expect(slugify("steering/03-rules.md", ["Core Rules", "Typing"])).toBe("steering-03-rules-md-core-rules-typing");
  });

  it("handles an empty headingPath", () => {
    expect(slugify("a/b.md", [])).toBe("a-b-md");
  });

  it("collapses special-character runs and trims hyphens", () => {
    expect(slugify("f.md", ["  Hello, World!!  ", "(C++ & Rust)"])).toBe("f-md-hello-world-c-rust");
  });

  it("is stable when body changes but contentHash changes", () => {
    const a = parseOk("## Rule\nuse zod\n").engrams[0]!;
    const b = parseOk("## Rule\nuse valibot\n").engrams[0]!;
    expect(a.id).toBe(b.id);
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it("changes when the heading changes", () => {
    expect(slugify("f.md", ["A"])).not.toBe(slugify("f.md", ["B"]));
  });
});

// ---------------------------------------------------------------------------
// 3.4 — frontmatter, sections, annotations
// ---------------------------------------------------------------------------
describe("parseFrontmatter", () => {
  it("returns null frontmatter when absent", () => {
    const r = parseFrontmatter("## A\nx\n");
    expect(r).toEqual({ ok: true, value: { fm: null, rest: "## A\nx\n" } });
  });

  it("handles CRLF delimiters and preserves them", () => {
    const text = "---\r\ntitle: x\r\n---\r\n## A\r\nbody\r\n";
    const r = parseFrontmatter(text);
    expect(r.ok && r.value.fm).toBe("---\r\ntitle: x\r\n---\r\n");
    expect(r.ok && r.value.rest).toBe("## A\r\nbody\r\n");
  });

  it("closes on the first closing --- only", () => {
    const text = "---\na: 1\n---\n---\n## A\n";
    const r = parseFrontmatter(text);
    expect(r.ok && r.value.fm).toBe("---\na: 1\n---\n");
    expect(r.ok && r.value.rest).toBe("---\n## A\n");
  });

  it("errors with PARSE_INVALID_FRONTMATTER when never closed", () => {
    const r = parseFrontmatter("---\na: 1\n## A\nbody\n");
    expect(!r.ok && r.error.code).toBe("PARSE_INVALID_FRONTMATTER");
  });

  it("does not treat '---x' as an opening delimiter", () => {
    const r = parseFrontmatter("---x\n## A\n");
    expect(r.ok && r.value.fm).toBeNull();
  });
});

describe("splitSections", () => {
  it("tracks H3 nested under H2 in headingPath and resets on next H2", () => {
    const s = splitSections("## A\na\n### B\nb\n## C\nc\n", "section");
    expect(s.map((x) => x.headingPath)).toEqual([["A"], ["A", "B"], ["C"]]);
    expect(s.map((x) => x.body)).toEqual(["a\n", "b\n", "c\n"]);
  });

  it("returns no sections for heading-less text and ignores H1/H4", () => {
    expect(splitSections("# Title\n#### Deep\ntext\n", "section")).toEqual([]);
  });

  it("bullet mode: nested sub-lists stay in the parent; ids are zero-based indexes", () => {
    const text = "- a\n  - a1\n  - a2\n- b\n* c\n1. d\n";
    const s = splitSections(text, "bullet");
    expect(s.map((x) => x.headingPath)).toEqual([["0"], ["1"], ["2"], ["3"]]);
    expect(s[0]?.body).toBe("- a\n  - a1\n  - a2\n");
    expect(s[1]?.body).toBe("- b\n");
    for (const x of s) expect(text.slice(x.span.start, x.span.end)).toBe(x.body);
  });

  it("bullet ids via parseDocument are slugged with the index", () => {
    const doc = parseOk("- one\n- two\n", BULLET_CFG, "m.md");
    expect(doc.engrams.map((e) => e.id)).toEqual(["m-md-0", "m-md-1"]);
  });
});

describe("parseAnnotation", () => {
  it("parses all keys", () => {
    expect(parseAnnotation("<!-- lethe: globs=**/*.ts, src/*.tsx; spec=lethe-core,lethe-mcp; pin=true -->")).toEqual({
      globs: ["**/*.ts", "src/*.tsx"],
      specLinks: ["lethe-core", "lethe-mcp"],
      pinned: true,
    });
  });

  it("parses only pin=true", () => {
    expect(parseAnnotation("text <!-- lethe: pin=true --> more")).toEqual({ globs: [], specLinks: [], pinned: true });
  });

  it("ignores unknown keys and non-true pin values", () => {
    expect(parseAnnotation("<!-- lethe: foo=bar; pin=yes; spec=a -->")).toEqual({
      globs: [],
      specLinks: ["a"],
      pinned: false,
    });
  });

  it("returns defaults when there is no annotation", () => {
    expect(parseAnnotation("just text <!-- other: pin=true -->")).toEqual({ globs: [], specLinks: [], pinned: false });
  });
});

// ---------------------------------------------------------------------------
// 4.2 — parseDocument / serializeDocument
// ---------------------------------------------------------------------------
const VAULT = [
  "---",
  "inclusion: always",
  "---",
  "# 03 — Rules",
  "",
  "## TypeScript",
  "<!-- lethe: pin=true; globs=**/*.ts -->",
  "- strict mode on",
  "",
  "### Imports",
  "ESM only. 日本語 🧠",
  "",
  "## CSS",
  "Pure CSS modules.",
  "",
].join("\n");

describe("parseDocument / serializeDocument", () => {
  it("round-trips a vault-style file byte-for-byte", () => {
    const doc = parseOk(VAULT);
    expect(serializeDocument(doc)).toBe(VAULT);
    expect(doc.engrams.map((e) => e.headingPath)).toEqual([["TypeScript"], ["TypeScript", "Imports"], ["CSS"]]);
  });

  it("round-trips CRLF documents", () => {
    const text = VAULT.replace(/\n/g, "\r\n");
    expect(serializeDocument(parseOk(text))).toBe(text);
  });

  it("returns PARSE_DUPLICATE_ID with no partial value", () => {
    const r = parseDocument("f.md", "## A\nx\n## A\ny\n", SECTION_CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PARSE_DUPLICATE_ID");
  });

  it("detects duplicates that differ only in punctuation/case", () => {
    const r = parseDocument("f.md", "## A b\nx\n## a-B\ny\n", SECTION_CFG);
    expect(!r.ok && r.error.code).toBe("PARSE_DUPLICATE_ID");
  });

  it("propagates PARSE_INVALID_FRONTMATTER", () => {
    const r = parseDocument("f.md", "---\nx: 1\n## A\n", SECTION_CFG);
    expect(!r.ok && r.error.code).toBe("PARSE_INVALID_FRONTMATTER");
  });

  it("accepts an empty document with zero engrams", () => {
    const doc = parseOk("");
    expect(doc.engrams).toEqual([]);
    expect(doc.frontmatter).toBeNull();
    expect(serializeDocument(doc)).toBe("");
  });

  it("accepts heading-less and bullet-less documents with zero engrams", () => {
    expect(parseOk("just prose\n").engrams).toEqual([]);
    expect(parseOk("## A\nx\n", BULLET_CFG).engrams).toEqual([]);
  });

  it("preserves frontmatter exactly and never makes it an engram", () => {
    const doc = parseOk(VAULT);
    const fm = "---\ninclusion: always\n---\n";
    expect(doc.frontmatter).toBe(fm);
    expect(VAULT.startsWith(doc.frontmatter ?? "?")).toBe(true);
    for (const e of doc.engrams) {
      expect(e.span.start).toBeGreaterThanOrEqual(fm.length);
      expect(e.body).not.toContain("inclusion: always");
    }
  });

  it("computes tokens as ceil(body.length / 4) and hash of the body", () => {
    const doc = parseOk(VAULT);
    for (const e of doc.engrams) {
      expect(e.tokens).toBe(Math.ceil(e.body.length / 4));
      expect(e.contentHash).toBe(sha256(e.body));
    }
    expect(parseOk("## A\nabcde\n").engrams[0]?.tokens).toBe(2); // "abcde\n" = 6 chars
  });

  it("span invariant: slice starts at heading line and ends where body ends", () => {
    const doc = parseOk(VAULT);
    expect(doc.engrams.length).toBe(3);
    for (const e of doc.engrams) {
      const slice = VAULT.slice(e.span.start, e.span.end);
      expect(slice).toMatch(/^#{2,3} /);
      expect(slice.endsWith(e.body)).toBe(true);
      const headingLine = slice.slice(0, slice.length - e.body.length);
      expect(headingLine.endsWith(`${e.headingPath[e.headingPath.length - 1] ?? "?"}\n`)).toBe(true);
    }
  });

  it("span invariant holds with CRLF and without a trailing newline", () => {
    const text = "---\r\na: 1\r\n---\r\n## A\r\nx\r\n### B\r\ny";
    const doc = parseOk(text);
    for (const e of doc.engrams) {
      const slice = text.slice(e.span.start, e.span.end);
      expect(slice.startsWith("##")).toBe(true);
      expect(slice.endsWith(e.body)).toBe(true);
    }
    expect(doc.engrams[1]?.body).toBe("y");
  });

  it("parses annotations into engram metadata", () => {
    const e = parseOk(VAULT).engrams[0]!;
    expect(e.pinned).toBe(true);
    expect(e.globs).toEqual(["**/*.ts"]);
    expect(e.specLinks).toEqual([]);
  });
});
