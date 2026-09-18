# Phase 1: UI Shell and Loop Capture

> Status: complete · Tasks: T1-T9 · See [tasks/todo.md](../tasks/todo.md) for acceptance
> criteria and verification detail per task.

## What shipped

A working, deployable static app with no model in it yet:

- Vite + TypeScript strict + Vitest + ESLint + Prettier behind a single `npm run check`
  gate (T1).
- Light/dark theme system: CSS custom properties on `:root`, OS preference by default,
  manual override persisted to `localStorage`, applied before first paint via an inline
  head script (T2).
- Responsive two-panel layout — source stage and result panel — with semantic landmarks
  and a real `npm run a11y` gate (axe + horizontal-overflow check, 6 configurations) (T3).
- Two-canvas stage: a detached source canvas the model will eventually read, and a
  separate overlay canvas for the stroke. Image loading via file input, drag-and-drop,
  and clipboard paste, with the 2048px longest-edge cap and DPR-aware backing stores (T4).
- Pure polygon geometry: `boundingBox`, `signedArea`, `polygonCentroid`, `containsPoint`,
  and a `poleOfInaccessibility` implementation (Mapbox's `polylabel` approach) for when a
  concave loop's centroid falls outside the shape (T5).
- Loop-to-SAM-prompt conversion: bounding box, a foreground anchor with spread interior
  samples, and an optional background point, all guaranteed inside/outside the polygon as
  appropriate (T6).
- Freehand stroke overlay: pointer capture, a halo-plus-pen-colour double stroke, a
  5-hue palette, undo/clear (T7).
- Debug visualization wiring loop completion straight to the derived prompt, rendered on
  the overlay behind a toggle (T8).
- A design pass that found and fixed a real bug, not just cosmetics (T9, detailed below).

**Everything in `src/lib/**` is a pure function over plain data** — no DOM, no canvas, no
model. 88 tests, and every module in that tree drops out of the coverage report entirely
once every branch is covered (the v8 reporter's way of saying 100%).

## Key decisions

**Contrast is computed, not eyeballed.** The spec called for a theme-tied stroke halo
(dark in light mode, light in dark mode). That halo only contrasts with *one* extreme at
a time — a dark halo does nothing against a pure-black region of a photo, a light halo
does nothing against pure white. On whichever extreme the halo can't help with, the pen
hue alone carries legibility. Computing actual WCAG contrast ratios for all 5 palette
hues against pure black and pure white (not eyeballing one screenshot with a red loop on
it) found the original amber at only 2.08:1 against white — invisible in dark mode over a
bright region. Replaced with a burnt sienna (4.84:1 / 4.34:1) and locked the property in
with a permanent test (`stroke.test.ts`) so a future palette change can't reintroduce it.
See [src/lib/geometry/stroke.ts](../src/lib/geometry/stroke.ts).

**Degenerate loops are a `Result`, not a thrown error.** A 2-point loop, an all-collinear
stroke, or a near-zero-area sliver are expected outcomes a UI needs to react to, not
programmer error. `loopToSamPrompt` returns `Result<SamPrompt, PromptError>` rather than
throwing, following the pattern in `src/lib/result.ts`.

**`poleOfInaccessibility` exists because a hand-drawn loop is routinely concave.** The
vertex-average centroid of a C-shape or an L-shape frequently lands outside the shape
entirely (proven directly in `loop.test.ts`, not just asserted). A SAM foreground point
placed outside the loop it was meant to describe would silently produce a wrong mask, so
this isn't a nice-to-have.

**A design pass surfaced a real bug, which is the point of doing one on a working build
instead of only at pixel-pushing time.** `.stage-toolbar { display: flex }` and the
browser's native `[hidden] { display: none }` have identical CSS specificity; mine won by
source order and silently defeated `hidden`, so the toolbar was visible before any image
had loaded. Caught by screenshotting a genuinely fresh session rather than trusting that
JS state implied correct rendering. Fixed with a defensive `[hidden] { display: none
!important; }` reset in `app.css`, and verified `true` in a fresh browser context
afterward, not just visually.

**`/minimalist-ui` and `/design-taste-frontend` were applied selectively.** Both are
calibrated for marketing pages and portfolios; `/design-taste-frontend` explicitly lists
dense product UI as out of scope. SnapVector is a canvas tool, so heroes, bento grids,
GSAP scroll effects, and logo walls were skipped. What transferred: contrast discipline,
color/shape consistency, an em-dash audit on the 4 genuinely user-visible copy strings,
and toning down the debug toggle (a developer aid, not a real feature) so it doesn't
visually compete with actual controls.

## Trade-offs and deferred items

- **Toolchain versions deviate from the original spec table**: TypeScript 6.0.3 rather
  than 7, because `typescript-eslint@8.70.0` peers `typescript <6.1.0` and typed linting
  matters more here than being first onto the native compiler. Vitest 5 works cleanly
  after the Node upgrade to 24 LTS; it briefly crashed npm 10.9.2's peer resolver on the
  original Node 23 (non-LTS) toolchain. SPEC.md is updated to match reality.
- **Playwright was added as a dev dependency**, not in the original tool list, to get
  real browser verification per phase since `chrome-devtools` MCP isn't configured in
  this session. Its browsers were already cached on this machine.
- **The canvas has no keyboard-accessible drawing path yet.** SPEC §9.14 requires either
  one or an explicit, labeled limitation; T30 (Phase 4) is where that decision gets made
  and implemented, not deferred silently.
- **The "Prompt debug" toggle is a Phase 1 development aid**, not a planned permanent
  feature. Whether it survives to Phase 4 polish, gets removed, or gets hidden behind a
  build flag is an open call for that phase.

## Verification

- `npm run check`: typecheck, lint, 88 tests — clean.
- `npm run build`: 11.26 kB JS / 4.47 kB gzipped, 7.26 kB CSS.
- `npm run a11y`: 0 axe violations, 0px horizontal overflow at 360/768/1440px, both
  themes (6 configurations).
- Manual browser verification via Playwright for every task: file upload (all 3 paths),
  a 4000px image correctly downscaled, a corrupt/renamed file's error path, drag-and-drop,
  window-resize re-layout, the full stroke-to-prompt pipeline on a concave C-shape and on
  a loop crossing the canvas edge, palette contrast across all 5 hues against both pure
  black and pure white, and keyboard tab order through all 6 toolbar controls.
