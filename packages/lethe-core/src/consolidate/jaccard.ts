/**
 * Token-set Jaccard similarity for near-duplicate detection (REQ-CRY-5, REQ-CRY-13).
 *
 * DELIBERATE DEVIATION from the spec text `[^\w\s]`: JS `\w` is ASCII-only, so that
 * class would delete every CJK / Arabic / Hebrew / accented letter and make
 * non-English bodies tokenize to nothing (all such bodies would then look
 * "identical" or "empty"). We use the Unicode-aware class `[^\p{L}\p{N}_\s]`
 * instead, replacing matches with a SPACE (so "foo-bar" -> "foo bar" and
 * "a.b" does not fuse into "ab").
 *
 * Combining marks (\p{M}) are KEPT inside tokens: Hindi vowel signs
 * ("हिन्दी") and Arabic harakat ("مَرْحَبًا") are marks, and treating them as
 * punctuation would shatter one word into fragments. NFC makes
 * composed/decomposed forms of the same letter compare equal.
 *
 * Pipeline: cap -> NFC normalise -> drop zero-width chars -> toLowerCase
 * (locale-independent) -> punctuation to space -> split on whitespace -> drop empties.
 */

/** Only the first MAX_CHARS characters of each body are tokenised, to bound cost. */
export const JACCARD_MAX_CHARS = 100_000;

const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/gu;
const NON_TOKEN = /[^\p{L}\p{M}\p{N}_\s]/gu;
const WHITESPACE = /\s+/u;

/** Tokenise a body into a set of lowercase word tokens. Pure and total. */
export function tokenize(body: string): ReadonlySet<string> {
  const capped = body.length > JACCARD_MAX_CHARS ? body.slice(0, JACCARD_MAX_CHARS) : body;
  const cleaned = capped
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(NON_TOKEN, " ");
  const out = new Set<string>();
  for (const tok of cleaned.split(WHITESPACE)) {
    if (tok.length > 0) out.add(tok);
  }
  return out;
}

function intersectionSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const t of small) {
    if (large.has(t)) n += 1;
  }
  return n;
}

/**
 * Jaccard similarity |A∩B| / |A∪B| of the token sets of two bodies.
 * Returns 0 when both sets are empty (never NaN). Always in [0, 1] and
 * exactly symmetric: union is computed as |A|+|B|-|A∩B| from integers.
 */
export function jaccard(bodyA: string, bodyB: string): number {
  return jaccardSets(tokenize(bodyA), tokenize(bodyB));
}

/** Set-based Jaccard; `jaccard` delegates here so results are bit-identical. */
export function jaccardSets(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
