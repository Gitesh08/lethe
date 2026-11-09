/**
 * Sentence splitting and negation-window helpers for stance scanning.
 * Pure, total, no IO. Covers: REQ-CON-2.
 */

const ABBREVIATIONS: ReadonlyArray<string> = ["e.g", "i.e", "etc", "vs"];
const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  "never", "avoid", "no", "not", "don't", "dont", "shouldn't", "mustn't",
  "cannot", "can't", "without",
]);

/** Number of tokens before a match that are inspected for negation. */
export const NEGATION_WINDOW = 4;

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

function endsWithAbbreviation(segment: string): boolean {
  const lower = segment.toLowerCase();
  return ABBREVIATIONS.some((a) => lower.endsWith(a) && !/[a-z0-9]/.test(lower.charAt(lower.length - a.length - 1)));
}

/** A `.` ends a sentence only before whitespace/end, not after a bare list number or abbreviation. */
function dotEndsSentence(text: string, i: number, start: number): boolean {
  if (!isSpace(text[i + 1])) return false;
  const segment = text.slice(start, i);
  if (/^\s*\d+$/.test(segment)) return false;
  return !endsWithAbbreviation(segment);
}

/** Split text into trimmed, non-empty sentences (markdown noise not yet stripped). */
export function splitSentences(text: string): readonly string[] {
  const out: string[] = [];
  let start = 0;
  const push = (end: number): void => {
    const s = text.slice(start, end).trim();
    if (s.length > 0) out.push(s);
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "!" || ch === "?" || ch === "\n" || ch === "\r") push(i);
    else if (ch === "." && dotEndsSentence(text, i, start)) push(i);
  }
  push(text.length);
  return out;
}

/** Strip leading list markers, heading hashes and quote markers. */
export function stripMarkdownNoise(sentence: string): string {
  return sentence.replace(/^\s*(?:(?:[-*+>#]+|\d+\.)\s+)+/, "").trim();
}

function toTokens(text: string): readonly string[] {
  return text
    .replace(/\u2019/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "").toLowerCase())
    .filter((t) => t.length > 0);
}

/** True when the last NEGATION_WINDOW tokens of `before` contain a negation trigger. */
export function negationInWindow(before: string): boolean {
  const window = toTokens(before).slice(-NEGATION_WINDOW);
  if (window.some((t) => NEGATION_TOKENS.has(t))) return true;
  for (let i = 0; i + 1 < window.length; i++) {
    if (window[i] === "instead" && window[i + 1] === "of") return true;
  }
  return false;
}
