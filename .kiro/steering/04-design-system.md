---
inclusion: fileMatch
fileMatchPattern: "apps/web/**/*"
---
# 04 — Design System: "Obsidian Laboratory"

Minimalist Bento grid + spatial canvas + Linear-grade dark precision, with a quiet clinical-haunted edge (no clip-art, no cartoon ghosts). Spooky comes from **decay, dimming, and crimson contradiction**, never from decoration.

## 1. Principles
1. **Data is the decoration.** Glow, opacity, and position encode retention.
2. **One viewport.** At ≥ 1280×720 everything important is visible without scrolling.
3. **Quiet by default, loud on events.** Idle UI is calm; contradictions and burials are the only high-energy moments.
4. **Numbers never jitter.** Tabular numerals everywhere numbers change.
5. **Motion explains.** Every animation communicates a state change (decay, burial, resurrection).

## 2. Tokens — `styles/tokens.css`

```css
@layer reset, tokens, base, components, utilities;

@layer tokens {
  :root {
    color-scheme: dark;

    /* Surfaces */
    --c-void: #060709;
    --c-surface: #0d0f14;
    --c-surface-raised: #12151c;
    --c-surface-sunken: #090b0f;
    --c-border: rgb(255 255 255 / 0.07);
    --c-border-strong: rgb(255 255 255 / 0.14);
    --c-highlight: rgb(255 255 255 / 0.05);   /* top inner specular */

    /* Text */
    --c-text: #f3f4f6;
    --c-text-muted: #8e95a5;
    --c-text-faint: #5b6272;

    /* Semantic (retention) */
    --c-hot: #00f5d4;
    --c-warm: #f59e0b;
    --c-crypt: #ff2a5f;
    --c-hot-dim: color-mix(in oklab, var(--c-hot) 22%, transparent);
    --c-warm-dim: color-mix(in oklab, var(--c-warm) 22%, transparent);
    --c-crypt-dim: color-mix(in oklab, var(--c-crypt) 22%, transparent);

    /* Interactive */
    --c-focus: #7dd3fc;
    --c-accent: var(--c-hot);

    /* Typography */
    --f-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
    --f-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;

    --t-2xs: 0.6875rem;  /* 11 */
    --t-xs: 0.75rem;     /* 12 */
    --t-sm: 0.8125rem;   /* 13 */
    --t-md: 0.9375rem;   /* 15 */
    --t-lg: 1.125rem;    /* 18 */
    --t-xl: 1.5rem;      /* 24 */
    --t-2xl: 2rem;       /* 32 */
    --t-hero: 3.25rem;   /* 52, telemetry number */

    --lh-tight: 1.1;
    --lh-snug: 1.3;
    --lh-body: 1.5;

    --tr-heading: -0.02em;
    --tr-body: -0.005em;
    --tr-caps: 0.08em;

    /* Spacing (4px base) */
    --sp-1: 0.25rem; --sp-2: 0.5rem; --sp-3: 0.75rem; --sp-4: 1rem;
    --sp-5: 1.25rem; --sp-6: 1.5rem; --sp-8: 2rem; --sp-10: 2.5rem; --sp-12: 3rem;

    /* Radii */
    --r-sm: 6px; --r-md: 10px; --r-lg: 16px; --r-xl: 22px; --r-pill: 999px;

    /* Elevation / glow */
    --sh-tile: 0 1px 0 var(--c-highlight) inset, 0 20px 40px -24px rgb(0 0 0 / 0.8);
    --sh-glow-hot: 0 0 0 1px color-mix(in oklab, var(--c-hot) 40%, transparent), 0 0 24px -4px color-mix(in oklab, var(--c-hot) 55%, transparent);
    --sh-glow-warm: 0 0 0 1px color-mix(in oklab, var(--c-warm) 35%, transparent), 0 0 18px -6px color-mix(in oklab, var(--c-warm) 45%, transparent);
    --sh-glow-crypt: 0 0 0 1px color-mix(in oklab, var(--c-crypt) 45%, transparent), 0 0 28px -4px color-mix(in oklab, var(--c-crypt) 55%, transparent);

    /* Motion */
    --e-out: cubic-bezier(0.16, 1, 0.3, 1);
    --e-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --d-fast: 120ms; --d-base: 220ms; --d-slow: 480ms; --d-epic: 900ms;

    /* Layout */
    --gap: var(--sp-3);
    --pad-tile: var(--sp-4);
    --z-canvas: 0; --z-tile: 10; --z-drawer: 30; --z-toast: 50;
  }

  @media (prefers-reduced-motion: reduce) {
    :root { --d-fast: 0ms; --d-base: 0ms; --d-slow: 0ms; --d-epic: 0ms; }
  }
}
```

