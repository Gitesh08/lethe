// Haunted-repo content, files 01 (product brief) and 02 (architecture).
// Data only. Planted: the stale RxJS "State services (legacy)" loser (state-management)
// against the protected "State" winner; the Persistence formats near-duplicate keeper.
// Vocabulary note: the stance words of the default ontology appear ONLY where planted.
import { h2 } from "./haunted-entry.js";
import type { Entry } from "./haunted-entry.js";

export const PRODUCT_ENTRIES: readonly Entry[] = [
  h2(1, "warm", "Vision",
    "Lethe gives steering files a memory that {fades|decays} on purpose. Every rule carries a retention score, rules nobody uses sink out of the always-included set, and nothing is ever deleted without a byte-exact tombstone. The goal is a smaller prompt that still holds everything the project currently depends on, plus a reliable way to bring any buried rule back when it matters again. Success is measured in tokens saved, contradictions caught and rules restored on request."),
  h2(1, "warm", "Target users",
    "Developers who keep long-lived steering and memory files for an AI coding agent. Their files grow with every session, start to disagree with each other, and slowly crowd the context window. They want a tidy prompt without hand-editing markdown every week, and they want proof that nothing important was lost along the way, with a clear report of what changed. The first audience is hackathon judges, who get a guided tour in the browser with nothing to install."),
  h2(1, "liveHot", "Sandbox demo script",
    "The judge sandbox opens on a haunted repository. Walk through four beats: scrub the time slider to watch rules fade, open the contradiction list, press sleep to bury the stale rules, then resurrect one tombstone to show the round trip. Keep the token counter visible the whole time and label every reinforcement figure as estimated utility, never as measured fact.",
    "globs=apps/web/**"),
  h2(1, "pinFloor", "Honest limits",
    "Contradiction detection is a deterministic pattern ontology, not semantic understanding, so contradictions outside the ontology go unnoticed. Reinforcement is a heuristic derived from the task ledger and is always presented as estimated utility. The decay constants are tuned for the demo and stay configurable. Say all of this plainly in the readme and in the write-up. The sandbox shows every limit next to the feature it qualifies, not hidden in a footnote.",
    "pin=true"),
  h2(1, "stale", "Roadmap (old)",
    "Goals from the first planning pass: ship a prototype that scores steering files, add a weekly digest email, publish a plugin for a second editor, and write a long form tutorial series with screenshots. Most of these were dropped when the project narrowed to the hackathon scope, and the digest idea is parked for good. Revisit only after the submission is in and the dust has settled. The only item that survived is the scorer, and it was rewritten from scratch."),
  h2(1, "stale", "Launch checklist",
    "Before the first public announcement: register the project name, draft the landing page copy, record a two minute teaser, collect three quotes from early testers, and schedule the social posts for Tuesday morning. The teaser script was rewritten twice and the quotes never arrived, so most boxes on this list were never ticked. Treat it as a record of intent rather than a plan. The landing page copy was later folded into the readme and the teaser became the demo script."),
];

export const ARCHITECTURE_ENTRIES: readonly Entry[] = [
  h2(2, "pinHot", "Engine boundary",
    "One engine, three surfaces. The core package is pure TypeScript with no runtime dependencies and no IO. Clock and commit counter are inputs, randomness appears only in seeded fixtures, and every function returns data instead of touching the disk. The tool server, the command line and the browser sandbox all call the same functions, which is what makes the safety claims testable in one place.",
    "spec=lethe-core; pin=true; globs=packages/lethe-core/**"),
  h2(2, "warm", "Data flow",
    "A scoring pass reads markdown, parses sections into engrams, joins them with their saved state and the task ledger, and computes retention and tier. Detection then looks for conflicting stances, the planner decides what to archive, merge or demote, and only an explicit apply step writes files. Every stage is a pure function, so a dry run is simply the pipeline without its last step. Because the plan is data, the studio can render the same result a hook prints to a terminal."),
  h2(2, "pinHot", "State",
    "Share UI state with signals. The studio keeps one small store, derives everything else during render, and avoids duplicated copies of scored data. Components subscribe to the slices they need and never mirror props into local state. Keep derived values in selectors so scrubbing the timeline stays cheap and predictable, even with a few hundred engrams on screen at once.",
    "spec=lethe-web-sandbox; globs=apps/web/**"),
  h2(2, "stale", "State services (legacy)",
    "Share state through RxJS services. Each feature owns a BehaviorSubject that components subscribe to, with a ReplaySubject for late joiners and a shared facade per feature module. Remember to unsubscribe in teardown hooks and to complete every stream. This was the pattern before the rewrite, and a few old notes and diagrams still describe it in detail."),
  h2(2, "dupKeep", "Persistence formats",
    "State lives in a small JSON file keyed by engram id with stability, the last reinforced commit and a reinforcement count. The ledger is append only, one JSON object per line. Tombstones are stored sorted by burial commit then id, with two space indentation and stable key order so diffs stay clean and output is byte deterministic from run to run."),
  h2(2, "liveHot", "Path guard",
    "Every path the tools touch is resolved against the workspace root and rejected when it escapes it. Symlinks that point outside the root are refused too. Writes go to a temporary file in the same directory, are flushed, and then renamed into place, so a crash never leaves a half written steering file behind. Report a refused path with a stable error code, never a stack.",
    "globs=packages/lethe-mcp/src/**"),
  h2(2, "warm", "Deployment",
    "The web studio ships as a static build on a managed hosting platform. The core package is consumed as a workspace dependency and transpiled together with the app. Nothing calls the network at runtime, no analytics are loaded, and dropped files are processed entirely inside the browser tab, so a visitor can inspect the page and see that nothing leaves it. Preview builds are created for every branch so a reviewer can scrub the timeline before merging."),
  h2(2, "warm", "Safety model",
    "Mutating tools are dry run by default and need an explicit apply flag. Before an apply, the pre-image of every changed file is copied into the backup folder. Patterns in the ontology are validated and run on capped input, markdown content is never executed, and logs go to the diagnostic stream so the protocol channel stays clean for the client that is listening to it. A refused request is reported with a stable code and a short reason that a model can act on."),
];
