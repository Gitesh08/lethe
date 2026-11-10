/**
 * Scrubbed environment for child processes (design: Security / Process, environment, network).
 *
 * Only names on the allow-list below are forwarded, matched case-insensitively
 * (Windows environment names are case-insensitive; the source casing is kept).
 * Any name containing TOKEN, SECRET, PASSWORD or KEY is dropped even if allow-listed.
 *
 * Allow-list: PATH, PATHEXT, SYSTEMROOT, WINDIR, COMSPEC, TEMP, TMP, TMPDIR, HOME,
 * USERPROFILE, HOMEDRIVE, HOMEPATH, APPDATA, LOCALAPPDATA, PROGRAMDATA, LANG, LC_*.
 *
 * Always set afterwards (override anything inherited): GIT_TERMINAL_PROMPT=0,
 * GIT_OPTIONAL_LOCKS=0, LC_ALL=C.
 */

const ALLOWED: ReadonlySet<string> = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "LANG",
]);

const SECRET_PATTERN = /TOKEN|SECRET|PASSWORD|KEY/i;

function isForwarded(name: string): boolean {
  if (SECRET_PATTERN.test(name)) return false;
  const upper = name.toUpperCase();
  return ALLOWED.has(upper) || upper.startsWith("LC_");
}

export function childEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(source).sort()) {
    const value = source[name];
    if (value !== undefined && isForwarded(name)) out[name] = value;
  }
  // Forced values: remove any differently-cased inherited LC_ALL first.
  for (const name of Object.keys(out)) {
    if (name.toUpperCase() === "LC_ALL") delete out[name];
  }
  out["GIT_TERMINAL_PROMPT"] = "0";
  out["GIT_OPTIONAL_LOCKS"] = "0";
  out["LC_ALL"] = "C";
  return out;
}
