// Minimal pure glob matcher (minimatch-compatible subset), no dependencies.
// Supports: * ** ?  [abc] [a-z] [!abc]  {a,b} (non-nested)  \ escapes.
// Compiles to an anchored RegExp; every other regex metachar is escaped.
// Total: invalid or over-cap patterns/paths yield "no match", never a throw.
// Refs: REQ-DEC-5, INV-7

const MAX_PATTERN = 512;
const MAX_PATH = 1024;

type Piece = readonly [src: string, next: number];

function escapeChar(c: string): string {
  return /[\\^$.*+?()[\]{}|/-]/.test(c) ? `\\${c}` : c;
}

/** Backslashes to `/`, strip leading `./`. */
export function normalizePath(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.startsWith("./") ? p.slice(2) : p;
}

function starPiece(p: string, i: number): Piece {
  if (p[i + 1] !== "*") return ["[^/]*", i + 1];
  if (p[i + 2] === "/") return ["(?:.*/)?", i + 3];
  return [".*", i + 2];
}

/** One character of a class body: [regex text, next index]. */
function classChar(p: string, j: number): Piece {
  const c = p[j] ?? "";
  if (c === "\\" && j + 1 < p.length) return [escapeChar(p[j + 1] ?? ""), j + 2];
  return [c === "\\" || c === "[" || c === "]" || c === "^" ? `\\${c}` : c, j + 1];
}

function classPiece(p: string, i: number): Piece | null {
  const neg = p[i + 1] === "!" || p[i + 1] === "^";
  const start = neg ? i + 2 : i + 1;
  let j = start;
  let body = "";
  // A "]" in first position is a literal member of the class.
  while (j < p.length && (p[j] !== "]" || j === start)) {
    const [text, next] = classChar(p, j);
    body += text;
    j = next;
  }
  if (j >= p.length || body.length === 0) return null;
  return [`[${neg ? "^" : ""}${body}${neg ? "\\/" : ""}]`, j + 1];
}

/** Index of the first unescaped `}` at or after `from`, or -1. */
function findClose(p: string, from: number): number {
  for (let j = from; j < p.length; j += 1) {
    if (p[j] === "\\") j += 1;
    else if (p[j] === "}") return j;
  }
  return -1;
}

/** Split on unescaped commas. */
function splitAlternatives(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let j = 0; j < s.length; j += 1) {
    const c = s[j] ?? "";
    if (c === "\\" && j + 1 < s.length) {
      cur += c + (s[j + 1] ?? "");
      j += 1;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function bracePiece(p: string, i: number): Piece | null {
  const close = findClose(p, i + 1);
  if (close < 0) return null;
  const parts: string[] = [];
  for (const alt of splitAlternatives(p.slice(i + 1, close))) {
    const src = compileFragment(alt);
    if (src === null) return null;
    parts.push(src);
  }
  return [`(?:${parts.join("|")})`, close + 1];
}

function nextPiece(p: string, i: number): Piece | null {
  const c = p[i] ?? "";
  switch (c) {
    case "*":
      return starPiece(p, i);
    case "?":
      return ["[^/]", i + 1];
    case "[":
      return classPiece(p, i);
    case "{":
      return bracePiece(p, i);
    case "\\":
      return i + 1 < p.length ? [escapeChar(p[i + 1] ?? ""), i + 2] : null;
    default:
      return [escapeChar(c), i + 1];
  }
}

/** Compile to regex source (unanchored), or null when invalid. */
function compileFragment(p: string): string | null {
  let out = "";
  let i = 0;
  while (i < p.length) {
    const piece = nextPiece(p, i);
    if (piece === null) return null;
    out += piece[0];
    i = piece[1];
  }
  return out;
}

/** Compile a glob into an anchored RegExp; null if invalid or over the length cap. */
export function compileGlob(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > MAX_PATTERN) return null;
  const p = pattern.startsWith("./") ? pattern.slice(2) : pattern;
  const src = compileFragment(p);
  if (src === null) return null;
  try {
    return new RegExp(`^${src}$`);
  } catch {
    return null;
  }
}

/** Test an already-compiled glob against a path that is already normalised. */
export function testGlob(re: RegExp, normalizedPath: string): boolean {
  return normalizedPath.length <= MAX_PATH && re.test(normalizedPath);
}

export function globMatch(pattern: string, path: string): boolean {
  const re = compileGlob(pattern);
  return re !== null && testGlob(re, normalizePath(path));
}
