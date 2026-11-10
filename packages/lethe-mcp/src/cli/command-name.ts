// Names of the CLI subcommands. Shared by args parsing, exit-code mapping, and rendering.
export const CLI_COMMAND_NAMES = ["check", "record", "score", "sleep", "resurrect", "adopt", "probe", "serve"] as const;

export type CliCommandName = (typeof CLI_COMMAND_NAMES)[number];
