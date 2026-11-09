// Public entry point "@lethe/core/properties": the 12 PBT property factories, the gate and
// the few arbitraries the sandbox needs. Requires the optional peer dependency fast-check.
export { P1_ID, p1Range } from "./p1-range.js";
export { P2_ID, p2Monotonic } from "./p2-monotonic.js";
export { P3_ID, p3Reinforce } from "./p3-reinforce.js";
export { P4_ID, p4Protected, p4ProtectedEndToEnd } from "./p4-protected.js";
export { P5_ID, p5Contradiction } from "./p5-contradiction.js";
export { P6_ID, p6Budget } from "./p6-budget.js";
export { P7_ID, p7Roundtrip } from "./p7-roundtrip.js";
export { P8_ID, p8Idempotent, p8IdempotentDuplicates } from "./p8-idempotent.js";
export { P9_ID, p9Determinism } from "./p9-determinism.js";
export { P10_ID, p10Partition } from "./p10-partition.js";
export { P11_ID, p11Symmetric } from "./p11-symmetric.js";
export { P12_ID, p12Serialize } from "./p12-serialize.js";
export { anyWorkspaceInputArb } from "./arbitraries/adversarial.arb.js";
export { markdownDocumentArb } from "./arbitraries/engram.arb.js";
export { toJsonSafe } from "./json-safe.js";
export {
  DEFAULT_GATE_RUNS,
  PROPERTY_IDS,
  appendPbtFailure,
  pbtFailureEntry,
  runGate,
  runPbtGate,
} from "./gate.js";
export type { GateEntry, PbtFailure, PbtFailureEntry, PbtGateOptions, PbtGateResult } from "./gate.js";
