// Two simultaneous `sleep --apply` processes on one workspace: one wins, the other sees LOCKED or nothing to do.
// Refs: Req 9.5, Req 21.6, INV-4
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkspaceFs } from "../src/io/workspace-fs.js";
import { loadStateFile } from "../src/load/state-file.js";
import { serializeState } from "../src/persist/state-serialize.js";
import { spawnCli, type SpawnResult } from "./helpers/spawn-cli.js";
import { materialiseHaunted } from "./support/haunted-ws.js";

const BUNDLE = join(__dirname, "..", "dist", "lethe.mjs");
const REPEATS = 5;
const roots: string[] = [];

interface Env {
  readonly ok: boolean;
  readonly data?: { readonly applied: boolean; readonly archived: ReadonlyArray<unknown> };
  readonly error?: { readonly code: string };
}

async function freshWorkspace(): Promise<{ root: string; args: string[] }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lethe-conc-sleep-")));
  roots.push(root);
  const repo = await materialiseHaunted(root);
  const fsx = createWorkspaceFs(root);
  const cur = await loadStateFile(fsx);
  if (!cur.ok) throw new Error("state load failed");
  const w = await fsx.writeAtomic(
    ".kiro/lethe/state.json",
    serializeState({ commit: repo.nowCommit, at: repo.nowISO, ledger: cur.value.cursor, engrams: repo.states }),
  );
  if (!w.ok) throw new Error(w.error.message);
  return { root, args: ["sleep", "--apply", "--json", "--gate-runs", "10", "--commit", String(repo.nowCommit), "--now", repo.nowISO] };
}

/** Relative path -> bytes for every file outside backup/, plus the set of backup entry names. */
function snapshot(root: string): { files: Map<string, string>; backups: string[] } {
  const files = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      if (r === ".kiro/lethe/backup") continue;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else files.set(r, readFileSync(abs).toString("base64"));
    }
  };
  walk(root, "");
  const bdir = join(root, ".kiro", "lethe", "backup");
  return { files, backups: existsSync(bdir) ? readdirSync(bdir).sort() : [] };
}

const env = (r: SpawnResult): Env => JSON.parse(r.stdout) as Env;

afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

describe("two simultaneous sleep --apply processes", () => {
  it("one run archives, the other is LOCKED or a no-op; final bytes equal a single run", async () => {
    const oracle = await freshWorkspace();
    const single = await spawnCli(BUNDLE, oracle.args, oracle.root, 120_000);
    expect(single.code).toBe(0);
    expect(env(single).data?.archived.length).toBe(11);
    const want = snapshot(oracle.root);
    expect(existsSync(join(oracle.root, ".kiro", "lethe", "pbt-failures.json"))).toBe(false);

    const outcomes: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const w = await freshWorkspace();
      const t0 = Date.now();
      const [a, b] = await Promise.all([
        spawnCli(BUNDLE, w.args, w.root, 120_000),
        spawnCli(BUNDLE, w.args, w.root, 120_000),
      ]);
      const ms = Date.now() - t0;
      const runs = [a, b].map((r) => ({ r, e: env(r) }));
      const winners = runs.filter(({ e }) => e.ok && e.data?.applied === true && (e.data.archived.length > 0));
      const losers = runs.filter((x) => !winners.includes(x));
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const loser = losers[0]!;
      const winner = winners[0]!;
      expect(winner.r.code).toBe(0);
      expect(winner.e.data?.archived.length).toBe(11);
      if (loser.e.ok) {
        expect(loser.r.code).toBe(0);
        expect(loser.e.data?.archived).toEqual([]);
        outcomes.push("empty");
      } else {
        expect(loser.e.error?.code).toBe("LOCKED");
        expect(loser.r.code).toBe(74);
        outcomes.push("LOCKED");
      }
      const got = snapshot(w.root);
      expect([...got.files.keys()]).toEqual([...want.files.keys()]);
      for (const [p, bytes] of want.files) expect(got.files.get(p), p).toBe(bytes);
      expect(got.backups).toEqual(want.backups);
      expect(existsSync(join(w.root, ".kiro", "lethe", "pbt-failures.json"))).toBe(false);
      console.error(`concurrency-sleep #${i + 1}: loser=${outcomes[i]} ${ms} ms backups=${got.backups.join(",")}`);
    }
  }, 300_000);
});
