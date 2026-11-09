// JSON-safe projection of arbitrary counterexamples (never throws: cycles, BigInt, functions, depth).
// Refs: REQ-PBT-1, REQ-PBT-3

const MAX_STRING = 2000;
const MAX_DEPTH = 12;

function clip(s: string): string {
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}...[truncated ${s.length - MAX_STRING} chars]` : s;
}

function projectObject(obj: object, depth: number, seen: WeakSet<object>): unknown {
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  seen.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((v) => walk(v, depth + 1, seen));
    if (obj instanceof Set) return Array.from(obj, (v) => walk(v, depth + 1, seen));
    if (obj instanceof Map) {
      return Array.from(obj, ([k, v]) => [walk(k, depth + 1, seen), walk(v, depth + 1, seen)]);
    }
    if (obj instanceof Error) return { name: obj.name, message: clip(obj.message) };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = walk((obj as Record<string, unknown>)[key], depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

function projectNumber(n: number): unknown {
  return Number.isFinite(n) ? n : String(n);
}

function projectNullable(value: object | null, depth: number, seen: WeakSet<object>): unknown {
  return value === null ? null : projectObject(value, depth, seen);
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case "string":
      return clip(value);
    case "number":
      return projectNumber(value);
    case "boolean":
      return value;
    case "undefined":
      return null;
    case "bigint":
      return `${value.toString()}n`;
    case "symbol":
    case "function":
      return clip(String(value));
    case "object":
      return projectNullable(value, depth, seen);
  }
}

/** Plain JSON structure for any value; keys sorted, strings truncated at 2000 chars. Total. */
export function toJsonSafe(value: unknown): unknown {
  try {
    return walk(value, 0, new WeakSet<object>());
  } catch (e: unknown) {
    return `[unserializable: ${e instanceof Error ? clip(e.message) : "unknown"}]`;
  }
}
