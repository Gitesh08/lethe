// Sibling of workspace-fs.ts (allowed to import node:fs by layering rule fs-only-workspace-fs): guarded *.md listing.
import { readdir } from "node:fs/promises";
import { guardPath, type FsProbe } from "./path-guard.js";

const MAX_LIST_DEPTH = 8;
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function isMissing(e: unknown): boolean {
  const c = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return c === "ENOENT" || c === "ENOTDIR";
}

async function readEntries(abs: string) {
  try {
    return await readdir(abs, { withFileTypes: true });
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

/** Iterative walk for *.md files; symlinks are not followed and unguardable entries are skipped. */
export async function walkMarkdown(root: string, probe: FsProbe, relDir: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: relDir.replace(/\\/g, "/").replace(/\/+$/, ""), depth: 0 }];
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
    const g = guardPath(root, cur.rel, probe);
    if (!g.ok) continue;
    for (const d of await readEntries(g.value)) {
      const rel = `${cur.rel}/${d.name}`;
      if (d.isSymbolicLink() || !guardPath(root, rel, probe).ok) continue;
      if (d.isDirectory() && cur.depth < MAX_LIST_DEPTH) queue.push({ rel, depth: cur.depth + 1 });
      else if (d.isFile() && d.name.endsWith(".md")) out.push(rel);
    }
  }
  return out.sort(byCodeUnits);
}