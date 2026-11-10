// Ledger reader: pure byte parser plus a thin WorkspaceFs wrapper. Refs: Req 10.8, Req 10.9, Req 23.7
// Hash rule (design "Chosen model"): a line's SHA-256 is taken over its text INCLUDING its terminator
// (`\n` or `\r\n`), decoded as UTF-8 (lossy), via core's pure `sha256`.
import { ok, sha256, type LedgerEvent, type Result } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import type { ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { ZERO_CURSOR, type LedgerCursor } from "../persist/ledger-cursor.js";
import { toLedgerEvent } from "./ledger-event.js";

export const LEDGER_REL = ".kiro/lethe/ledger.jsonl";

/** One newline-terminated line after the cursor. `event` is null for blank/garbage/invalid lines. */
export interface LedgerLine {
  readonly lineNo: number; // 1-based, absolute
  readonly endByte: number; // exclusive end offset, including the terminator
  readonly event: LedgerEvent | null;
}

export interface LedgerRead {
  /** Complete lines after the cursor in file order (empty when `rewritten`). */
  readonly tail: ReadonlyArray<LedgerLine>;
  /** Valid events of `tail`, in file order. */
  readonly events: ReadonlyArray<LedgerEvent>;
  /** Cursor at the end of the last complete line (the torn tail is not counted). */
  readonly endCursor: LedgerCursor;
  /** True when the given cursor does not match the ledger (mismatch or truncation). */
  readonly rewritten: boolean;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const NL = 0x0a;
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const hashLine = (bytes: Uint8Array, from: number, to: number): string => sha256(decoder.decode(bytes.subarray(from, to)));

/** SHA-256 of the ledger bytes [from, to) under the cursor hash rule. */
export const hashLedgerSpan = hashLine;

interface RawLine {
  readonly start: number;
  readonly end: number;
}

function splitLines(bytes: Uint8Array): { lines: RawLine[]; tornFrom: number | undefined } {
  const lines: RawLine[] = [];
  let start = 0;
  for (let i = bytes.indexOf(NL); i !== -1; i = bytes.indexOf(NL, start)) {
    lines.push({ start, end: i + 1 });
    start = i + 1;
  }
  return { lines, tornFrom: start < bytes.length ? start : undefined };
}

function parseEvent(bytes: Uint8Array, l: RawLine): LedgerEvent | null {
  const text = decoder.decode(bytes.subarray(l.start, l.end)).trim();
  if (text === "") return null;
  try {
    return toLedgerEvent(JSON.parse(text));
  } catch {
    return null;
  }
}

function cursorMatches(bytes: Uint8Array, lines: ReadonlyArray<RawLine>, c: LedgerCursor): number | undefined {
  if (c.lines === 0) return 0;
  const last = lines[c.lines - 1];
  if (last === undefined || last.end !== c.bytes) return undefined;
  return hashLine(bytes, last.start, last.end) === c.lastLineSha256 ? c.lines : undefined;
}

/** Pure ledger parse. Events at/after the cursor are "new"; a bad cursor yields `rewritten` and no events. */
export function parseLedger(bytes: Uint8Array, cursor: LedgerCursor = ZERO_CURSOR, file: string = LEDGER_REL): LedgerRead {
  const { lines, tornFrom } = splitLines(bytes);
  const diags: Diagnostic[] = [];
  const lastRaw = lines[lines.length - 1];
  const endCursor: LedgerCursor =
    lastRaw === undefined
      ? ZERO_CURSOR
      : { lines: lines.length, bytes: lastRaw.end, lastLineSha256: hashLine(bytes, lastRaw.start, lastRaw.end) };
  if (tornFrom !== undefined) {
    diags.push(diagnostic("LEDGER_TORN_TAIL", `${file}: ignoring unterminated final line (${bytes.length - tornFrom} bytes)`, file));
  }
  const consumed = cursorMatches(bytes, lines, cursor);
  if (consumed === undefined) {
    diags.push(diagnostic("LEDGER_REWRITTEN", `${file}: does not match the state cursor; ignoring ledger events`, file));
    return { tail: [], events: [], endCursor, rewritten: true, diagnostics: diags };
  }
  const tail: LedgerLine[] = [];
  const events: LedgerEvent[] = [];
  for (let i = consumed; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const event = parseEvent(bytes, raw);
    tail.push({ lineNo: i + 1, endByte: raw.end, event });
    if (event === null) diags.push(diagnostic("LEDGER_LINE_SKIPPED", `${file}: line ${i + 1} skipped (blank or invalid)`, file));
    else events.push(event);
  }
  return { tail, events, endCursor, rewritten: false, diagnostics: diags };
}

/** Reads the ledger from the workspace; an absent file is an empty ledger. */
export async function loadLedger(fs: WorkspaceFs, cursor: LedgerCursor = ZERO_CURSOR): Promise<Result<LedgerRead, ToolError>> {
  const raw = await fs.readBytes(LEDGER_REL);
  if (!raw.ok) return raw;
  return ok(parseLedger(raw.value ?? new Uint8Array(0), cursor));
}
