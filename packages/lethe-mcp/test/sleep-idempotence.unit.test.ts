// End-to-end idempotence of sleep --apply through the real IO layer. Refs: Req 4.8, Req 23.10, Req 21.8, INV-4
// Setup: adopt at the fixture's own commit (stamps persisted states), then sleep 150 commits later so
// engrams actually decay (archive/demote). Second apply with identical commit/now must write nothing.
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubTo } from "@lethe/core/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubGate } from "../src/gate/gate.js";
import { adoptOp } from "../src/ops/adopt.js";
import { buildContext, type RunContext } from "../src/ops/context.js";
import { sleepOp } from "../src/ops/sleep.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

let root = "";
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-idem-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const noGit = { commitCount: async () => undefined, changedFiles: async () => undefined };

async function ctxAt(commit: number, now: string): Promise<RunContext> {
  const r = await buildContext(
    { workspacePath: root, commit, now },
    { git: noGit, gate: stubGate("passed"), log: () => undefined, lock: { waitMs: 0 } },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** path (posix) -> hex bytes for every file under root. */
function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
    const abs = join(root, rel);
    if (statSync(abs).isFile()) out.set(rel.replaceAll("\\", "/"), readFileSync(abs).toString("hex"));
  }
  return out;
}

const backupDirs = (): string[] => {
  try {
    return readdirSync(join(root, ".kiro/lethe/backup")).sort();
  } catch {
    return [];
  }
};

describe("sleep --apply idempotence over the haunted repo", () => {
  it("a second apply with the same commit and now changes nothing", async () => {
    const repo = await materialiseHaunted(root);
    const later = scrubTo(repo, 150);
    const adopt = await adoptOp(await ctxAt(repo.nowCommit, repo.nowISO), { apply: true });
    expect(adopt.ok).toBe(true);

    const input = { apply: true, skipGate: false, gateRuns: 20 };
    const first = await sleepOp(await ctxAt(later.nowCommit, later.nowISO), input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.applied).toBe(true);
    expect(first.value.pbtGate).toBe("passed");
    expect(first.value.archived.length).toBeGreaterThan(0);

    const files = snapshot();
    const backups = backupDirs();
    expect(files.has(".kiro/lethe/state.json")).toBe(true);
    expect(files.has(".kiro/crypt/tombstones.json")).toBe(true);
    expect(files.has(".kiro/lethe/ledger.jsonl")).toBe(true);
    expect(backups.length).toBeGreaterThan(0);

    const second = await sleepOp(await ctxAt(later.nowCommit, later.nowISO), input);
    expect(second.ok).toBe(true);
    // Documented: `applied` is true even when nothing differs; no backupPath because nothing was written.
    if (second.ok) {
      expect(second.value.applied).toBe(true);
      expect(second.value.backupPath).toBeUndefined();
      expect(second.value.archived).toEqual([]);
    }
    expect(snapshot()).toEqual(files);
    expect(backupDirs()).toEqual(backups);
  });
});
