// Child process for test/ops-record-lock.perf.test.ts: takes the REAL workspace lock, signals "ready", holds it.
// argv: <workspaceRoot> <readyFile> [holdMs]
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireLock } from "../../src/io/lock.js";
import { createWorkspaceFs } from "../../src/io/workspace-fs.js";

const [root, readyFile, holdArg] = process.argv.slice(2);
if (root === undefined || readyFile === undefined) {
  process.stderr.write("lock-holder: missing arguments\n");
  process.exit(64);
}

async function main(): Promise<void> {
  const lock = await acquireLock(createWorkspaceFs(root as string), { waitMs: 5000, pollMs: 5 });
  if (!lock.ok) {
    process.stderr.write(`lock-holder: ${lock.error.code}\n`);
    process.exit(2);
  }
  writeFileSync(readyFile as string, "ready");
  await sleep(Number(holdArg ?? "30000"));
  await lock.value.release();
}

main().catch((e: unknown) => {
  process.stderr.write(`lock-holder: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
