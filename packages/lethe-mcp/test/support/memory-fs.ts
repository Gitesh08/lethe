// In-memory WorkspaceFs for fast property tests. mkdirExclusive is a synchronous check-and-set (atomic like mkdir);
// every operation yields first so concurrent callers interleave.
import { ok } from "@lethe/core";
import { toolError } from "../../src/envelope/errors.js";
import type { WorkspaceFs } from "../../src/io/workspace-fs.js";

export interface MemoryFs extends WorkspaceFs {
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
}

const enc = new TextEncoder();
const tick = (): Promise<void> => Promise.resolve();

export function createMemoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const put = (rel: string, c: string | Uint8Array): void => {
    files.set(rel, typeof c === "string" ? enc.encode(c) : Uint8Array.from(c));
  };
  const fs: MemoryFs = {
    files,
    dirs,
    async readBytes(rel) {
      await tick();
      const b = files.get(rel);
      return ok(b === undefined ? undefined : Uint8Array.from(b));
    },
    async readText(rel) {
      await tick();
      const b = files.get(rel);
      return ok(b === undefined ? undefined : new TextDecoder().decode(b));
    },
    async writeAtomic(rel, c) {
      await tick();
      put(rel, c);
      return ok(undefined);
    },
    async remove(rel) {
      await tick();
      files.delete(rel);
      return ok(undefined);
    },
    async listMarkdown(relDir) {
      await tick();
      const prefix = `${relDir.replace(/\/+$/, "")}/`;
      const found = [...files.keys()].filter((k) => k.startsWith(prefix) && k.endsWith(".md"));
      return ok(found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    },
    async mkdirp(rel) {
      await tick();
      dirs.add(rel);
      return ok(undefined);
    },
    async mkdirExclusive(rel) {
      await tick();
      if (dirs.has(rel)) return ok(false);
      dirs.add(rel);
      return ok(true);
    },
    async writeExclusive(rel, c) {
      await tick();
      if (files.has(rel)) return ok(false);
      put(rel, c);
      return ok(true);
    },
    async appendLine(rel, line) {
      await tick();
      const cur = files.get(rel) ?? new Uint8Array(0);
      const lead = cur.length > 0 && cur[cur.length - 1] !== 0x0a ? Uint8Array.of(0x0a) : new Uint8Array(0);
      const add = enc.encode(line);
      const next = new Uint8Array(cur.length + lead.length + add.length);
      next.set(cur, 0);
      next.set(lead, cur.length);
      next.set(add, cur.length + lead.length);
      files.set(rel, next);
      return ok(undefined);
    },
    async copyTo(rel, destRel) {
      await tick();
      const b = files.get(rel);
      if (b === undefined) return { ok: false, error: toolError("IO_FAILED", "File operation failed.", { code: "ENOENT", path: rel }) };
      await tick();
      put(destRel, b);
      return ok(undefined);
    },
  };
  return fs;
}
