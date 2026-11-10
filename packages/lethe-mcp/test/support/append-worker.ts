// Child process for test/ledger-append-race.perf.test.ts. Runs the REAL appendLedgerEvent.
// argv: <workspaceRoot> <workerId> <count>
import { createWorkspaceFs } from "../../src/io/workspace-fs.js";
import { appendLedgerEvent } from "../../src/persist/ledger-append.js";

const [root, id, count] = process.argv.slice(2);
if (root === undefined || id === undefined || count === undefined) {
  process.stderr.write("append-worker: missing arguments\n");
  process.exit(64);
}

async function main(): Promise<void> {
  const fsx = createWorkspaceFs(root as string);
  const w = Number(id);
  for (let i = 0; i < Number(count); i++) {
    const filesTouched = Array.from({ length: 40 }, (_, k) => `packages/some/long/path/segment/worker-${w}/item-${i}/file-${k}.ts`);
    const r = await appendLedgerEvent(fsx, {
      type: "task_passed",
      at: "2026-11-20T10:00:00Z",
      commit: w * 1000 + i,
      filesTouched,
      cited: [`w${w}`, `i${i}`],
    });
    if (!r.ok) {
      process.stderr.write(`append-worker ${id}: ${r.error.code} ${r.error.message}\n`);
      process.exit(2);
    }
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`append-worker ${id}: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
