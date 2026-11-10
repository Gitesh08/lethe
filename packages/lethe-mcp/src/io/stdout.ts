// The ONLY module allowed to touch process.stdout (Req 19.1, 19.2, INV-8).
// stdout carries protocol/CLI output only; every diagnostic goes to stderr via the logger below.
import type { Writable } from "node:stream";

/** Minimal writable surface, satisfied by process.stdout/stderr and by test doubles. */
export interface WritableLike {
  write(chunk: string, callback?: (error?: Error | null) => void): boolean;
  once?(event: "error", listener: (error: Error) => void): unknown;
  removeListener?(event: "error", listener: (error: Error) => void): unknown;
}

export interface Stdout {
  readonly writeStdout: (text: string) => Promise<void>;
}

function isEpipe(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EPIPE";
}

/**
 * Builds a stdout writer over `stream`. The promise resolves once the write callback fires, so a
 * CLI can exit safely afterwards. EPIPE (reader closed the pipe, e.g. `| head`) resolves instead of
 * throwing: there is nobody left to read the output and failing would only mask the real result.
 * Other write errors reject.
 */
export function createStdout(stream: WritableLike): Stdout {
  const writeStdout = (text: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        stream.removeListener?.("error", settle);
        if (error === undefined || error === null || isEpipe(error)) resolve();
        else reject(error);
      };
      stream.once?.("error", settle);
      try {
        stream.write(text, settle);
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  return { writeStdout };
}

export interface Logger {
  (message: string): void;
}

export interface LoggerOptions {
  readonly stream?: WritableLike;
  readonly prefix?: string;
}

/** Creates a stderr logger; each call writes one newline-terminated line. Never touches stdout. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const stream: WritableLike = options.stream ?? process.stderr;
  const prefix = options.prefix === undefined ? "" : `${options.prefix} `;
  return (message: string): void => {
    try {
      stream.write(`${prefix}${message}\n`);
    } catch {
      // A broken stderr must never take the server down; there is nowhere left to report it.
    }
  };
}

/** Default stdout writer bound to the real process.stdout. */
export const defaultStdout: Stdout = createStdout(process.stdout);
export const writeStdout: (text: string) => Promise<void> = defaultStdout.writeStdout;

/** The real process.stdout, for the MCP stdio transport only (protocol channel). */
export const protocolStdout: Writable = process.stdout;

/** Default stderr logger bound to the real process.stderr. */
export const log: Logger = createLogger();
