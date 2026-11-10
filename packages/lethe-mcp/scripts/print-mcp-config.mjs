// Prints a user-level ~/.kiro/settings/mcp.json block for the `lethe` server
// with an absolute path to dist/lethe.mjs. Fallback for assumption A4 (the
// server's cwd is not the workspace root). Print-only: never writes any file.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The two read-only tools; must match .kiro/settings/mcp.json (Req 17.1, 17.2). */
export const AUTO_APPROVE = Object.freeze(["lethe_score_memories", "lethe_detect_contradictions"]);

/** Pure: build the config object for an absolute `distPath`. No env, disabled, or disabledTools. */
export function mcpConfigEntry(distPath) {
  return {
    mcpServers: {
      lethe: {
        command: "node",
        args: [distPath, "serve"],
        autoApprove: [...AUTO_APPROVE],
      },
    },
  };
}

/** Absolute, native-separator path to dist/lethe.mjs, resolved from this script's location. */
export function defaultDistPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "dist", "lethe.mjs");
}

function main() {
  const distPath = defaultDistPath();
  if (!existsSync(distPath)) {
    console.error(`print-mcp-config: warning: ${distPath} does not exist yet; run the build first.`);
  }
  process.stdout.write(`${JSON.stringify(mcpConfigEntry(distPath), null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
