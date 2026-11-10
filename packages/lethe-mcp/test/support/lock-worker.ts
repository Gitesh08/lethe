// Child process for test/lock-race.perf.test.ts. Runs the REAL acquireLock/withLock.
// argv: <workspaceRoot> <workerId> <logFile> <counterFile>
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { acquireLock } from "../../src/io/lock.js";
import { createWorkspaceFs } from "../../src/io/workspace-fs.js";

const [root, id, logFile, counterFile] = process.argv.slice(2);
if (root === undefined || id === undefined || logFile === undefined || counterFile === undefined) {
  process.stderr.write("lock-worker: missing arguments\n");
  process.exit(64);
}

async function main(): Promise<void> {
  const fsx = createWorkspaceFs(root as string);
  const lock = await acquireLock(fsx, { waitMs: 30_000, pollMs: 5 });
  if (!lock.ok) {
    process.stderr.write(`lock-worker ${id}: ${lock.error.code} ${JSON.stringify(lock.error.detail ?? null)}\n`);
    process.exit(2);
  }
  try {
    appendFileSync(logFile as string, `enter ${id} ${process.hrtime.bigint()}\n`);
    const n = Number(readFileSync(counterFile as string, "utf8"));
    await sleep(10 + (Number(id) % 3) * 5); // widen the read-modify-write window
    writeFileSync(counterFile as string, String(n + 1));
    appendFileSync(logFile as string, `exit ${id} ${process.hrtime.bigint()}\n`);
  } finally {
    await lock.value.release();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`lock-worker ${id}: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
