// All exported types for lethe-core
// Refs: REQ-DEC-1, REQ-PAR-2, INV-7

export type Tier = "hot" | "warm" | "crypt";
export type EngramStatus = "active" | "defeated" | "duplicate";

export interface EngramNode {
  readonly id: string;
  readonly file: string;
  readonly headingPath: readonly string[];
  readonly body: string;
  readonly contentHash: string;
  readonly tokens: number;
  readonly globs: readonly string[];
  readonly specLinks: readonly string[];
  readonly pinned: boolean;
  readonly span: { readonly start: number; readonly end: number };
}

export interface EngramState {
  readonly id: string;
  readonly stability: number;
  readonly lastReinforcedCommit: number;
  readonly lastReinforcedAt: string;
  readonly reinforcements: number;
}

export interface SpecInvariant {
  readonly specName: string;
  readonly active: boolean;
  readonly requirementIds: readonly string[];
  readonly stances: readonly string[];
}

export interface ScoredEngram {
  readonly node: EngramNode;
  readonly state: EngramState;
  readonly deltaC: number;
  readonly weight: number;
  readonly retention: number;
  readonly rawRetention: number;
  readonly tier: Tier;
  readonly status: EngramStatus;
  readonly protected: boolean;
}

export interface ContradictionReport {
  readonly axis: string;
  readonly a: { readonly id: string; readonly stance: string; readonly evidence: string };
  readonly b: { readonly id: string; readonly stance: string; readonly evidence: string };
  readonly severity: "low" | "medium" | "high";
  readonly resolution:
    | { readonly kind: "resolved"; readonly winner: string; readonly loser: string; readonly reason: "spec" | "retention" | "recency" | "id" }
    | { readonly kind: "unresolvable"; readonly reason: "both-protected" };
}

export interface TombstoneRecord {
  readonly schema: 1;
  readonly id: string;
  readonly file: string;
  readonly headingPath: readonly string[];
  readonly body: string;
  /**
   * Exact original file text of the engram: `fileText.slice(span.start, span.end)`
   * (heading line + body, byte-exact incl. CRLF and trailing newline). The parser's
   * `body` excludes the heading line and headingPath loses heading level/text, so
   * `raw` is what makes resurrection byte-exact (REQ-CRY-3, INV-3, P7). `body` is
   * kept for hashing and search.
   */
  readonly raw: string;
  readonly contentHash: string;
  readonly tokens: number;
  readonly meta: { readonly globs: readonly string[]; readonly specLinks: readonly string[]; readonly pinned: boolean };
  readonly state: EngramState;
  readonly reason: "decayed" | "contradiction" | "duplicate";
  readonly retentionAtDeath: number;
  readonly buriedAtCommit: number;
  readonly buriedAt: string;
  readonly defeatedBy?: string;
  readonly position: { readonly index: number; readonly neighborBefore?: string };
}

export interface SleepConsolidationResult {
  readonly archived: readonly TombstoneRecord[];
  readonly merged: ReadonlyArray<{ readonly keep: string; readonly drop: string }>;
  readonly demoted: readonly string[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly budget: number;
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly pbtGate: "passed" | "failed" | "skipped";
  readonly applied: boolean;
}

export interface LetheConfig {
  readonly s0: number;
  readonly sMax: number;
  readonly sMin: number;
  readonly beta: number;
  readonly alpha: number;
  readonly wDefault: number;
  readonly wSpec: number;
  readonly specFloor: number;
  readonly hotMin: number;
  readonly cryptMax: number;
  readonly budgetTokens: number;
  readonly dedupeJaccard: number;
  readonly granularity: "section" | "bullet";
}

export interface LedgerEvent {
  readonly type: "task_passed" | "spec_cited" | "manual_pin";
  readonly at: string;
  readonly commit: number;
  readonly filesTouched?: readonly string[];
  readonly cited?: readonly string[];
}

export interface ParsedDoc {
  readonly file: string;
  readonly frontmatter: string | null;
  readonly engrams: readonly EngramNode[];
  readonly rawText: string;
}

export interface Annotation {
  readonly globs: readonly string[];
  readonly specLinks: readonly string[];
  readonly pinned: boolean;
}

export interface StanceMatch {
  readonly axisId: string;
  readonly stanceId: string;
  readonly polarity: "+" | "-";
  readonly evidence: string;
}

export interface Stance {
  readonly id: string;
  readonly label: string;
  readonly patterns: readonly string[];
  readonly negationAware: boolean;
}

export interface Axis {
  readonly id: string;
  readonly description: string;
  readonly stances: readonly Stance[];
}

export type Ontology = readonly Axis[];

export interface ConsolidationPlan {
  readonly toArchive: ReadonlyArray<{
    readonly engram: ScoredEngram;
    readonly reason: TombstoneRecord["reason"];
    readonly defeatedBy?: string;
  }>;
  readonly toMerge: ReadonlyArray<{ readonly keep: ScoredEngram; readonly drop: ScoredEngram }>;
  readonly toDemote: readonly string[];
  readonly budgetStatus: "ok" | "budget_infeasible";
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface VirtualWorkspace {
  readonly files: ReadonlyMap<string, string>;
  readonly tombstones: readonly TombstoneRecord[];
}

export type ErrorCode =
  | "PARSE_INVALID_FRONTMATTER"
  | "PARSE_DUPLICATE_ID"
  | "CONFIG_INVALID"
  | "ONTOLOGY_INVALID_PATTERN"
  | "BUDGET_INFEASIBLE"
  | "TOMBSTONE_NOT_FOUND"
  | "PATH_ESCAPE"
  | "PBT_GATE_FAILED";

export interface LetheError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly detail?: unknown;
}

export type Result<T, E = LetheError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
