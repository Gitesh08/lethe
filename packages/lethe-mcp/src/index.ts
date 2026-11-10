// Public API of @lethe/mcp. Later tasks add createLetheServer, runCli, and more.
export { LETHE_MCP_VERSION } from "./version.js";

export {
  ScoreMemoriesInput,
  DetectContradictionsInput,
  ConsolidateSleepInput,
  ResurrectEngramInput,
  inputJsonSchema,
} from "./tools/schemas.js";
export type {
  ScoreMemoriesArgs,
  DetectContradictionsArgs,
  ConsolidateSleepArgs,
  ResurrectEngramArgs,
} from "./tools/schemas.js";
export { WorkspacePath, IsoInstant, Commit } from "./tools/schemas-common.js";
