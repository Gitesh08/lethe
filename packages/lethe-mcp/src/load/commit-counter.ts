// Commit counter + clock resolution (override > git > state > ledger > zero). Refs: Req 11.1-11.5
import { err, ok, type Result } from "@lethe/core";
import { diagnostic, type Diagnostic } from "../envelope/diagnostics.js";
import { toolError, type ToolError } from "../envelope/errors.js";
import { nodeGit, type GitRunner } from "../io/git.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { loadLedger } from "./ledger-file.js";
import { loadStateFile } from "./state-file.js";

export type CommitSource = "override" | "git" | "state" | "ledger" | "zero";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** True for an ISO 8601 date-time with `Z` or a numeric offset and a real calendar date/time. */
export function isIsoInstant(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (m === null) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (h > 23 || mi > 59 || se > 59) return false;
  const t = new Date(Date.UTC(2000, mo - 1, d));
  t.setUTCFullYear(y);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Highest commit and state commit, read without the full workspace load. Unreadable inputs count as absent. */
export type FallbackReader = () => Promise<{ readonly state: number | undefined; readonly ledger: number | undefined }>;

export function fsFallbackReader(fsx: WorkspaceFs): FallbackReader {
  return async () => {
    const st = await loadStateFile(fsx);
    const lg = await loadLedger(fsx);
    const ledgerMax = lg.ok && lg.value.events.length > 0 ? Math.max(...lg.value.events.map((e) => e.commit)) : undefined;
    return { state: st.ok ? st.value.commit : undefined, ledger: ledgerMax };
  };
}

export interface CommitCounterInput {
  readonly root: string;
  /** `atCommit` / `--commit`. */
  readonly commit?: number | undefined;
  /** `now` / `--now`. */
  readonly now?: string | undefined;
  readonly git?: GitRunner;
  /** Injected clock; called at most once, and only when `now` is absent. */
  readonly clock?: () => Date;
  readonly readFallbacks: FallbackReader;
}

export interface CommitCounter {
  readonly nowCommit: number;
  readonly commitSource: CommitSource;
  readonly nowISO: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const UNAVAILABLE = "git commit count unavailable";

async function fromFallbacks(read: FallbackReader): Promise<{ nowCommit: number; commitSource: CommitSource }> {
  const { state, ledger } = await read();
  if (state !== undefined && state >= (ledger ?? 0)) return { nowCommit: state, commitSource: "state" };
  if (ledger !== undefined && ledger > 0) return { nowCommit: ledger, commitSource: "ledger" };
  return { nowCommit: 0, commitSource: "zero" };
}

/** Resolves `nowISO` first (so INVALID_INPUT precedes any git call), then the commit counter. */
export async function resolveCommitCounter(input: CommitCounterInput): Promise<Result<CommitCounter, ToolError>> {
  if (input.now !== undefined && !isIsoInstant(input.now)) {
    return err(toolError("INVALID_INPUT", "now must be an ISO 8601 date-time with Z or a numeric offset", { field: "now" }));
  }
  const nowISO = input.now ?? (input.clock ?? (() => new Date()))().toISOString();
  if (input.commit !== undefined) {
    return ok({ nowCommit: input.commit, commitSource: "override", nowISO, diagnostics: [] });
  }
  const count = await (input.git ?? nodeGit).commitCount(input.root);
  if (count !== undefined) return ok({ nowCommit: count, commitSource: "git", nowISO, diagnostics: [] });
  const fb = await fromFallbacks(input.readFallbacks);
  return ok({ ...fb, nowISO, diagnostics: [diagnostic("GIT_COMMIT_COUNT_UNAVAILABLE", UNAVAILABLE)] });
}
