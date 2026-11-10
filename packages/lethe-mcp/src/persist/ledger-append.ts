// Appends one LedgerEvent to .kiro/lethe/ledger.jsonl (Req 9.6, 10.8, 10.10). No lock: the primitive opens
// in append mode, writes a leading "\n" when the last byte is not "\n" (so a torn fragment is never merged
// with the new event), then performs one write of the complete line in the fixed key order.
import { err, ok, type LedgerEvent, type Result } from "@lethe/core";
import { toolError, type ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { LEDGER_REL } from "../load/ledger-file.js";
import { toLedgerEvent } from "../load/ledger-event.js";
import { KEY_ORDERS, stableLine } from "./stable-json.js";

/** Validates `event` and appends it. Invalid events are INVALID_INPUT and nothing is written. Returns the line written. */
export async function appendLedgerEvent(fsx: WorkspaceFs, event: LedgerEvent): Promise<Result<string, ToolError>> {
  const valid = toLedgerEvent(event);
  if (valid === null) return err(toolError("INVALID_INPUT", "Invalid ledger event."));
  const line = stableLine(valid, KEY_ORDERS.ledgerLine);
  const w = await fsx.appendLine(LEDGER_REL, line);
  return w.ok ? ok(line) : w;
}
