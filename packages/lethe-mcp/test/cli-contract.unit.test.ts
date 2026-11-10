// Contract snapshots for the CLI surface (Req 13.10): --help text and the exit-code table.
// A later Crew adapter depends on these. Snapshots are only written when missing; change them
// deliberately with:
//   npx vitest run --config vitest.unit.config.ts test/cli-contract -u
// In CI (CI=true) a missing snapshot fails instead of being written.
import { describe, expect, it } from "vitest";
import { COMMAND_OPTIONS, GLOBAL_OPTIONS } from "../src/cli/args-spec.js";
import { COMMAND_NAMES } from "../src/cli/args-types.js";
import { ERROR_EXIT, EXIT_BLOCK, EXIT_FINDING, EXIT_OK, EXIT_USAGE } from "../src/cli/exit-code.js";
import { helpText } from "../src/cli/help.js";

const lf = (s: string): string => s.replace(/\r\n/g, "\n");

describe("CLI contract snapshots", () => {
  it("top-level --help", async () => {
    await expect(lf(helpText())).toMatchFileSnapshot("./__snapshots__/cli-help.txt");
  });

  for (const cmd of COMMAND_NAMES) {
    it(`--help for ${cmd}`, async () => {
      await expect(lf(helpText(cmd))).toMatchFileSnapshot(`./__snapshots__/cli-help-${cmd}.txt`);
    });
  }

  it("exit-code table", async () => {
    const table = {
      globalOptions: Object.keys(GLOBAL_OPTIONS).sort(),
      commands: Object.fromEntries(
        [...COMMAND_NAMES].sort().map((c) => [c, Object.keys(COMMAND_OPTIONS[c]).sort()]),
      ),
      outcomes: {
        success: EXIT_OK,
        checkFindings: EXIT_FINDING,
        checkFindingsWithBlock: EXIT_BLOCK,
        sleepGateFailed: EXIT_FINDING,
        sleepGateFailedWithBlock: EXIT_BLOCK,
        usage: EXIT_USAGE,
      },
      errorExit: Object.entries(ERROR_EXIT)
        .sort(([ka, a], [kb, b]) => a - b || (ka < kb ? -1 : ka > kb ? 1 : 0))
        .map(([code, exit]) => ({ code, exit })),
    };
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/cli-exit-codes.json");
  });
});
