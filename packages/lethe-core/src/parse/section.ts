// Splits a markdown text into raw sections for the parser pipeline.
// Refs: REQ-PAR-1

import { splitLines } from "./lines.js";
import type { RawSection } from "./lines.js";
import { splitByBullets } from "./section-bullets.js";

export type { RawSection } from "./lines.js";

// H2 or H3 heading: exactly "## " or "### " at the start of a line.
const HEADING_RE = /^(#{2,3}) (.+)/;

/**
 * Splits `text` into raw sections according to `granularity`.
 *
 * Section mode: each H2/H3 heading starts a new section whose body runs
 * from the line after the heading up to (but not including) the next
 * heading of equal-or-higher level, or end of text.
 *
 * Bullet mode: each top-level list item starts a new section whose body
 * includes its sub-list lines (indented 2+ spaces), up to the next
 * top-level item or end of text.
 */
export function splitSections(
  text: string,
  granularity: "section" | "bullet",
): readonly RawSection[] {
  return granularity === "section"
    ? splitBySections(text)
    : splitByBullets(text);
}

// ---------------------------------------------------------------------------
// Section mode
// ---------------------------------------------------------------------------

interface PendingSection {
  headingPath: readonly string[];
  level: number; // 2 or 3
  bodyStart: number; // char offset of first body char
  headingStart: number; // char offset of first char of heading line
}

type HeadingStack = Array<{ level: number; text: string }>;

/** Pops the stack back to the parent of this heading, pushes it, returns its level. */
function pushHeading(stack: HeadingStack, match: RegExpExecArray): number {
  const level = (match[1] ?? "").length; // 2 or 3
  while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
    stack.pop();
  }
  stack.push({ level, text: (match[2] ?? "").trim() });
  return level;
}

function splitBySections(text: string): readonly RawSection[] {
  const results: RawSection[] = [];
  let offset = 0;
  // Stack of open headings: outermost first.
  const stack: HeadingStack = [];
  let pending: PendingSection | null = null;

  for (const { line, start, end } of splitLines(text)) {
    offset = end;
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch === null) continue;
    // Close pending section: its body ends at the start of this heading.
    if (pending !== null) results.push(closeSection(pending, text, start));
    const level = pushHeading(stack, headingMatch);
    pending = {
      headingPath: stack.map((h) => h.text),
      level,
      bodyStart: end, // body starts right after the heading line's newline
      headingStart: start,
    };
  }

  // Close the last open section at end of text.
  if (pending !== null) results.push(closeSection(pending, text, offset));
  return results;
}

function closeSection(
  pending: PendingSection,
  text: string,
  spanEnd: number,
): RawSection {
  const body = text.slice(pending.bodyStart, spanEnd);
  return {
    headingPath: pending.headingPath,
    body,
    span: { start: pending.headingStart, end: spanEnd },
  };
}