## 3. Typography

| Role | Font | Size | Weight | Tracking | Notes |
|---|---|---|---|---|---|
| Display / telemetry hero | Geist Mono | `--t-hero` | 500 | `-0.03em` | `font-variant-numeric: tabular-nums` |
| H1 (app title) | Geist Sans | `--t-xl` | 600 | `--tr-heading` | wordmark "Lethe" with lowercase tail `·` accent |
| Tile title | Geist Sans | `--t-xs` | 500 | `--tr-caps` | uppercase, `--c-text-muted` |
| Body | Geist Sans | `--t-sm`–`--t-md` | 400 | `--tr-body` | `text-wrap: pretty` |
| Rule text / markdown | Geist Mono | `--t-xs` | 400 | 0 | `line-height: 1.55` |
| Metrics, ids, formulas | Geist Mono | `--t-2xs`–`--t-sm` | 400–500 | 0 | `tabular-nums slashed-zero` |

Rules:
- `font-feature-settings: "ss01", "cv11"` on sans only if Geist build supports it; otherwise omit.
- Headings `text-wrap: balance`. Max measure 64ch for prose.
- Numbers that change: `font-variant-numeric: tabular-nums;` always, plus fixed `min-width` in `ch` to prevent layout shift.
- Never use font weights below 400 on dark backgrounds.

## 4. Color & Contrast

| Pair | Approx. contrast | Use |
|---|---|---|
| `--c-text` on `--c-surface` | > 15:1 | primary text |
| `--c-text-muted` on `--c-surface` | ~6:1 | secondary text |
| `--c-text-faint` on `--c-surface` | ~3:1 | decorative/tertiary only, never essential text |
| `--c-hot` on `--c-surface` | > 12:1 | numbers, active states |
| `--c-warm` on `--c-surface` | ~9:1 | warnings |
| `--c-crypt` on `--c-surface` | ~5:1 | alerts (≥ 14px/600 or non-text) |

Contrast values are estimates — verify with a script in CI (`scripts/contrast.ts`) and fail the build if text pairs fall below WCAG AA (4.5:1; 3:1 for large text and UI components). **Never encode state by color alone**: pair with icon, label, or shape (Hot = filled disc, Warm = half disc, Crypt = cross/tombstone glyph).

## 5. Bento Grid — Single Viewport

```css
.studio {
  display: grid;
  height: 100dvh;
  padding: var(--gap);
  gap: var(--gap);
  background: var(--c-void);
  grid-template-columns: minmax(0, 8fr) minmax(320px, 4fr);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 1.2fr) auto;
  grid-template-areas:
    "top     top"
    "canvas  telemetry"
    "canvas  seance"
    "dock    dock";
}
@container (max-width: 1023px) { /* or media query fallback */ }

@media (max-width: 1023px) {
  .studio {
    height: auto; min-height: 100dvh;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    grid-template-areas: "top" "telemetry" "canvas" "seance" "dock";
  }
  .canvas { min-height: 56dvh; }
}
```

Tiles:

