// Haunted-repo content, files 05 (workflow) and 06 (memory ledger).
// Planted losers: "Helper scripts" (CommonJS) and "Error conventions" (exceptions).
// Near-duplicate droppers: "Commit messages", "Pull request checklist", "State files".
import { h2, h3 } from "./haunted-entry.js";
import type { Entry } from "./haunted-entry.js";

export const WORKFLOW_ENTRIES: readonly Entry[] = [
  h2(5, "warm", "Spec-driven flow",
    "Use spec mode for the core package, the tool server and the fixtures. Requirements are written in EARS form with ids, the design lists the correctness properties, and the task list treats property tests as first class items. A task is finished only when its linked requirement ids are covered by a passing check and the memory ledger has been updated."),
  h3(5, "warm", "Spec-driven flow", "Vibe sessions",
    "Use vibe mode for the interface: composition, motion and polish guided by the design system file. After each session write a short note of the decisions into the memory ledger, including prompts that worked well and anything that had to be redone by hand, so the write-up can describe the contrast with spec mode honestly."),
  h2(5, "dupDrop", "Commit messages",
    "Write Conventional Commits such as feat(core) or docs(vault) with a footer that lists the requirement ids. Keep commits small and aligned with spec tasks, because the commit counter drives the decay clock. Run typecheck, lint and tests before merging and keep the main branch green all the time, so every merge point is a safe place to start from."),
  h2(5, "liveHot", "Hooks",
    "Hooks stay small, fast and idempotent. One checks contradictions when a steering file is saved, one records a passed task with the files it touched, and one runs a dry sleep on demand. A hook never edits source silently; it may only write under the lethe folder or append to the memory ledger, and it must finish in a couple of seconds at most.",
    "globs=packages/lethe-mcp/**"),
  h2(5, "dupDrop", "Pull request checklist",
    "Before approving a change confirm that tests cover the linked requirement ids, that no file exceeds the size limit, that no new dependency slipped into the core package, and that the memory ledger has a new changelog line. Reviewers also check keyboard access and reduced motion for any interface work, and ask whether a screenshot is attached for the visual change."),
  h2(5, "loserHot", "Helper scripts",
    "Write helper scripts with require() and module.exports so they run without a build step. Load the config with a plain require call, export one function per script, and keep them in the scripts folder. This matches how the older tooling in the repository was written and avoids any transpile setup, which keeps the scripts easy to run from a fresh checkout."),
  h2(5, "stale", "Release steps",
    "To cut a release: bump the version by hand, update the changelog, tag the commit, build the archive on a laptop and upload it to the release page. A scripted pipeline replaced all of this long ago, but the manual list is still here from the early days, along with a note about which laptop had the right certificates installed. Nobody should follow these steps today."),
  h2(5, "stale", "Branch strategy",
    "Long lived feature branches named after the author, merged through a weekly integration branch on Fridays, with a freeze on Thursday evening. The team moved to short branches off main and daily merges, so this schedule is only of historical interest now, though the freeze reminder still pops up in a calendar somewhere."),
];

export const MEMORY_ENTRIES: readonly Entry[] = [
  h2(6, "pinHot", "Ledger protocol",
    "After a completed spec task with green tests, append one changelog line with the date, phase, mode and requirement ids. Record every property finding with its shrunk counterexample and root cause. Never paste code or long logs here; link to files and commits, and move anything older than three phases into the archive folder so this file stays short.",
    "spec=lethe-mcp; globs=packages/lethe-mcp/**"),
  h2(6, "pinFloor", "Locked decisions",
    "Monorepo with workspaces and a task runner. The core stays pure and shared by every surface. Mutations are dry run unless apply is set, and tombstones are byte exact. The hot threshold is 0.60, the crypt threshold is 0.25, and the default prompt budget is four thousand tokens. Change a decision by editing its row, never by adding a contradicting one. Anything marked pinned here is exempt from fading and can only be changed by a person.",
    "pin=true"),
  h2(6, "warm", "PBT findings",
    "Two bugs found by properties so far. Reinforcement with an out-of-order event moved the time reference backwards and collapsed retention, fixed by keeping the later timestamp. Two same-named specs produced a duplicate report for one pair, fixed by merging them into one side. Both have regression examples next to the properties that found them. The next candidates are the budget demotion order and the placement of resurrected sections."),
  h2(6, "warm", "Open questions",
    "Can the hook context list the files touched by a task, or must the diff be used? Can lessons be read as plain files? Does the crew app need its own public repository? Should the sleep command also back up changed files by default? Each answer must be verified against the documentation before it is written down as a fact in this file. Unanswered questions stay in this list until a source is linked, then move to the verified table."),
  h2(6, "dupDrop", "State files",
    "State lives in a small JSON file keyed by id with stability, the last reinforced commit and a reinforcement count. The ledger is append only, one JSON object per line. Tombstones are stored sorted by burial commit then id, with two space indentation and stable key order so diffs stay clean and output is byte deterministic from run to run."),
  h2(6, "loserHot", "Error conventions",
    "Throw an exception from helpers when input is invalid and catch it with try/catch at the call site. Wrap risky calls in a handler near the entry point and log the message there. This keeps function signatures short because no failure object has to be threaded through the callers, and it is the style the first prototype used throughout."),
  h2(6, "stale", "Old changelog",
    "Early notes: first scaffold created, folder layout argued over twice, a prototype scorer printed a table to the terminal, a sticky note about renaming the project, and a reminder to buy a domain. None of these entries are referenced by current work, and none of the decisions they describe survived the first week of the rewrite. Kept only because deleting it felt rude."),
];
