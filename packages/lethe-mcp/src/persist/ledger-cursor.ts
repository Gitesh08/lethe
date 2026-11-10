// Cursor naming the ledger prefix already folded into state.json. Refs: Req 10.6, Req 23
export interface LedgerCursor {
  readonly lines: number;
  readonly bytes: number;
  readonly lastLineSha256: string | null;
}

export const ZERO_CURSOR: LedgerCursor = { lines: 0, bytes: 0, lastLineSha256: null };
