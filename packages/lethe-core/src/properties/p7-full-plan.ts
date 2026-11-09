// P7 parts (2) and (3): full-plan round trip and tombstones.json serialization.
// Refs: REQ-CRY-3, INV-3

import type { PipelineInput, PipelineResult } from "../consolidate/pipeline.js";
import { resurrect } from "../crypt/resurrect.js";
import { parseTombstones, serializeTombstones, sortTombstones } from "../crypt/tombstone-json.js";
import type { TombstoneRecord, VirtualWorkspace } from "../types.js";
import { assertFreshState, deepEqual, fail, originalOf, show } from "./p7-support.js";

function byFileThenIndex(a: TombstoneRecord, b: TombstoneRecord): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.position.index !== b.position.index) return a.position.index - b.position.index;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * (2) Resurrect every new tombstone in ascending (file, index) order. Section mode:
 * every call is ok and each touched file is byte-identical to the original.
 * Bullet mode (positional ids): ok or PARSE_DUPLICATE_ID, which leaves the workspace as is.
 */
export function checkFullPlan(res: PipelineResult, input: PipelineInput): void {
  const bullet = input.cfg.granularity === "bullet";
  let ws: VirtualWorkspace = res.applied.workspace;
  for (const t of [...res.applied.tombstones].sort(byFileThenIndex)) {
    const r = resurrect(ws, t, input.nowCommit, input.nowISO, input.cfg);
    if (!r.ok) {
      if (bullet && r.error.code === "PARSE_DUPLICATE_ID") continue;
      fail(`full plan: resurrect of ${t.id} failed: ${r.error.code} ${r.error.message}`);
    }
    assertFreshState(r.value.state, t.id, input);
    ws = r.value.workspace;
  }
  if (bullet) return;
  for (const file of new Set(res.applied.tombstones.map((t) => t.file))) {
    const want = input.workspace.files.get(file);
    const got = ws.files.get(file);
    if (got !== want) fail(`full plan: ${file} not restored\n  want ${show(want)}\n  got  ${show(got)}`);
  }
  if (ws.tombstones.length !== input.workspace.tombstones.length) {
    fail(`full plan: ${ws.tombstones.length} tombstones remain`);
  }
}

/** (3) serialize/parse round trip, raw/body slices and the recorded state. */
export function checkRecords(res: PipelineResult, input: PipelineInput): void {
  const list = res.applied.tombstones;
  const back = parseTombstones(serializeTombstones(list));
  if (!back.ok) fail(`tombstones.json did not parse: ${back.error.message}`);
  if (!deepEqual(back.value, sortTombstones(list))) fail("parseTombstones(serializeTombstones(x)) differs from x");
  for (const t of list) {
    const o = originalOf(res, input, t);
    const slice = o.text.slice(o.node.span.start, o.node.span.end);
    if (t.raw !== slice) fail(`${t.id}: raw is not the file slice by span`);
    if (t.body !== o.node.body) fail(`${t.id}: body differs from the engram body`);
    if (!deepEqual(t.state, o.scored.state)) fail(`${t.id}: state differs from the scored state`);
  }
}
