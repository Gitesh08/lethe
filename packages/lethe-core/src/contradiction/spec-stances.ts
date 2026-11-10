/**
 * Derive the ontology stance ids a spec's normative text asserts (positive polarity only).
 * The caller selects the normative paragraphs (SHALL paragraphs); this function only chunks
 * the text so scanEngram's 8,192-char cap never truncates it. Pure, total, deterministic.
 * Covers: Req 10.3 (lethe-mcp), REQ-CON-1.
 */
import type { CompiledOntology } from "./compiled-types.js";
import { scanEngram } from "./scan.js";
import { splitSentences } from "./sentences.js";

/** Maximum chunk size handed to scanEngram (below its MAX_SCAN_CHARS of 8,192). */
export const SPEC_CHUNK_CHARS = 8000;

/** Greedily pack units into chunks of at most `limit` chars, joined by `sep`. */
function pack(units: readonly string[], sep: string, limit: number): readonly string[] {
  const out: string[] = [];
  let cur = "";
  for (const unit of units) {
    if (cur.length === 0) cur = unit;
    else if (cur.length + sep.length + unit.length <= limit) cur += sep + unit;
    else {
      out.push(cur);
      cur = unit;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Hard-split a unit that has no usable boundary (e.g. one 9,000-char sentence). */
function hardSplit(text: string, limit: number): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
}

/** Chunks for one paragraph: itself when it fits, else sentence-packed (never truncated). */
function paragraphUnits(paragraph: string, limit: number): readonly string[] {
  if (paragraph.length <= limit) return [paragraph];
  const sentences = splitSentences(paragraph).flatMap((s) =>
    s.length <= limit ? [s] : hardSplit(s, limit),
  );
  return pack(sentences, "\n", limit);
}

/** Split into blank-line separated paragraphs (CRLF and LF alike), dropping empty ones. */
function splitParagraphs(text: string): readonly string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Chunks of at most SPEC_CHUNK_CHARS chars, split at paragraph (then sentence) boundaries. */
export function chunkSpecText(text: string): readonly string[] {
  const units = splitParagraphs(text).flatMap((p) => paragraphUnits(p, SPEC_CHUNK_CHARS));
  return pack(units, "\n\n", SPEC_CHUNK_CHARS);
}

/** Sorted (code-unit order), de-duplicated stance ids asserted with "+" polarity in `text`. */
export function deriveSpecStances(text: string, compiled: CompiledOntology): readonly string[] {
  const ids = new Set<string>();
  for (const chunk of chunkSpecText(text)) {
    for (const match of scanEngram(chunk, compiled)) {
      if (match.polarity === "+") ids.add(match.stanceId);
    }
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
