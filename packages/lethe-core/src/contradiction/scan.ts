/**
 * Stance scanner: sentence-level regex matching with a 4-token negation lookbehind.
 * Pure and deterministic; body is truncated before any regex runs (ReDoS cap).
 * Covers: REQ-CON-2.
 */
import type { StanceMatch } from "../types.js";
import type { CompiledOntology, CompiledStance } from "./compiled-types.js";
import { negationInWindow, splitSentences, stripMarkdownNoise } from "./sentences.js";

export { negationInWindow, splitSentences } from "./sentences.js";

export const MAX_SCAN_CHARS = 8192;

/** Index of the first regex match of the stance in the sentence, or -1. */
function firstMatchIndex(stance: CompiledStance, sentence: string): number {
  for (const regex of stance.regexes) {
    const m = regex.exec(sentence);
    if (m !== null) return m.index;
  }
  return -1;
}

function scanSentence(sentence: string, compiled: CompiledOntology): StanceMatch[] {
  const out: StanceMatch[] = [];
  for (const axis of compiled) {
    for (const stance of axis.stances) {
      const index = firstMatchIndex(stance, sentence);
      if (index < 0) continue;
      const negated = stance.negationAware && negationInWindow(sentence.slice(0, index));
      out.push({
        axisId: axis.id,
        stanceId: stance.id,
        polarity: negated ? "-" : "+",
        evidence: sentence,
      });
    }
  }
  return out;
}

/** Detect stances asserted (+) or negated (-) in an engram body. */
export function scanEngram(body: string, compiled: CompiledOntology): readonly StanceMatch[] {
  const capped = body.length > MAX_SCAN_CHARS ? body.slice(0, MAX_SCAN_CHARS) : body;
  const out: StanceMatch[] = [];
  for (const raw of splitSentences(capped)) {
    const sentence = stripMarkdownNoise(raw);
    if (sentence.length === 0) continue;
    out.push(...scanSentence(sentence, compiled));
  }
  return out;
}