| Area | Contents | Notes |
|---|---|---|
| `top` | Wordmark, "Sandbox" badge, tour button, repo link | height 48px, no tile background |
| `canvas` | React Flow spatial canvas | `border-radius: --r-xl`, dotted background grid |
| `telemetry` | Hot tokens vs budget, % saved, retention sparkline, tier counts | hero number 52px |
| `seance` | Contradiction diff, **Verify & Exorcise**, PBT run console | scrolls internally |
| `dock` | Scrubber, **Run REM Sleep**, **Reset**, Crypt drawer toggle | 88px tall |

Crypt drawer: slides over the right column (`--z-drawer`), 360px wide, lists tombstones.

## 6. Tile Recipe (Glass)

```css
.tile {
  position: relative;
  background:
    linear-gradient(180deg, var(--c-highlight), transparent 38%),
    var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-tile);
  padding: var(--pad-tile);
  overflow: clip;
}
.tile::after { /* specular edge */
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(120% 60% at 50% -20%, rgb(255 255 255 / 0.06), transparent 60%);
}
.tileTitle {
  font: 500 var(--t-xs)/1 var(--f-sans);
  letter-spacing: var(--tr-caps); text-transform: uppercase; color: var(--c-text-muted);
}
```
`backdrop-filter: blur()` is used **only** on the Crypt drawer and tour overlay (performance on the canvas).

## 7. Spatial Canvas

