// Bullet-granularity splitter: each top-level list item is one raw section.
// Refs: REQ-PAR-1

import { splitLines } from "./lines.js";
import type { RawSection } from "./lines.js";

// Top-level bullet: "- ", "* ", or "N. " at column 0.
const BULLET_RE = /^(?:[-*] |\d+\. )/;

// A line is indented sub-content if it starts with 2+ spaces or a tab.
const INDENTED_RE = /^(?:  |\t)/;

interface PendingBullet {
  index: number;
  bodyStart: number; // char offset of first char of bullet marker
  contentEnd: number; // exclusive end of last included char
}

export function splitByBullets(text: string): readonly RawSection[] {
  const results: RawSection[] = [];
  let bulletIndex = 0;
  let pending: PendingBullet | null = null;

  for (const { line, start, end } of splitLines(text)) {
    if (BULLET_RE.test(line)) {
      // New top-level bullet: flush the previous one.
      if (pending !== null) results.push(closeBullet(pending, text));
      pending = { index: bulletIndex++, bodyStart: start, contentEnd: end };
    } else if (pending !== null && (line.trim() === "" || INDENTED_RE.test(line))) {
      // Indented sub-content extends the bullet; blank lines tentatively extend it.
      pending = { index: pending.index, bodyStart: pending.bodyStart, contentEnd: end };
    } else if (pending !== null) {
      // Non-indented, non-bullet, non-blank line terminates the current bullet.
      results.push(closeBullet(pending, text));
      pending = null;
    }
  }

  if (pending !== null) results.push(closeBullet(pending, text));
  return results;
}

function closeBullet(pending: PendingBullet, text: string): RawSection {
  const body = text.slice(pending.bodyStart, pending.contentEnd);
  return {
    headingPath: [String(pending.index)],
    body,
    span: { start: pending.bodyStart, end: pending.contentEnd },
  };
}
