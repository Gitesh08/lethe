import type { Axis, Stance } from "../types.js";

/** Build a stance. Directive-style stances are negation-aware by default. */
export function stance(
  id: string,
  label: string,
  patterns: readonly string[],
  negationAware = true,
): Stance {
  return { id, label, patterns, negationAware };
}

/** Build an axis of mutually exclusive stances. */
export function axis(id: string, description: string, stances: readonly Stance[]): Axis {
  return { id, description, stances };
}
