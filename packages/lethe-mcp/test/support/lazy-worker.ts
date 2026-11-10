// Lazy-load probe worker: argv[2] = workspace dir, argv[3] = result file.
// The parent bundles this file with a plugin that makes the properties entry and fast-check push their
// name into globalThis.__letheLoads when they evaluate, so the snapshots below observe real module loads.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultGateRunner } from "../../src/gate/gate.js";
import { buildContext } from "../../src/ops/context.js";
import { detectContradictionsOp } from "../../src/ops/detect.js";
import { scoreMemories } from "../../src/ops/score.js";
import { sleepOp } from "../../src/ops/sleep.js";
import "../../src/index.js";

const [dir, out] = [process.argv[2], process.argv[3]];
if (dir === undefined || out === undefined) throw new Error("workspace and result file arguments required");

mkdirSync(join(dir, ".kiro", "steering"), { recursive: true });
writeFileSync(join(dir, ".kiro", "steering", "a.md"), "## Rule one\n\nPrefer small functions and short files in every module.\n\n## Rule two\n\nName tests after the behaviour they check, in plain words.\n");

const loads = (): string[] => [...((globalThis as { __letheLoads?: string[] }).__letheLoads ?? [])];
const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };
const built = await buildContext(
  { workspacePath: dir, commit: 10, now: "2026-11-10T12:00:00.000Z" },
  { git: noGit, lock: { waitMs: 0 }, log: () => undefined, gate: defaultGateRunner },
);
if (!built.ok) throw new Error(built.error.message);
const ctx = built.value;

const snaps: Record<string, string[]> = { atStart: loads() };
await scoreMemories(ctx, { includeSpecs: false });
await detectContradictionsOp(ctx, { scope: "all" });
const skipped = await sleepOp(ctx, { apply: false, skipGate: true, gateRuns: 5 });
snaps["afterSkipGate"] = loads();
const first = await sleepOp(ctx, { apply: false, skipGate: false, gateRuns: 5 });
snaps["afterFirstGate"] = loads();
const second = await sleepOp(ctx, { apply: false, skipGate: false, gateRuns: 5 });
snaps["afterSecondGate"] = loads();

const gate = (r: typeof first): string => (r.ok ? r.value.pbtGate : `error:${r.error.code}`);
writeFileSync(out, `${JSON.stringify({ snaps, gates: [gate(skipped), gate(first), gate(second)] })}\n`);
