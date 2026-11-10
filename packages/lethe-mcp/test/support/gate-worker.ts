// Cold-process gate timing worker: argv[2] = result file. Writes one JSON line there; stdout stays silent.
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DEFAULT_CONFIG } from "@lethe/core";
import { defaultGateRunner } from "../../src/gate/gate.js";

const out = process.argv[2];
if (out === undefined) throw new Error("result file argument required");

const t0 = performance.now();
const outcome = await defaultGateRunner(DEFAULT_CONFIG, 100);
const gateMs = performance.now() - t0;
// performance.now() is measured from process time origin, so this is process start to first gate completion.
const sinceProcessStartMs = performance.now();

writeFileSync(
  out,
  `${JSON.stringify({
    status: outcome.status,
    numRuns: outcome.status === "passed" ? outcome.numRuns : undefined,
    ran: outcome.status === "passed" ? outcome.ran : undefined,
    gateMs,
    sinceProcessStartMs,
  })}\n`,
);
