// Seeded linear congruential generator for the haunted-repo fixture.
// state = (1664525 * state + 1013904223) mod 2^32 -- the ONLY source of variation.
// No unseeded randomness, no clock. Refs: REQ-SBX-1, INV-7

export interface Rng {
  /** Uniform float in [0, 1). */
  readonly next: () => number;
  /** Uniform integer in [lo, hi] (inclusive). */
  readonly int: (lo: number, hi: number) => number;
  /** Uniform float in [lo, hi). */
  readonly range: (lo: number, hi: number) => number;
}

export function createRng(seed: number): Rng {
  let state = (Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0;
  const step = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };
  // Warm-up: adjacent seeds (1, 2, 3...) otherwise start on correlated values.
  step();
  step();
  step();
  const next = (): number => step() / 4294967296;
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    range: (lo, hi) => lo + next() * (hi - lo),
  };
}

/** Total array access for `noUncheckedIndexedAccess` (wraps the index). */
export function nth<T>(items: readonly T[], index: number, fallback: T): T {
  if (items.length === 0) return fallback;
  return items[((index % items.length) + items.length) % items.length] ?? fallback;
}

const VARIANT_RE = /\{([^{}|]+(?:\|[^{}|]+)+)\}/g;

/** Resolve `{a|b|c}` wording variants with the rng (left to right). */
export function expandVariants(text: string, rng: Rng): string {
  return text.replace(VARIANT_RE, (_match, group: string) => {
    const parts = group.split("|");
    return nth(parts, rng.int(0, parts.length - 1), "");
  });
}
