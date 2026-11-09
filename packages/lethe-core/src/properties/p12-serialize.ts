// P12: serialize(parse(text)) === text, plus structural span invariants.
// Refs: REQ-PAR-1, REQ-PAR-6, REQ-PBT-1

import fc from "fast-check";
import { markdownDocumentArb } from "./arbitraries/engram.arb.js";
import { parseDocument, serializeDocument } from "../parse/document.js";
import type { LetheConfig, ParsedDoc } from "../types.js";

export const P12_ID = "P12";

const ALLOWED_ERRORS: ReadonlySet<string> = new Set([
  "PARSE_INVALID_FRONTMATTER",
  "PARSE_DUPLICATE_ID",
]);

function fail(msg: string): never {
  throw new Error(`${P12_ID} violated: ${msg}`);
}

/** Every engram span must lie in the text and end with the engram's body. */
function checkSpanContent(d: string, doc: ParsedDoc): void {
  for (const e of doc.engrams) {
    const { start, end } = e.span;
    if (start < 0 || end > d.length || start > end) {
      fail(`span [${start}, ${end}) of "${e.id}" outside [0, ${d.length}]`);
    }
    if (!d.slice(start, end).endsWith(e.body)) {
      fail(`text at span [${start}, ${end}) of "${e.id}" does not end with its body`);
    }
  }
}

/** Spans are ordered, non-overlapping, and start after the frontmatter block. */
function checkSpanOrder(doc: ParsedDoc): void {
  const fmLen = doc.frontmatter?.length ?? 0;
  const spans = doc.engrams.map((e) => e.span);
  const first = spans[0];
  if (first !== undefined && first.start < fmLen) {
    fail(`first span starts at ${first.start}, before frontmatter end ${fmLen}`);
  }
  for (let i = 0; i + 1 < spans.length; i++) {
    const a = spans[i];
    const b = spans[i + 1];
    if (a !== undefined && b !== undefined && a.end > b.start) {
      fail(`span ${i} ends at ${a.end} but span ${i + 1} starts at ${b.start}`);
    }
  }
}

function checkDocument(d: string, cfg: LetheConfig): void {
  const result = parseDocument("steering/p12.md", d, cfg);
  if (!result.ok) {
    if (!ALLOWED_ERRORS.has(result.error.code)) {
      fail(`unexpected parse error ${result.error.code}: ${result.error.message}`);
    }
    return;
  }
  if (serializeDocument(result.value) !== d) fail("serializeDocument(parse(d)) !== d");
  checkSpanContent(d, result.value);
  checkSpanOrder(result.value);
}

export function p12Serialize(cfg: LetheConfig) {
  return fc.property(markdownDocumentArb, (d) => {
    checkDocument(d, cfg);
  });
}
