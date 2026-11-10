// probeOp (Req 19.4, 20.1): captures a hook's stdin payload + argv + cwd to .kiro/lethe/probe/. The environment is
// never captured. Secret-looking values are redacted. Only the capture file (and its directory) is written.
import { err, ok, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import { KEY_ORDERS, stableStringify } from "../persist/stable-json.js";
import type { RunContext } from "./context.js";

export const PROBE_DIR = ".kiro/lethe/probe";
export const PROBE_MAX_STDIN_BYTES = 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NAME_CHARS = 64;
const REDACTED = "[REDACTED]";
const SECRET_KEY = /token|secret|key|password|passwd|credential|authorization|cookie/i;
const SECRET_PAIR = /((?:token|secret|key|password|passwd|credential|authorization)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi;

export interface ProbeInput {
  /** Raw stdin text as read by the CLI (already limited by time; size is re-capped here). */
  readonly stdin: string;
  readonly argv: readonly string[];
  readonly cwd: string;
}

export interface ProbeData {
  /** Workspace-relative path of the capture file. */
  readonly file: string;
  readonly event: string;
  readonly stdinBytes: number;
  readonly truncated: boolean;
  readonly parsed: boolean;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((v: unknown) => redactValue(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(value)) {
      const v = (value as Record<string, unknown>)[k];
      out[k] = SECRET_KEY.test(k) && v !== null && typeof v !== "object" ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return typeof value === "string" ? redactText(value) : value;
}

export function redactText(text: string): string {
  return text.replace(SECRET_PAIR, `$1${REDACTED}`);
}

function capText(text: string): { text: string; bytes: number; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= PROBE_MAX_STDIN_BYTES) return { text, bytes: buf.length, truncated: false };
  return { text: buf.subarray(0, PROBE_MAX_STDIN_BYTES).toString("utf8"), bytes: buf.length, truncated: true };
}

/** `<event>` part of the file name: sanitised `hook_event_name`, else "unknown". */
export function eventName(parsed: unknown): string {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unknown";
  const raw = (parsed as Record<string, unknown>)["hook_event_name"];
  if (typeof raw !== "string") return "unknown";
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_NAME_CHARS);
  return clean === "" ? "unknown" : clean;
}

/** `2026-11-10T12:00:00.123Z` -> `20261110T120000123Z`. */
export function compactStamp(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(iso);
  if (m === null) return iso.replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}${(m[7] ?? "").padEnd(3, "0")}Z`;
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

async function writeFresh(ctx: RunContext, base: string, content: string): Promise<Result<string, ToolError>> {
  for (let n = 1; n <= 100; n++) {
    const rel = `${PROBE_DIR}/${n === 1 ? base : `${base.slice(0, -5)}-${n}.json`}`;
    const w = await ctx.fsx.writeExclusive(rel, content);
    if (!w.ok) return err(w.error);
    if (w.value) return ok(rel);
  }
  return err(toolError("IO_FAILED", "Could not allocate a probe capture file name."));
}

export async function probeOp(ctx: RunContext, input: ProbeInput): Promise<Result<ProbeData, ToolError>> {
  const capped = capText(input.stdin);
  const parsedTry = capped.truncated ? ({ ok: false } as const) : tryParse(capped.text);
  const parsed = parsedTry.ok ? redactValue(parsedTry.value, 0) : undefined;
  const raw = parsedTry.ok ? JSON.stringify(parsed) : redactText(capped.text);
  const event = eventName(parsed);
  const capture = {
    receivedAt: ctx.nowISO,
    argv: input.argv.map(redactText),
    cwd: input.cwd,
    stdinRaw: raw,
    ...(parsedTry.ok ? { stdinParsed: parsed } : {}),
  };
  const dir = await ctx.fsx.mkdirp(PROBE_DIR);
  if (!dir.ok) return err(dir.error);
  const base = `${compactStamp(ctx.nowISO)}-${event}.json`;
  const written = await writeFresh(ctx, base, stableStringify(capture, KEY_ORDERS.probeCapture));
  if (!written.ok) return err(written.error);
  return ok({ file: written.value, event, stdinBytes: capped.bytes, truncated: capped.truncated, parsed: parsedTry.ok });
}
