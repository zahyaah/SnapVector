# Phase 4: Polish and Ship

> Status: complete · Tasks: T28-T33 · See [tasks/todo.md](../tasks/todo.md) for acceptance
> criteria and verification detail per task.

## What shipped

The app went from "works in a real browser, verified end to end" (Phase 3's bar) to
"ships": honest loading/error states, real touch support, a documented accessibility
posture, a visual consistency pass, a repo-wide simplification review, a public README,
and a live deployment.

- Loading, progress, and error states audited against real network conditions, not
  assumed correct (T28).
- Mobile touch and a 44px touch-target audit (T29).
- A full accessibility pass, including the canvas keyboard-alternative decision SPEC
  §9.14 had left open since the approval gate (T30).
- A final visual consistency pass across both themes and three widths (T31).
- A repo-wide code review and simplification pass (T32).
- README, deployment, and this document (T33).

## Key decisions and findings

**Two real, previously-invisible bugs were found by testing the failure paths, not by
reading the code.** T28's job was to verify loading and error states, so the obvious
move was to actually trigger the failure states in a real browser rather than trust
that the existing try/catch blocks were correct:

- Drawing a loop while the model had genuinely failed to load (not just still loading)
  showed "Still preparing the model, try drawing again in a moment", actively wrong
  advice, since no amount of waiting would fix a permanent failure. Fixed by tracking
  an explicit `modelLoadState` so the message matches reality.
- A connection dropping *after* the response headers arrived but *during* the model
  weight download (a real "fail mid-download" scenario, not a hypothetical) was
  completely unhandled: `fetchModelWeights`'s streamed-read loop had no `try/catch`
  around `reader.read()`, so the rejection propagated uncaught past the function's own
  `Result`-returning contract. In the app this would have meant a permanently stuck
  loading state with no error message and no working retry, exactly the failure mode
  T28 exists to prevent. Reproduced directly with a mocked `fetch` whose reader
  succeeds once then throws, fixed, and guarded with 4 new tests (`model-cache.ts` had
  zero tests before this).

**Real-browser measurement caught what a code read would have missed twice more.** T29
found that only the theme toggle met the 44px touch-target minimum, the other six
interactive controls measured 36-40px tall in a real rendered mobile viewport, not
obvious from the CSS alone without actually measuring `getBoundingClientRect()`. T30's
accessibility pass extended the existing `scripts/a11y.mjs` to scan the app's "loaded"
state (toolbar visible) as well as its empty state, since axe silently skips `[hidden]`
content, meaning the toolbar's own buttons had never actually been scanned before that
change.

**The canvas keyboard question (open since the SPEC approval gate) was resolved as an
explicit, labeled limitation, not a keyboard-equivalent interaction.** A freehand loop
is inherently a pointing-device gesture; an arrow-key polygon-placement mode would be a
materially different, worse way to perform the actual task, not real parity. SPEC's own
acceptance criterion treats a documented limitation as an equally valid resolution to a
keyboard alternative, not a lesser one, so the decision was to say so plainly, in a
visible note shown to every visitor (not screen-reader-only text), rather than build a
token gesture that would perform badly on the one thing the app exists to do. Recorded
in [SPEC.md](../SPEC.md) §10.

**The repo-wide review (T32) found real duplication a diff-scoped review never would
have.** Reviewing the whole codebase at once, rather than one task's diff at a time,
surfaced four separate hand-written `Point` interfaces and two `Size` interfaces across
different modules (`geometry/loop.ts`, `geometry/viewport.ts`, `mask/postprocess.ts`,
`svg/pipeline.ts`, `sam/preprocess.ts`), each written independently as each module was
built, none of them ever colliding or causing a bug (TypeScript's structural typing
made them silently interchangeable), but real duplication all the same. Consolidated to
their canonical source. The same pass found 8 hand-rolled
`Math.min(Math.max(...))`-style clamp expressions across 4 files, extracted to one
`clamp()` helper. Neither would have been visible reviewing any single task's changes
in isolation, since each individual instance looked like reasonable, self-contained
code, the pattern only became visible at repo scale.

**A working, tested, SPEC-mentioned feature was deliberately deleted.** T24's k-means
palette (`sampleKMeansPalette`) was fully built, fully tested, and satisfied SPEC's
"optional k-means palette" acceptance criterion, but was never wired into the actual
SVG export; v1 always shipped a single average-color fill. T32's review flagged this as
dead code, zero production callers, and rather than resolve that unilaterally, it was
put to the user as an explicit three-way choice: remove it, keep it as a documented
future building block, or actually wire it in now. The decision was to remove it, on
the reasoning that unused-but-tested code is still a maintenance liability and a future
reader's first assumption ("why does this exist and go nowhere?") is a fair one to
avoid; it remains fully recoverable from git history if multi-color fill is ever built
for real.

**The deploy target changed mid-task, and the change was treated as a real decision,
not a formality.** SPEC named GitHub Pages from the approval gate onward. Mid-T33, the
user said the actual plan was Vercel. Since GitHub Pages needs either a public repo or
a paid plan, and the repo was private, making it public had already been confirmed with
the user as a separate, deliberate step (it also matches the project's own $0-cost
constraint and its "OpenSourced" intent) before the target changed again. Both the repo
visibility question and the deploy-target switch were surfaced as explicit choices
rather than assumed, since both are the kind of decision that is genuinely the user's
to make, not a technical detail to default silently. See SPEC.md's Standing Assumptions
for the full record, including a flagged-but-not-acted-on side effect: Vercel, unlike
GitHub Pages, can set custom response headers, which reopens (but does not reopen
unilaterally) the COOP/COEP question ADR-0006 closed partly because GitHub Pages
couldn't set them.

## Trade-offs and deferred items

- **No VoiceOver or other real screen-reader spot-check was performed** (T30) — no
  interactive assistive-technology session was available in this environment.
  Mitigated with axe's automated ARIA/live-region/contrast rules plus a direct
  behavioral check that live-region text actually changes at the right moments, a
  reasonable substitute, not a full replacement.
- **The COOP/COEP main-thread-blocking question is now reopenable** (Vercel can set
  the headers GitHub Pages couldn't) but was deliberately not reopened as part of this
  deploy-target change. ADR-0006's original trade-off (accept the ~3.4s encoder block
  for v1) still stands until someone deliberately revisits it.
- **No custom domain.** The live site is `snapvector.vercel.app`, the project's default
  Vercel-provided domain, claimed directly since it was available. No DNS or custom
  domain configuration was needed or attempted.

## Verification

- `npm run check`: typecheck, lint, 249 tests, clean, coverage 97.35%/94.93%/95.68%/97.71%
  on `src/lib/**` (statements/branches/functions/lines), above the 90%/85% thresholds.
- `npm run a11y`: 0 axe violations, 0px horizontal overflow across empty and loaded
  states, both themes, three widths (12 configurations).
- Real end-to-end verification against the actual live deployment
  (`https://snapvector.vercel.app`), not just the local build: a fresh, uncached
  browser context, a real ~44 MB model download from the live host, a real drawn loop,
  real segmentation at 99% confidence, and a real sanitized-filename SVG download, with
  zero console or page errors.
- Repo-wide secret/credential scan before making the repository public; confirmed
  `.vercel` and `.env*` are gitignored (added automatically by `vercel link`) and
  neither is tracked.
