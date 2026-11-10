// Pure text helpers for scanning the esbuild bundle. Refs: Req 18.1-18.7
export interface Hit {
  readonly line: number; // 1-based
  readonly module: string;
  readonly text: string;
}

const MODULE_COMMENT = /^\/\/ (\S.*\.(?:js|ts|mjs|cjs|mts|cts|json))$/;

/** Module path (from esbuild's `// path` comments) owning each 0-based line. */
export function moduleByLine(lines: readonly string[]): string[] {
  const out: string[] = [];
  let current = "<banner>";
  for (const l of lines) {
    const m = MODULE_COMMENT.exec(l);
    if (m?.[1] !== undefined) current = m[1];
    out.push(current);
  }
  return out;
}

export function scanBundle(text: string, pattern: RegExp): Hit[] {
  const lines = text.split("\n");
  const owners = moduleByLine(lines);
  const hits: Hit[] = [];
  lines.forEach((l, i) => {
    if (pattern.test(l)) hits.push({ line: i + 1, module: owners[i] ?? "<unknown>", text: l.trim() });
  });
  return hits;
}

export function firstDifferingLine(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) {
      return `line ${i + 1}:\n  built:     ${JSON.stringify(x[i])}\n  committed: ${JSON.stringify(y[i])}`;
    }
  }
  return "no difference";
}

/** Windows drive path (`C:\Users\x`, also JS-escaped `C:\\Users\\x`) not preceded by an identifier char. */
export const DRIVE_PATH = /(?<![A-Za-z0-9_])[A-Za-z]:\\{1,2}[\w.-]+\\{1,2}[\w.-]/;

export const NETWORK_PATTERN =
  /\bfetch\((?!\?)|http\.request|node:http\b|node:https\b|node:net\b/;
