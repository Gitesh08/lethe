// Frontmatter parser for steering/spec markdown files.
// Refs: REQ-PAR-6

import { err, ok } from "../result.js";
import type { LetheError, Result } from "../types.js";

/**
 * Attempts to parse a YAML frontmatter block from the start of `text`.
 *
 * Rules:
 *   - Text does NOT start with `---` followed immediately by LF or CRLF
 *     → `ok({ fm: null, rest: text })`
 *   - Text starts with `---\n` (or `---\r\n`) AND a later line contains
 *     only `---` (optionally followed by `\r`)
 *     → `ok({ fm: rawBlock, rest: remainder })`
 *     where `rawBlock` includes the opening delimiter line through and
 *     including the closing delimiter line (plus its newline), and `rest`
 *     starts at the first character after the closing delimiter line.
 *   - Text starts with the opening delimiter but no closing `---` line
 *     is found before EOF
 *     → `err({ code: "PARSE_INVALID_FRONTMATTER", ... })`
 *
 * Refs: REQ-PAR-6
 */
export function parseFrontmatter(
  text: string,
): Result<{ fm: string | null; rest: string }, LetheError> {
  // The opening delimiter must be exactly `---` followed by LF or CRLF.
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return ok({ fm: null, rest: text });
  }

  // Walk line-by-line from the second line onwards looking for the closing `---`.
  const lines = splitLines(text);

  // lines[0] is the opening `---` (we already confirmed this above).
  for (let i = 1; i < lines.length; i++) {
    const record = lines[i];
    if (record !== undefined && record.content === "---") {
      // Found the closing delimiter.
      const fmEnd = record.end; // exclusive end of the closing line
      const rawBlock = text.slice(0, fmEnd);
      const rest = text.slice(fmEnd);
      return ok({ fm: rawBlock, rest });
    }
  }

  // No closing delimiter found.
  return err({
    code: "PARSE_INVALID_FRONTMATTER",
    message:
      'Frontmatter block opened with "---" but no closing "---" line was found before end-of-file.',
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LineRecord {
  /** Line content without the trailing newline characters. */
  readonly content: string;
  /** Exclusive end offset of this line in the original string (includes newline). */
  readonly end: number;
}

/**
 * Splits `text` into line records, each carrying the content (without the
 * trailing CR/LF) and the exclusive end offset in the original string.
 * The final line may have no trailing newline; its `end` equals `text.length`.
 */
function splitLines(text: string): readonly LineRecord[] {
  const records: LineRecord[] = [];
  let pos = 0;

  while (pos < text.length) {
    const lfIdx = text.indexOf("\n", pos);

    if (lfIdx === -1) {
      // Last line with no trailing newline.
      records.push({ content: text.slice(pos), end: text.length });
      break;
    }

    // Determine content without the trailing newline (and optional CR).
    const lineEnd = lfIdx + 1; // exclusive: includes the `\n`
    const rawContent = text.slice(pos, lfIdx);
    const content = rawContent.endsWith("\r")
      ? rawContent.slice(0, -1)
      : rawContent;

    records.push({ content, end: lineEnd });
    pos = lineEnd;
  }

  return records;
}
