// Windows-specific segment rules for the path guard (Req 7.4). Pure string checks.

const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * Returns a reason when `rel` is not a plain workspace-relative path on Windows, else undefined.
 * Rejected: leading separator (covers UNC `\\server\share`, `\\?\`, `\\.\`, rooted `\x`),
 * drive prefixes (`C:foo`, `D:\x`), any `:` (alternate data streams), and segment names that end
 * in a dot or a space (Windows silently strips them, so the name on disk differs from the name checked).
 * Reserved device names (CON, NUL, ...) are not part of Req 7.4 and are not rejected here.
 */
export function windowsViolation(rel: string): string | undefined {
  if (rel.startsWith("\\") || rel.startsWith("/")) return "rooted, UNC, or device path";
  if (DRIVE_PREFIX.test(rel)) return "drive-letter path";
  if (rel.includes(":")) return "alternate data stream or drive syntax";
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === "." || seg === "..") continue;
    if (seg.endsWith(".") || seg.endsWith(" ")) return "segment with trailing dot or space";
  }
  return undefined;
}
