// Document parser/serializer: markdown text -> EngramNode[] and back.
// Refs: REQ-PAR-1, REQ-PAR-2, REQ-PAR-3, REQ-PAR-4, REQ-PAR-5, REQ-PAR-6

import { err, ok } from "../result.js";
import type { EngramNode, LetheConfig, LetheError, ParsedDoc, Result } from "../types.js";
import { parseAnnotation } from "./annotation.js";
import { parseFrontmatter } from "./frontmatter.js";
import { sha256 } from "./hash.js";
import { splitSections } from "./section.js";
import type { RawSection } from "./section.js";
import { slugify } from "./slug.js";

/** Build an EngramNode from a raw section; spans are shifted by `offset` into original file text. */
function buildEngram(file: string, raw: RawSection, offset: number): EngramNode {
  const ann = parseAnnotation(raw.body);
  return {
    id: slugify(file, raw.headingPath),
    file,
    headingPath: raw.headingPath,
    body: raw.body,
    contentHash: sha256(raw.body),
    tokens: Math.ceil(raw.body.length / 4),
    globs: ann.globs,
    specLinks: ann.specLinks,
    pinned: ann.pinned,
    span: { start: raw.span.start + offset, end: raw.span.end + offset },
  };
}

/** Return the first duplicated id, or null if all ids are unique. */
function findDuplicateId(engrams: readonly EngramNode[]): string | null {
  const seen = new Set<string>();
  for (const e of engrams) {
    if (seen.has(e.id)) return e.id;
    seen.add(e.id);
  }
  return null;
}

/**
 * Parse a markdown file into engrams. Spans are offsets into the ORIGINAL `text`
 * (frontmatter included). Fails on invalid frontmatter or duplicate engram ids.
 */
export function parseDocument(
  file: string,
  text: string,
  cfg: LetheConfig,
): Result<ParsedDoc, LetheError> {
  const fmResult = parseFrontmatter(text);
  if (!fmResult.ok) return err(fmResult.error);

  const { fm, rest } = fmResult.value;
  const offset = text.length - rest.length;
  const sections = splitSections(rest, cfg.granularity);
  const engrams = sections.map((s) => buildEngram(file, s, offset));

  const dup = findDuplicateId(engrams);
  if (dup !== null) {
    return err({
      code: "PARSE_DUPLICATE_ID",
      message: `Duplicate engram id "${dup}" in ${file}.`,
      detail: { id: dup },
    });
  }

  return ok({ file, frontmatter: fm, engrams, rawText: text });
}

/** Inverse of parseDocument: the original text, byte-for-byte. */
export function serializeDocument(doc: ParsedDoc): string {
  return doc.rawText;
}
