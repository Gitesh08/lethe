// The only module allowed to import node:fs (layering rule fs-only-workspace-fs).
// Task 4.6: nodeFsProbe, the node AtomicFsOps, and WorkspaceFs (read/write/remove; list/copy/append come later).
import { lstatSync, realpathSync, statSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import { appendLineAbs } from "./fs-append.js";
import { walkMarkdown } from "./fs-walk.js";
import { atomicWrite, type AtomicFsOps, type AtomicWriteOptions } from "./atomic-write.js";
import { guardPath, type FsProbe } from "./path-guard.js";

/** FsProbe over node:fs. Errors become "absent" results (never thrown). */
export const nodeFsProbe: FsProbe = {
  realpath(p: string): string | undefined {
    try {
      return realpathSync.native(p);
    } catch {
      return undefined;
    }
  },
  isDirectory(p: string): boolean {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  exists(p: string): boolean {
    try {
      lstatSync(p);
      return true;
    } catch {
      return false;
    }
  },
};

function code(e: unknown): string | undefined {
  const c = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof c === "string" ? c : undefined;
}

/** Default AtomicFsOps over node:fs/promises. */
export const nodeAtomicFsOps: AtomicFsOps = {
  async mkdirp(dir) {
    await mkdir(dir, { recursive: true });
  },
  async openExclusive(path) {
    const h = await open(path, "wx");
    return {
      write: async (bytes) => {
        let off = 0;
        while (off < bytes.length) off += (await h.write(bytes, off, bytes.length - off)).bytesWritten;
      },
      sync: () => h.sync(),
      close: () => h.close(),
    };
  },
  async copyMode(from, to) {
    try {
      await chmod(to, (await stat(from)).mode & 0o7777);
    } catch (e) {
      if (code(e) !== "ENOENT") throw e;
    }
  },
  rename,
  async unlink(path) {
    try {
      await unlink(path);
    } catch (e) {
      if (code(e) !== "ENOENT") throw e;
    }
  },
  async syncDir(dir) {
    const h = await open(dir, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  },
  delay: (ms) => sleep(ms),
};

export interface WorkspaceFs {
  readText(rel: string): Promise<Result<string | undefined, ToolError>>;
  readBytes(rel: string): Promise<Result<Uint8Array | undefined, ToolError>>;
  writeAtomic(rel: string, content: string | Uint8Array): Promise<Result<void, ToolError>>;
  remove(rel: string): Promise<Result<void, ToolError>>;
  /** Creates a directory and missing parents. */
  mkdirp(rel: string): Promise<Result<void, ToolError>>;
  /** Recursive (depth <= 8) `*.md` listing under relDir: sorted `/` workspace-relative paths; absent dir is empty; symlinks skipped. */
  listMarkdown(relDir: string): Promise<Result<readonly string[], ToolError>>;
  /** Atomically claims one directory (parent must exist): ok(true) if created, ok(false) if it already exists. */
  mkdirExclusive(rel: string): Promise<Result<boolean, ToolError>>;
  /** Exclusive create (`wx`, parent must exist): ok(true) if created and synced, ok(false) if the file exists. */
  writeExclusive(rel: string, content: string): Promise<Result<boolean, ToolError>>;
  /** Byte-exact copy of an existing file to destRel (parents created, atomic). Missing source is IO_FAILED. */
  copyTo(rel: string, destRel: string): Promise<Result<void, ToolError>>;
  /** Append-mode write of one complete line (leading `\n` first if the last byte is not `\n`); no lock, parents created. */
  appendLine(rel: string, line: string): Promise<Result<void, ToolError>>;
}

export interface WorkspaceFsOptions {
  readonly ops?: AtomicFsOps;
  readonly probe?: FsProbe;
  readonly atomic?: AtomicWriteOptions;
}

function makeGuarded(root: string, probe: FsProbe) {
  return async <T>(rel: string, fn: (abs: string) => Promise<T>): Promise<Result<T, ToolError>> => {
    const g = guardPath(root, rel, probe);
    if (!g.ok) return g;
    try {
      return ok(await fn(g.value));
    } catch (e) {
      return err(toolError("IO_FAILED", "File operation failed.", { code: code(e) ?? "UNKNOWN", path: rel }));
    }
  };
}

async function readOrAbsent(abs: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(abs);
  } catch (e) {
    if (code(e) === "ENOENT") return undefined;
    throw e;
  }
}

async function mkdirExclusiveAbs(abs: string): Promise<boolean> {
  try {
    await mkdir(abs);
    return true;
  } catch (e) {
    if (code(e) === "EEXIST") return false;
    throw e;
  }
}

async function writeExclusiveAbs(abs: string, content: string): Promise<boolean> {
  let h;
  try {
    h = await open(abs, "wx");
  } catch (e) {
    if (code(e) === "EEXIST") return false;
    throw e;
  }
  try {
    await h.writeFile(content, "utf8");
    await h.sync();
  } catch (e) {
    await h.close();
    await unlink(abs).catch(() => undefined);
    throw e;
  }
  await h.close();
  return true;
}

/** Guarded filesystem over a resolved workspace root (see resolveWorkspace). Every call runs guardPath first. */
export function createWorkspaceFs(root: string, o: WorkspaceFsOptions = {}): WorkspaceFs {
  const ops = o.ops ?? nodeAtomicFsOps;
  const probe = o.probe ?? nodeFsProbe;
  const guarded = makeGuarded(root, probe);
  return {
    readBytes: (rel) => guarded(rel, readOrAbsent),
    readText: (rel) => guarded(rel, async (abs) => {
      const b = await readOrAbsent(abs);
      return b === undefined ? undefined : new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);
    }),
    async writeAtomic(rel, content) {
      const g = guardPath(root, rel, probe);
      return g.ok ? atomicWrite(ops, g.value, content, o.atomic) : g;
    },
    remove: (rel) => guarded(rel, (abs) => ops.unlink(abs)),
    mkdirp: (rel) => guarded(rel, (abs) => ops.mkdirp(abs)),
    listMarkdown: (relDir) => guarded(relDir, () => walkMarkdown(root, probe, relDir)),
    mkdirExclusive: (rel) => guarded(rel, mkdirExclusiveAbs),
    writeExclusive: (rel, content) => guarded(rel, (abs) => writeExclusiveAbs(abs, content)),
    appendLine: (rel, line) => guarded(rel, (abs) => appendLineAbs(abs, line)),
    async copyTo(rel, destRel) {
      const src = await guarded(rel, readOrAbsent);
      if (!src.ok) return src;
      if (src.value === undefined) return err(toolError("IO_FAILED", "File operation failed.", { code: "ENOENT", path: rel }));
      return this.writeAtomic(destRel, src.value);
    },
  };
}
