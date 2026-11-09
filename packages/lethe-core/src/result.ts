// Result<T,E> helpers — discriminated union utilities
// Refs: REQ-DEC-6

import type { LetheError, Result } from "./types.js";

/** Wrap a success value. The `never` error type widens to any E at the call site. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value } as const;
}

/** Wrap a failure value. The `never` success type widens to any T at the call site. */
export function err<E = LetheError>(error: E): Result<never, E> {
  return { ok: false, error } as const;
}

/**
 * Exhaustive pattern-match over a Result.
 * Both branches must be handled; the return type is inferred from the handlers.
 */
export function match<T, E, R>(
  result: Result<T, E>,
  cases: { ok: (value: T) => R; err: (error: E) => R },
): R {
  if (result.ok) {
    return cases.ok(result.value);
  }
  return cases.err(result.error);
}

// Re-export the type so callers can import everything from one place.
export type { Result } from "./types.js";