- Background: dotted grid, `radial-gradient(circle, rgb(255 255 255 / 0.06) 1px, transparent 1px)` at 24px.
- Three concentric zone rings drawn as SVG circles around the center: radius `r_hot = 0.28·min(w,h)`, `r_warm = 0.5·`, `r_crypt = 0.72·`. Rings use `--c-border` with zone labels in `--t-2xs` caps.
- **Radial position from retention:** `radius = lerp(r_crypt, r_core, R)` where `R=1` sits near center; angle derived from stable hash of `id` (so nodes don't jump between frames), with minimal collision relaxation (≤ 8 iterations, pure function).
- Spec nodes: hexagon chips pinned on an inner orbit, glowing `--c-focus`.
- **Edges:** engram → spec links as quadratic Béziers, `stroke: color-mix(in oklab, var(--c-focus) 45%, transparent)`, `stroke-width: 1.25`, animated dash flow only on hover/selection. Contradiction edges: crimson, dashed, pulsing at 1.2 s.
- Controls: zoom/pan enabled; `fitView` on load and after Reset; minimap off (clutter).

### React Flow custom node: `EngramCard`

| Property | Spec |
|---|---|
| Size | 168×64 px (compact), expands to 280×120 on selection |
| Content | Tier glyph, title (heading path last segment, 1 line, ellipsis), `R 0.84` mono, `118 tok` mono |
| Border | 1px `--c-border`, becomes tier glow (`--sh-glow-*`) |
| Opacity | `0.35 + 0.65·R` (never below 0.35 so it stays legible) |
| Retention bar | 2px bottom bar width `R*100%`, colored by tier |
| Handles | Hidden visually; connectable none; used only for edge anchors |
| Selected | `--c-border-strong`, scale 1.04 via transform, shows body preview (max 6 lines) |
| Defeated | crimson strikethrough on title + cross glyph; pulses once |
| Protected | small pin glyph top-right |

`SpecNode`: 120×40 hex chip, `--c-focus` outline, label `spec:lethe-core`.
`TombNode` (only in Crypt ring): muted slate card with a tombstone silhouette glyph (inline SVG) and `†` + commit number.

## 8. Telemetry Tile

- Hero: `1,150 / 4,000` in Geist Mono 52px; sub-label "Hot-tier tokens per prompt".
- Delta chip: `−76%` pill in `--c-hot` on `--c-hot-dim`.
- Sparkline: 120×32 SVG polyline of `R` percentile bands over scrubbed commits; no axis, endpoints labeled.
- Tier counts: three small stat rows with tier glyphs.
- Live region: announce only on settle (debounce 400 ms) via `aria-live="polite"`.

## 9. Séance Tile (Contradictions)

- List of conflicts; selected one shows two stacked "rule cards" with the **evidence span highlighted** (`--c-crypt-dim` background).
- Primary button **Verify & Exorcise**: pill, crimson outline, fills on hover. On click, show a console block (Geist Mono 12px):
  `fc.assert › P5 contradiction exclusion · seed 4821907 · 200/200 ✓`
  Progress bar updates in rAF batches; on pass, the loser card collapses toward the Crypt ring (see motion).
- Failure state is first-class: red console line with shrunk counterexample.

## 10. Dock

- Scrubber: custom range input, 6px track, thumb 20px circle with `--sh-glow-hot`; tick marks every 25 commits; value label `+62 commits · ~15 days`.
- Keyboard: `←/→` ±1, `Shift+←/→` ±10, `Home/End` min/max.
- **Run REM Sleep** button: primary (filled `--c-text` on `--c-void`), 44px high, shows `⌘↵` hint on desktop.
- Reset: ghost button.

## 11. Motion (Motion / Framer Motion)

```ts
export const spring = {
  ui:     { type: "spring", stiffness: 300, damping: 28, mass: 1 },      // default
  soft:   { type: "spring", stiffness: 180, damping: 24, mass: 1 },      // node drifting with scrub
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.8 },    // buttons, chips
  burial: { type: "spring", stiffness: 120, damping: 20, mass: 1.4 },    // heavy settle into crypt
} as const;
export const dur = { fast: 0.12, base: 0.22, slow: 0.48, epic: 0.9 } as const;
```

Choreography:

| Event | Motion |
|---|---|
| Scrub | Nodes `animate` to new radius with `spring.soft`; opacity and glow cross-fade `dur.base` |
| Contradiction appears | Crimson edge draws on (`pathLength 0→1`, `dur.slow`), nodes shake 2px×3 once |
| Exorcise | Loser card fades to 0.6, translates toward Crypt ring with `spring.burial`, tombstone glyph fades in; telemetry number counts down using `tween dur.slow e-out` |
| REM Sleep | Canvas dims to 0.85 brightness 300ms; duplicates visibly merge (two nodes slide together then one fades); archived nodes stream outward in 40ms stagger; telemetry counts down |
| Resurrect | Tombstone glows hot, flies back to its zone with `spring.ui`, heartbeat pulse once |
| Tile enter | `y: 8, opacity 0 → 1`, `spring.ui`, stagger 50ms |

Constraints: animate transform/opacity only; ≤ 60 concurrently animating nodes (use `layout` sparingly; drive radius via motion values); when `prefers-reduced-motion`, replace all with instant state changes and a brief outline flash (non-motion).

## 12. Iconography & Glyphs
Inline SVG, 1.5px stroke, 16/20px grid, `currentColor`. Required: disc (hot), half-disc (warm), cross-tombstone (crypt), pin, spec-hex, play/tour, reset, close. No icon fonts.

## 13. States & Copy Tone
- Voice: precise, dry, slightly literary. "Buried at commit 112." "Retention 0.18 — below threshold." Avoid puns in functional UI; reserve flavor for empty states and tour captions.
- Empty states: "The crypt is empty. Nothing has been forgotten yet."
- Always show units: tok, commits, days.

## 14. Responsive & QA Checklist
- Verify at 1440×900, 1280×720, 1024×768, 390×844.
- Mobile: telemetry first, canvas becomes pan/zoom with tap-to-select, séance below, dock sticky bottom.
- Focus ring: `outline: 2px solid var(--c-focus); outline-offset: 2px;` on every interactive element.
- Lighthouse a11y ≥ 95, no layout shift on scrub (CLS < 0.02).
- Screenshot set for README and video thumbnail captured at the end of Phase 4.
