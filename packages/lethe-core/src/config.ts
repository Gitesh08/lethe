// DEFAULT_CONFIG and validateConfig
// Refs: REQ-DEC-1, CONFIG_INVALID

import type { LetheConfig, LetheError, Result } from "./types.js";
import { ok, err } from "./result.js";

export const DEFAULT_CONFIG: LetheConfig = {
  s0: 5,
  sMax: 120,
  sMin: 0.5,
  beta: 0.5,
  alpha: 0.25,
  wDefault: 1,
  wSpec: 4,
  specFloor: 0.5,
  hotMin: 0.6,
  cryptMax: 0.25,
  budgetTokens: 4000,
  dedupeJaccard: 0.85,
  granularity: "section",
} as const;

type Acc = Record<string, number>;
/** Returns a CONFIG_INVALID message, or null after recording the valid value in `acc`. */
type Rule = (raw: Readonly<Record<string, unknown>>, acc: Acc) => string | null;

function numRule(key: keyof LetheConfig, expect: (a: Acc) => string, bad: (v: number, a: Acc) => boolean): Rule {
  return (raw, acc) => {
    const v = raw[key];
    const n = typeof v === "number" && isFinite(v) ? v : undefined;
    if (n === undefined || bad(n, acc)) return `${key} ${expect(acc)}; got ${String(v)}`;
    acc[key] = n;
    return null;
  };
}

const crossRule: Rule = (_raw, acc) => {
  const c = acc["cryptMax"] ?? 0;
  const h = acc["hotMin"] ?? 0;
  return c >= h ? `cryptMax (${c}) must be < hotMin (${h})` : null;
};

const granularityRule: Rule = (raw) => {
  const g = raw["granularity"];
  return g === "section" || g === "bullet" ? null : `granularity must be "section" or "bullet"; got ${String(g)}`;
};

// Order matters: first failing rule wins, and later rules may read earlier values.
const RULES: readonly Rule[] = [
  numRule("s0", () => "must be > 0", (v) => v <= 0),
  numRule("sMax", (a) => `must be >= s0 (${a["s0"]})`, (v, a) => v < (a["s0"] ?? 0)),
  numRule("sMin", () => "must be > 0", (v) => v <= 0),
  numRule("beta", () => "must be >= 0", (v) => v < 0),
  numRule("alpha", () => "must be >= 0", (v) => v < 0),
  numRule("wDefault", () => "must be >= 1", (v) => v < 1),
  numRule("wSpec", (a) => `must be >= wDefault (${a["wDefault"]})`, (v, a) => v < (a["wDefault"] ?? 0)),
  numRule("specFloor", () => "must be in (0, 1)", (v) => v <= 0 || v >= 1),
  numRule("cryptMax", () => "must be > 0", (v) => v <= 0),
  numRule("hotMin", () => "must be < 1", (v) => v >= 1),
  crossRule,
  numRule("budgetTokens", () => "must be a positive integer", (v) => v <= 0 || !Number.isInteger(v)),
  numRule("dedupeJaccard", () => "must be in (0, 1]", (v) => v <= 0 || v > 1),
  granularityRule,
];

function buildConfig(raw: Readonly<Record<string, unknown>>, acc: Acc): LetheConfig {
  const n = (k: string): number => acc[k] ?? 0;
  return {
    s0: n("s0"), sMax: n("sMax"), sMin: n("sMin"), beta: n("beta"), alpha: n("alpha"),
    wDefault: n("wDefault"), wSpec: n("wSpec"), specFloor: n("specFloor"),
    hotMin: n("hotMin"), cryptMax: n("cryptMax"), budgetTokens: n("budgetTokens"),
    dedupeJaccard: n("dedupeJaccard"),
    granularity: raw["granularity"] === "bullet" ? "bullet" : "section",
  };
}

/**
 * Merges `partial` over DEFAULT_CONFIG and validates every field constraint.
 * Returns CONFIG_INVALID with a descriptive message on any violation.
 * Refs: REQ-DEC-1
 */
export function validateConfig(partial: unknown): Result<LetheConfig, LetheError> {
  const raw: Record<string, unknown> =
    partial !== null && typeof partial === "object" && !Array.isArray(partial)
      ? { ...DEFAULT_CONFIG, ...(partial as Record<string, unknown>) }
      : { ...DEFAULT_CONFIG };
  const acc: Acc = {};
  for (const rule of RULES) {
    const message = rule(raw, acc);
    if (message !== null) return err({ code: "CONFIG_INVALID" as const, message });
  }
  return ok(buildConfig(raw, acc));
}