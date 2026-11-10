export function extractIds(text: string): string[];
export function traceTable(files: ReadonlyArray<{ path: string; text: string }>): string;
export function collectTestFiles(root: string): Array<{ path: string; text: string }>;
export function defaultRoot(): string;
