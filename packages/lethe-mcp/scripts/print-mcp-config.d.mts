export const AUTO_APPROVE: readonly string[];
export function mcpConfigEntry(distPath: string): {
  mcpServers: { lethe: { command: string; args: string[]; autoApprove: string[] } };
};
export function defaultDistPath(): string;
