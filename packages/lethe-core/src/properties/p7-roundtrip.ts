// P7: resurrect(archive(e)) deep-equals e, byte-for-byte in the file text.
// Refs: REQ-CRY-3, INV-3
//
// Claims, per tombstone created by runConsolidation:
//  (1) single archive: burying ONLY e in the original workspace and resurrecting restores
//      the original file text exactly and re-parses to a node deep-equal to e.
//  (2) full plan: resurrecting all tombstones in ascending (file, index) order restores
//      every touched file exactly (section granularity).
//  (3) tombstones.json serialization round-trips; raw/body/state match the original.
//  (4) the returned EngramState is fresh (stability s0, 0 reinforcements, now).
//
// KNOWN LIMITATION (bullet granularity): ids are positional, so burying a non-last
// bullet renumbers its successors and the buried id collides. resurrect then reports
// PARSE_DUPLICATE_ID and leaves the workspace untouched. Only the last engram of a
// file round-trips there; the property asserts exactly that, nothing stronger.

import fc from "fast-check";
import { anyWorkspaceInputArb, unicodeCrlfWorkspaceArb } from "./arbitraries/adversarial.arb.js";
import { runConsolidation } from "../consolidate/pipeline.js";
import type { PipelineInput } from "../consolidate/pipeline.js";
import { resurrect } from "../crypt/resurrect.js";
import { parseDocument } from "../parse/document.js";
import type { LetheConfig, TombstoneRecord } from "../types.js";
import { checkFullPlan, checkRecords } from "./p7-full-plan.js";
import type { Original } from "./p7-support.js";
import { assertFreshState, buryAlone, deepEqual, fail, originalOf, P7_ID, show } from "./p7-support.js";

export { P7_ID };

/** Inputs from the general adversarial mix and the unicode / CRLF mix. */
export function p7InputArb(cfg: LetheConfig): fc.Arbitrary<PipelineInput> {
  return fc.oneof(anyWorkspaceInputArb(cfg), unicodeCrlfWorkspaceArb(cfg));
}

function checkRestored(text: string, o: Original, t: TombstoneRecord, cfg: LetheConfig): void {
  if (text !== o.text) fail(`${t.id}: restored ${t.file} differs\n  want ${show(o.text)}\n  got  ${show(text)}`);
  const parsed = parseDocument(t.file, text, cfg);
  if (!parsed.ok) fail(`${t.id}: restored file does not parse: ${parsed.error.code}`);
  if (!parsed.value.engrams.some((g) => deepEqual(g, o.node))) {
    fail(`${t.id}: no restored node deep-equals the original ${show(o.node)}`);
  }
}

/** (1) + (4) for one tombstone. */
function checkSingle(input: PipelineInput, o: Original, t: TombstoneRecord): void {
  const { workspace, record } = buryAlone(input, o.scored, t);
  const before = show([...workspace.files]) + show(workspace.tombstones);
  const r = resurrect(workspace, record, input.nowCommit, input.nowISO, input.cfg);
  const mustRoundTrip = input.cfg.granularity === "section" || o.index === o.inFile - 1;
  if (!mustRoundTrip) {
    if (r.ok || r.error.code !== "PARSE_DUPLICATE_ID") {
      fail(`${t.id}: non-last bullet expected PARSE_DUPLICATE_ID, got ${r.ok ? "ok" : r.error.code}`);
    }
    if (before !== show([...workspace.files]) + show(workspace.tombstones)) fail(`${t.id}: workspace touched`);
    return;
  }
  if (!r.ok) fail(`${t.id}: resurrect failed: ${r.error.code} ${r.error.message}`);
  checkRestored(r.value.workspace.files.get(t.file) ?? "", o, t, input.cfg);
  assertFreshState(r.value.state, t.id, input);
}

export function p7Roundtrip(cfg: LetheConfig) {
  return fc.property(p7InputArb(cfg), (input) => {
    const res = runConsolidation(input);
    if (!res.ok) fail(`pipeline failed: ${res.error.code} ${res.error.message}`);
    for (const t of res.value.applied.tombstones) {
      checkSingle(input, originalOf(res.value, input, t), t);
    }
    checkFullPlan(res.value, input);
    checkRecords(res.value, input);
  });
}
