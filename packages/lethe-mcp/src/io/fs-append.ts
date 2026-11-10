// Append primitive for the ledger (Req 9.6, Req 10.10). Sibling of workspace-fs.ts: may import node:fs.
// Opens in append mode; if the last byte is not "\n" writes a leading "\n" first, then performs exactly
// ONE write of the complete line, syncs, and closes. No lock is taken (Req 9.6).
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

export interface AppendHandle {
  /** Current file size in bytes. */
  size(): Promise<number>;
  /** The byte at `pos` (0 <= pos < size). */
  byteAt(pos: number): Promise<number>;
  /** Exactly one underlying write of all bytes (append mode). */
  write(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface AppendOps {
  mkdirp(dir: string): Promise<void>;
  /** Opens (creating if absent) in append mode with read access. */
  open(abs: string): Promise<AppendHandle>;
}

export const nodeAppendOps: AppendOps = {
  async mkdirp(dir) {
    await mkdir(dir, { recursive: true });
  },
  async open(abs) {
    const h = await open(abs, "a+");
    return {
      size: async () => (await h.stat()).size,
      byteAt: async (pos) => {
        const buf = new Uint8Array(1);
        await h.read(buf, 0, 1, pos);
        return buf[0] ?? 0;
      },
      write: async (bytes) => {
        const r = await h.write(bytes, 0, bytes.length);
        if (r.bytesWritten !== bytes.length) throw new Error("short write");
      },
      sync: () => h.sync(),
      close: () => h.close(),
    };
  },
};

const NL = 0x0a;

/** Appends `line` (caller supplies the trailing "\n"); see file header for the write discipline. */
export async function appendLineWith(ops: AppendOps, abs: string, line: string): Promise<void> {
  await ops.mkdirp(dirname(abs));
  const h = await ops.open(abs);
  try {
    const size = await h.size();
    if (size > 0 && (await h.byteAt(size - 1)) !== NL) await h.write(Uint8Array.of(NL));
    await h.write(new TextEncoder().encode(line));
    await h.sync();
  } finally {
    await h.close();
  }
}

export const appendLineAbs = (abs: string, line: string): Promise<void> => appendLineWith(nodeAppendOps, abs, line);
