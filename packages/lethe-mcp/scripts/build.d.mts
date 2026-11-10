// Types for scripts/build.mjs (plain ESM JS) so tests can import it under strict tsc.
export interface BuildBundleOptions {
  readonly outfile?: string;
  readonly write?: boolean;
}
export interface BuildBundleResult {
  readonly text: string;
  readonly bytes: number;
  readonly outfile: string;
}
export function buildBundle(opts?: BuildBundleOptions): Promise<BuildBundleResult>;
