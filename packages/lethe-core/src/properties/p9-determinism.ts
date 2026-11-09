// P9: same inputs => byte-identical outputs; score() never mutates its input and
// is independent of engram / state ordering (ledger order is significant and is never shuffled).
// Refs: NFR-3, INV-4, REQ-PBT-1

import fc from "fast-check";
import { anyScoreInputArb } from "./arbitraries/workspace.arb.js";
import { score, type ScoreInput } from "../decay/score.js";
import type { LetheConfig, ScoredEngram } from "../types.js";

export const P9_ID = "P9";

function fail(msg: string): never {
  throw new Error(`${P9_ID} violated: ${msg}`);
}

/** Recursively freezes plain objects/arrays so any mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** Path of the first difference between two JSON-like values, or null when equal. */
function firstDiff(a: unknown, b: unknown, path: string): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keysA = Object.keys(ra);
  const keysB = Object.keys(rb);
  if (keysA.join("\u0000") !== keysB.join("\u0000")) {
    return `${path}: key sets/order differ [${keysA.join(",")}] vs [${keysB.join(",")}]`;
  }
  for (const k of keysA) {
    const d = firstDiff(ra[k], rb[k], `${path}.${k}`);
    if (d !== null) return d;
  }
  return null;
}

function idOf(e: ScoredEngram | undefined): string {
  return e === undefined ? "<none>" : e.node.id;
}

function assertSame(base: readonly ScoredEngram[], other: readonly ScoredEngram[], label: string): void {
  if (base.length !== other.length) {
    fail(`${label}: length ${other.length} !== ${base.length}`);
  }
  for (let i = 0; i < base.length; i++) {
    const d = firstDiff(base[i], other[i], `[${i}]`);
    if (d !== null) fail(`${label}: engram ${idOf(base[i])} differs at ${d}`);
  }
  if (JSON.stringify(base) !== JSON.stringify(other)) {
    fail(`${label}: JSON output is not byte-identical`);
  }
}

function permuted(input: ScoreInput): ScoreInput {
  return {
    ...input,
    engrams: [...input.engrams].reverse(),
    states: [...input.states].reverse(),
  };
}

export function p9Determinism(cfg: LetheConfig) {
  return fc.property(anyScoreInputArb(cfg), (input) => {
    const clone = structuredClone(input);
    const before = JSON.stringify(input);
    deepFreeze(input);

    const first = score(input);
    assertSame(first, score(input), "second call on same input");
    assertSame(first, score(clone), "call on structuredClone");
    assertSame(first, score(permuted(clone)), "engrams/states reversed");

    if (JSON.stringify(input) !== before) fail("score() mutated its input");
    if (JSON.stringify(clone) !== before) fail("score() mutated the cloned input");
  });
}
