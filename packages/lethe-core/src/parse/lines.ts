// Shared line iterator and raw-section shape for the section/bullet splitters.
// Refs: REQ-PAR-1

export interface RawSection {
  readonly headingPath: readonly string[];
  readonly body: string;
  readonly span: { readonly start: number; readonly end: number };
}

export interface LineEntry {
  readonly line: string; // without the trailing newline
  readonly start: number; // offset of first char of line (including heading marker)
  readonly end: number; // exclusive offset one past the \n (or end of text)
}

export function splitLines(text: string): readonly LineEntry[] {
  const entries: LineEntry[] = [];
  let pos = 0;

  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) {
      // Last line, no trailing newline.
      entries.push({ line: text.slice(pos), start: pos, end: text.length });
      break;
    }
    // Include the \n in `end` so that slicing [bodyStart, spanEnd] captures it.
    const lineText = text.slice(pos, nl);
    entries.push({ line: lineText, start: pos, end: nl + 1 });
    pos = nl + 1;
  }

  return entries;
}
