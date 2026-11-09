// Haunted-repo content, files 03 (engineering rules) and 04 (design system).
// Planted: "Module format" (ESM) and "Failure handling" (Result types) are protected
// winners; "Utility classes" (Tailwind) loses to the protected "Styling approach" (pure CSS).
// Near-duplicate keepers: "Commit conventions", "Review checklist".
import { h2, h3 } from "./haunted-entry.js";
import type { Entry } from "./haunted-entry.js";

export const RULES_ENTRIES: readonly Entry[] = [
  h2(3, "pinHot", "Language and typing",
    "Use strict TypeScript everywhere with zero any. Prefer unknown plus narrowing at boundaries, mark types readonly by default, and use discriminated unions with exhaustive switches. Non-null assertions are for tests only. Public functions are total and return typed diagnostics for bad input, so callers never have to guess which inputs are allowed and which are a programmer mistake.",
    "spec=lethe-core; pin=true; globs=packages/lethe-core/**"),
  h2(3, "pinHot", "Module format",
    "Ship ESM only. Use named exports, import with explicit file extensions, and avoid CommonJS in application and package code alike. Default exports are allowed only where the framework requires them. The compile target is ES2022 on Node 22 or newer, and nothing in the repository should depend on a loader hook or a build-time rewrite to resolve imports.",
    "spec=lethe-core; globs=packages/lethe-core/**,packages/lethe-mcp/**"),
  h2(3, "pinHot", "Failure handling",
    "Return Result types for expected failures instead of raising. Each failure carries a stable code, a message and optional detail. Callers branch on the code, nothing is swallowed silently, and only unexpected programmer mistakes may stop execution. The protocol layer maps codes to tool errors without leaking internals, so the model sees a short reason it can act on.",
    "spec=lethe-core; pin=true; globs=packages/lethe-core/**"),
  h2(3, "warm", "File size",
    "Keep source files under 200 lines per file and functions under 40 lines. Split by responsibility, name each file after its primary export, and avoid barrel files except the package entry point. Long data fixtures may run past the limit because they are declarative or generated, and they should still be split by topic so a reviewer can read one screenful at a time."),
  h2(3, "liveHot", "Testing",
    "Run unit tests with Vitest and property tests with fast-check. Every change to the engine keeps all twelve properties green, one thousand runs in CI and one hundred locally. Print the seed on failure and never pin it in committed config. A bug found by a property gets a shrunk regression example as well, plus a line in the findings table of the memory file.",
    "globs=packages/lethe-core/test/**"),
  h2(3, "dupKeep", "Commit conventions",
    "Write Conventional Commits such as feat(core) or docs(vault) with a footer that lists the requirement ids. Keep commits small and aligned with spec tasks, because the commit counter drives the decay clock. Run typecheck, lint and tests before merging and keep the main branch green at all times, so every merge point is a safe place to start from."),
  h2(3, "warm", "Naming",
    "Use kebab-case for file names and name each file after its primary export. Test files end with a dot test suffix and property tests with a dot pbt suffix. Requirement ids appear in test titles so coverage can be traced from a requirement to a check, and fixtures are named after the scenario they build rather than after the function that consumes them. Directory names are short nouns, and generated files carry a header that says they are generated."),
  h2(3, "dupKeep", "Review checklist",
    "Before approving a change confirm that tests cover the linked requirement ids, that no file exceeds the size limit, that no new dependency slipped into the core package, and that the memory ledger has a fresh changelog line. Reviewers also check keyboard access and reduced motion for any interface work, and ask whether a screenshot is attached for the visual change."),
  h2(3, "stale", "Node 18 compatibility",
    "Keep every script runnable on Node 18 until the end of the quarter. Avoid the newer test helper APIs, polyfill the structured clone call for older runtimes, and note any syntax that needs a transpile step. This rule was written before the move to a newer runtime and no longer applies, but nobody has deleted it, and it still appears in the onboarding notes. Delete this section when the onboarding notes are next revised."),
  h2(3, "warm", "Dependencies",
    "Pin exact versions for every dependency and prefer well known, actively maintained packages. The core package has no runtime dependencies at all, only development tools. Treat an unfamiliar package name with suspicion and check for look-alike spellings before adding it, then record the reason in the pull request so the next reader knows why it was worth the weight. Upgrades happen in their own commit so a regression can be traced to a single version bump."),
];

export const DESIGN_ENTRIES: readonly Entry[] = [
  h2(4, "pinHot", "Styling approach",
    "Write pure CSS. Component styles live next to the component, one global token file defines every color, space, radius and duration, and layout uses grid and flexbox. Never reach for Tailwind or a runtime styling library. Animate transform and opacity only, keep specificity to a single class, and keep the stylesheet readable enough that a newcomer can follow it top to bottom.",
    "spec=lethe-web-sandbox; pin=true; globs=apps/web/**"),
  h2(4, "warm", "Design tokens",
    "Colors, spacing, radii, shadows and durations are custom properties defined once in the token file. Surfaces step through five dark values, accents are a violet for memory and an amber for warnings, and text keeps at least a 4.5 to 1 contrast ratio. Never hard code a hex value outside the token file, because the whole theme must be swappable from one place."),
  h3(4, "warm", "Design tokens", "Spacing scale",
    "Space follows a four pixel base: 4, 8, 12, 16, 24, 32 and 48. Cards use 16 inside and 24 between, the canvas toolbar uses 8, and page gutters grow from 16 on phones to 48 on wide screens. Do not invent one-off values; pick the nearest step and, if none fits, raise it in review instead of adding a new number."),
  h3(4, "warm", "Design tokens", "Motion",
    "Durations come in three sizes, 120, 240 and 480 milliseconds, with one ease-out curve for entrances and one ease-in-out for moves. Fading rules dim and blur gently as retention drops. Honor reduced motion by swapping movement for an opacity change and by stopping all looping effects, including the slow drift on the crypt background."),
  h2(4, "loserHot", "Utility classes",
    "Style components with Tailwind utility classes. Compose layouts with flex and grid helpers, put spacing and color choices directly in the markup, and configure the theme in the Tailwind config file. This keeps stylesheets tiny and makes every component self contained, so there is no separate stylesheet to maintain and no naming debate to have during review."),
  h2(4, "pinFloor", "Accessibility floor",
    "Accessibility is a requirement. Use semantic landmarks, keep a visible focus ring, and give the timeline scrubber arrow-key control with larger steps on shift. Announce meaningful telemetry changes politely and not on every frame. Respect the reduced motion preference everywhere, and check contrast before shipping a new surface or a new accent color. Every interactive element is reachable by keyboard in a logical order, with no focus traps.",
    "pin=true"),
  h2(4, "warm", "Typography",
    "Use the Geist sans family for interface text and Geist Mono for ids, token counts and file paths. Headings use a tight line height and balanced wrapping, body text sits at 15 pixels on a 1.5 line height, and numbers in the telemetry strip use tabular figures so digits do not jitter while the timeline is being scrubbed back and forth. Fallback fonts are system sans and monospace stacks, selected so layout does not shift on load."),
  h2(4, "stale", "Icon set (old)",
    "Icons come from the first mockup bundle: outlined glyphs at 20 pixels with a 1.5 pixel stroke, plus a skull and a ghost for the Halloween theme. The bundle was replaced by inline vector drawings, but a few screens in the old design file still reference the previous names, so do not trust the names you find there when you export assets."),
];
