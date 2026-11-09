// Placement helpers for resurrect(): decide WHERE a buried raw engram goes back
// and splice it in with minimal newline hygiene. Pure and total.
// Refs: REQ-CRY-3, REQ-CRY-7, INV-3, INV-7
import type { EngramNode, TombstoneRecord } from "../types.js";

export type PlacementKind = "neighbor" | "index" | "fallback";

export interface Placed {
  readonly text: string;
  readonly placement: PlacementKind;
}

const FALLBACK_HEADING = "Resurrected";

/** Dominant EOL: CRLF when the text contains one, otherwise LF. */
function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Splice `raw` into `text` at `offset`. Newline hygiene only when needed:
 * a missing "\n" before the insertion point, or after raw when text follows.
 * In the normal archive -> resurrect case neither applies (byte-exact restore).
 */
export function splice(text: string, offset: number, raw: string): string {
  const eol = eolOf(text);
  const before = offset > 0 && text.charAt(offset - 1) !== "\n" ? eol : "";
  const after = !raw.endsWith("\n") && offset < text.length ? eol : "";
  return text.slice(0, offset) + before + raw + after + text.slice(offset);
}

/** Offset chosen by the neighbor / index rules, or undefined when neither applies. */
function chooseOffset(
  text: string,
  engrams: readonly EngramNode[],
  pos: TombstoneRecord["position"],
): { offset: number; placement: "neighbor" | "index" } | undefined {
  const { neighborBefore, index } = pos;
  if (neighborBefore !== undefined) {
    const neighbor = engrams.find((g) => g.id === neighborBefore);
    if (neighbor !== undefined) return { offset: neighbor.span.end, placement: "neighbor" };
  } else {
    const first = engrams[0];
    return { offset: first === undefined ? text.length : first.span.start, placement: "index" };
  }
  if (!Number.isInteger(index) || index < 0 || index > engrams.length) return undefined;
  const at = engrams[index];
  return { offset: at === undefined ? text.length : at.span.start, placement: "index" };
}

/** Append under a `## Resurrected` section, reusing an existing one. */
function fallback(text: string, engrams: readonly EngramNode[], raw: string): string {
  const existing = engrams.find(
    (g) => g.headingPath.length === 1 && g.headingPath[0] === FALLBACK_HEADING,
  );
  if (existing !== undefined) return splice(text, existing.span.end, raw);
  const eol = eolOf(text);
  const head = text.length > 0 && !text.endsWith("\n") ? text + eol : text;
  // One blank line before the heading, unless the text already ends with one.
  const gap = head.length === 0 || head.endsWith(eol + eol) ? "" : eol;
  return `${head}${gap}## ${FALLBACK_HEADING}${eol}${raw}`;
}

/**
 * Insert `tomb.raw` into `text` (parsed as `engrams`).
 * Rules, in order: (a) right after the surviving neighborBefore; (b) first engram
 * (no neighborBefore): before engrams[0]; (c) the original index when in range;
 * (d) fallback `## Resurrected` section at the end of the file.
 * Step (a)/(b) refine the pure index rule so moved neighbors are followed.
 */
export function placeRaw(
  text: string,
  engrams: readonly EngramNode[],
  tomb: TombstoneRecord,
): Placed {
  const chosen = chooseOffset(text, engrams, tomb.position);
  if (chosen === undefined) {
    return { text: fallback(text, engrams, tomb.raw), placement: "fallback" };
  }
  return { text: splice(text, chosen.offset, tomb.raw), placement: chosen.placement };
}
