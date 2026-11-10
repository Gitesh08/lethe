/**
 * Byte-deterministic JSON text for every file Lethe writes (Req 8.8, 10.12).
 *
 * Pure: no IO. Output is 2-space indented with `\n` line endings and a
 * trailing newline (`stableStringify`), or one compact line (`stableLine`).
 *
 * Key-order policy: keys listed in `KeyOrder.keys` come first in that order;
 * keys present in the value but not listed are APPENDED in ascending
 * code-unit order (nothing is silently dropped, output stays deterministic).
 * Keys listed but absent from the value are skipped. A node with no `keys`
 * (a map) therefore sorts all its keys ascending.
 * `undefined` object properties are omitted. Non-finite numbers, bigint,
 * symbols, and functions throw a TypeError (programmer error; core never
 * produces them).
 */

export interface KeyOrder {
  /** Ordered leading keys for an object at this path. */
  readonly keys?: readonly string[];
  /** Order for the value under a specific key. */
  readonly child?: Readonly<Record<string, KeyOrder>>;
  /** Order applied to every property value (map) or array element. */
  readonly each?: KeyOrder;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function orderedKeys(obj: Readonly<Record<string, unknown>>, order: KeyOrder | undefined): string[] {
  const present = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const listed = (order?.keys ?? []).filter((k) => present.includes(k));
  const rest = present.filter((k) => !listed.includes(k)).sort(byCodeUnit);
  return [...listed, ...rest];
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("stable-json: non-finite number");
      return JSON.stringify(value);
    default:
      throw new TypeError(`stable-json: unsupported value of type ${typeof value}`);
  }
}

function wrap(open: string, close: string, items: readonly string[], indent: string, depth: number): string {
  if (items.length === 0) return open + close;
  if (indent === "") return open + items.join(",") + close;
  const pad = "\n" + indent.repeat(depth + 1);
  return open + pad + items.join("," + pad) + "\n" + indent.repeat(depth) + close;
}

function emit(value: unknown, order: KeyOrder | undefined, indent: string, depth: number): string {
  if (Array.isArray(value)) {
    const items = value.map((v: unknown) =>
      v === undefined ? "null" : emit(v, order?.each, indent, depth + 1),
    );
    return wrap("[", "]", items, indent, depth);
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Readonly<Record<string, unknown>>;
    const sep = indent === "" ? ":" : ": ";
    const items = orderedKeys(obj, order).map((k) => {
      const sub = order?.child?.[k] ?? order?.each;
      return JSON.stringify(k) + sep + emit(obj[k], sub, indent, depth + 1);
    });
    return wrap("{", "}", items, indent, depth);
  }
  return scalar(value);
}

/** 2-space indented JSON, `\n` endings, trailing newline. */
export function stableStringify(value: unknown, keyOrder?: KeyOrder): string {
  return emit(value, keyOrder, "  ", 0) + "\n";
}

/** Exactly one compact line terminated by `\n` (for ledger.jsonl). */
export function stableLine(value: unknown, keyOrder?: KeyOrder): string {
  return emit(value, keyOrder, "", 0) + "\n";
}

const ENGRAM_STATE_ORDER: KeyOrder = {
  keys: ["stability", "lastReinforcedCommit", "lastReinforcedAt", "reinforcements"],
};

export const KEY_ORDERS = {
  config: {
    keys: [
      "version", "s0", "sMax", "sMin", "beta", "alpha", "wDefault", "wSpec", "specFloor",
      "hotMin", "cryptMax", "budgetTokens", "dedupeJaccard", "granularity", "activeSpecs",
    ],
  },
  ontology: {
    keys: ["version", "axes"],
    child: {
      axes: {
        each: {
          keys: ["id", "description", "stances"],
          child: {
            stances: { each: { keys: ["id", "label", "patterns", "negationAware"] } },
          },
        },
      },
    },
  },
  state: {
    keys: ["version", "commit", "at", "ledger", "engrams"],
    child: {
      ledger: { keys: ["lines", "bytes", "lastLineSha256"] },
      engrams: { each: ENGRAM_STATE_ORDER },
    },
  },
  ledgerLine: { keys: ["type", "at", "commit", "filesTouched", "cited"] },
  lock: { keys: ["pid", "host", "startedAt", "token"] },
  pendingJournal: {
    keys: ["version", "startedAt", "pid", "backupDir", "files"],
    child: { files: { each: { keys: ["path", "existed"] } } },
  },
  probeCapture: {
    keys: ["receivedAt", "argv", "cwd", "stdinRaw", "stdinParsed"],
  },
} as const satisfies Readonly<Record<string, KeyOrder>>;
