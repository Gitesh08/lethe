// Engram ID slug generator.
// Refs: REQ-PAR-2

/**
 * Produces a stable, URL-safe slug for an engram's `id`.
 *
 * Algorithm:
 * 1. Join `relativePath` and every element of `headingPath` with `#`.
 * 2. Lowercase the entire string.
 * 3. Replace every run of characters outside `[a-z0-9]` with a single `-`.
 * 4. Trim any leading or trailing `-` characters.
 *
 * The `id` is intentionally independent of body content: changing the
 * section heading or file path changes the slug; changing only the body
 * text does not — body changes are captured by `contentHash` instead.
 */
export function slugify(
  relativePath: string,
  headingPath: readonly string[],
): string {
  const raw = [relativePath, ...headingPath].join("#");
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
