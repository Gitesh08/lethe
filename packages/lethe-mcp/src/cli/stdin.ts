// Bounded stdin reader for `probe` (Req 19). Resolves with what was read at EOF, the byte cap,
// the time limit, a stream error, or immediately for a TTY. Never rejects, never hangs.
import type { Readable } from "node:stream";

export interface StdinLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export type StdinSource = Pick<Readable, "on" | "off" | "pause" | "resume"> & { readonly isTTY?: boolean };

export function readLimited(stream: StdinSource, limits: StdinLimits): Promise<string> {
  if (stream.isTTY === true || limits.maxBytes <= 0) return Promise.resolve("");
  return new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("close", finish);
      stream.off("error", finish);
      stream.pause();
      resolve(Buffer.concat(chunks).subarray(0, limits.maxBytes).toString("utf8"));
    };
    const onData = (chunk: Buffer | string): void => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      chunks.push(buf);
      size += buf.length;
      if (size >= limits.maxBytes) finish();
    };
    stream.on("data", onData);
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", finish);
    timer = setTimeout(finish, limits.timeoutMs);
    stream.resume();
  });
}
