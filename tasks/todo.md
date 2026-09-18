# SnapVector — Task List

> Plan: [plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)
> Definition of Done for every task: `npm run check` passes, one atomic commit, no `any`
> without a comment naming the type gap, no test skipped or deleted to go green.

---

## Phase 1 — Foundation and loop capture

### T1: Scaffold the toolchain ✅

**Description:** Vite + TypeScript strict + Vitest + ESLint + Prettier, wired into a single `npm run check` gate.
**Acceptance:**

- [x] `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- [x] `npm run check` runs typecheck, lint, and tests in sequence and exits non-zero on any failure (verified: exit 2 with a type error, exit 0 clean)
- [x] One placeholder test passes, proving the runner works (`src/lib/version.test.ts`, replaced at T5)
      **Verify:** `npm run check` clean · `npm run dev` serves a page · `npm run build` emits to `dist/`
      **Dependencies:** None · **Scope:** S
      **Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `index.html`

### T2: Brand tokens and theme system ✅

**Description:** Define the SnapVector visual identity as CSS custom properties, and the light/dark resolution that defaults to OS preference with a manual override persisted in localStorage. Apply `/brandkit` art direction as code (SVG wordmark, restrained palette, type scale) — no generated imagery.
**Acceptance:**

- [x] Every colour, space, radius, and type step is a token on `:root`, redefined under `prefers-color-scheme: dark` and overridable by a `data-theme` attribute
- [x] Theme resolves OS → stored override → toggle, with no flash of wrong theme on load (verified: `data-theme=light` present at DOMContentLoaded with OS dark + stored light)
- [x] Toggle is a real `<button>` with `aria-pressed`, keyboard operable (verified: first Tab focuses it, Enter activates, choice survives reload)
      **Verify:** `npm run check` · browser: toggle both ways, reload, change OS theme with no override stored
      **Dependencies:** T1 · **Scope:** M
      **Files:** `src/styles/tokens.css`, `src/ui/theme.ts`, `src/ui/theme.test.ts`, `index.html`

### T3: App layout shell ✅

**Description:** Header, stage region, controls, and result panel placeholder. Responsive from 360px up. Semantic landmarks throughout.
**Acceptance:**

- [x] Layout holds at 360px, 768px, and 1440px with no horizontal scroll (verified: `npm run a11y` — overflow=0 at all three widths, both themes)
- [x] `header`/`main`/`aside` landmarks present; heading order is sequential (verified: h1 → h2 → h2)
- [x] Generous whitespace, no shadows or gradients (SPEC §1, `/minimalist-ui`)
  **Verify:** `npm run check` · browser at three widths · axe scan reports no violations
      **Dependencies:** T2 · **Scope:** M
      **Files:** `index.html`, `src/styles/app.css`, `src/main.ts`

### T4: Two-canvas stage and image loading

**Description:** Source-image canvas and a transparent overlay canvas, exactly aligned, DPR-aware. Load images via file input, drag-and-drop, and paste.
**Acceptance:**

- [ ] Two separate canvas elements; the overlay is never drawn into the source canvas (SPEC §8 Always)
- [ ] PNG, JPEG, and WebP load and render fit-to-stage, longest side capped at 2048
- [ ] Both canvases scale with `devicePixelRatio`; the loop coordinates map back to source-image pixels correctly
- [ ] Non-image or corrupt files produce a visible, actionable error
      **Verify:** `npm run check` · browser: all three input paths, a portrait image, a landscape image, a 4000px image, a `.txt` renamed to `.png`
      **Dependencies:** T3 · **Scope:** M
      **Files:** `src/ui/stage.ts`, `src/ui/controls.ts`, `src/ui/stage.test.ts`, `src/styles/app.css`

### T5: Polygon geometry primitives — TDD

**Description:** Pure polygon operations with no DOM dependency. **Tests written first.**
**Acceptance:**

- [ ] `boundingBox`, `signedArea`, `polygonCentroid`, `containsPoint`, `poleOfInaccessibility`
- [ ] Degenerate inputs covered: empty, single point, two points, all-collinear, self-intersecting
- [ ] `containsPoint` correct for concave polygons and for points exactly on an edge
      **Verify:** `npx vitest run src/lib/geometry/loop.test.ts` · 100% branch coverage on this module
      **Dependencies:** T1 · **Scope:** S
      **Files:** `src/lib/geometry/loop.ts`, `src/lib/geometry/loop.test.ts`, `src/lib/geometry/types.ts`

### T6: Loop → SAM prompt conversion — TDD

**Description:** Turn a hand-drawn loop into a SAM prompt: bounding box, a foreground anchor, spread interior points, one background point. **Tests written first.** This is the module SPEC §7 names first for a reason — a prompt point landing outside the shape silently ruins the mask.
**Acceptance:**

- [ ] Every returned foreground point is inside the polygon, verified for concave and C-shaped loops where the centroid falls outside
- [ ] Returns a bbox and at least 3 points for any non-degenerate loop
- [ ] The background point is outside the loop but inside the image bounds
- [ ] Loops extending past the canvas edge are clamped, not rejected
      **Verify:** `npx vitest run src/lib/geometry/prompt.test.ts` · property test: 500 random loops, no foreground point ever outside
      **Dependencies:** T5 · **Scope:** S
      **Files:** `src/lib/geometry/prompt.ts`, `src/lib/geometry/prompt.test.ts`

### T7: Freehand stroke overlay with halo and palette

**Description:** Pointer capture on the overlay canvas producing a closed loop, rendered as a coloured line with a contrasting halo. Five-hue pen palette; halo inverts with theme.
**Acceptance:**

- [ ] Stroke is legible over pure white, pure black, and mid-grey image regions in both themes
- [ ] Halo is dark in light mode and light in dark mode; palette cycles 5 hues
- [ ] Loop auto-closes on pointer release; clear and undo available
- [ ] Nothing is ever drawn into the source canvas
      **Verify:** `npm run check` · browser: draw over a black/white/grey test image in both themes, all 5 hues
      **Dependencies:** T4, T5 · **Scope:** M
      **Files:** `src/ui/stroke-overlay.ts`, `src/ui/stroke-overlay.test.ts`, `src/styles/app.css`

### T8: Wire loop completion to prompt, with debug visualization

**Description:** On loop close, derive the SAM prompt and draw the bbox and points on the overlay behind a debug flag. **This is the Phase 1 end-to-end proof** — the full input path works before any model exists.
**Acceptance:**

- [ ] Closing a loop renders its bbox and prompt points in the correct positions
- [ ] Points visibly sit inside the drawn loop, including for a deliberately C-shaped loop
- [ ] Debug overlay is off by default and toggleable
      **Verify:** `npm run check` · browser: draw a blob, a C-shape, and a loop crossing the image edge
      **Dependencies:** T6, T7 · **Scope:** S
      **Files:** `src/main.ts`, `src/ui/stroke-overlay.ts`

### T9: Phase 1 design pass

**Description:** Apply `/minimalist-ui` and `/design-taste-frontend` to the shell. Nothing that reads as a templated AI layout.
**Acceptance:**

- [ ] Type scale, spacing rhythm, and colour use are consistent and deliberate in both themes
- [ ] Focus states are visible and styled, not browser defaults
- [ ] No decorative shadow or gradient survives
      **Verify:** browser at three widths, both themes · keyboard-only tab through every control
      **Dependencies:** T8 · **Scope:** M
      **Files:** `src/styles/tokens.css`, `src/styles/app.css`

### ✅ Checkpoint: Phase 1

- [ ] `npm run check` clean; `npm run build` succeeds
- [ ] Browser-verified via `/browser-testing-with-devtools`: upload → draw → prompt points render
- [ ] `docs/phase-01.md` written (what was built, decisions, trade-offs)
- [ ] **Human review before Phase 2**

### T10: Phase 1 documentation

**Description:** `docs/phase-01.md` per `/documentation-and-adrs`.
**Acceptance:** [ ] Covers what shipped, decisions made during the phase, and what was deferred
**Verify:** reads correctly against the actual diff · **Dependencies:** T9 · **Scope:** S
**Files:** `docs/phase-01.md`

---

## Phase 2 — MobileSAM in the browser

### T11: Pin the MobileSAM ONNX export — research only, no code

**Description:** Identify the exact published encoder and decoder artifacts and record their **real** input/output tensor names, shapes, and dtypes, verified against the files themselves. Highest-risk unknown in the project, deliberately front-loaded (`/source-driven-development`).
**Acceptance:**

- [ ] Encoder and decoder URLs pinned to an explicit revision, not a branch
- [ ] Actual tensor signature recorded in `docs/model-signature.md` — not assumed from memory or from a blog post
- [ ] File sizes and available quantizations noted
- [ ] CORS headers confirmed to permit browser fetch from our origin
      **Verify:** `curl -I` each URL · inspect the ONNX graph and confirm the recorded signature
      **Dependencies:** None · **Scope:** S
      **Files:** `docs/model-signature.md`

### T12: Image preprocessing and coordinate mapping — TDD

**Description:** Source image → letterboxed 1024×1024 normalized NCHW tensor, plus the forward and inverse coordinate transforms. **Tests written first** — the inverse transform is where an off-by-one silently misplaces every prompt point.
**Acceptance:**

- [ ] `imageToTensor` produces the exact shape and normalization the T11 signature specifies
- [ ] `toModelSpace` / `toImageSpace` round-trip within 0.5px for portrait, landscape, and square inputs
- [ ] Letterbox padding is correct for extreme aspect ratios (10:1, 1:10)
      **Verify:** `npx vitest run src/lib/sam/preprocess.test.ts` · round-trip property test over random points and sizes
      **Dependencies:** T11 · **Scope:** S
      **Files:** `src/lib/sam/preprocess.ts`, `src/lib/sam/preprocess.test.ts`

### T13: ONNX session, CDN fetch, and Cache API persistence

**Description:** Lazy ORT Web session creation, weights fetched from the pinned CDN URLs with determinate progress, persisted in the Cache API. Failure is a typed result, not a throw.
**Acceptance:**

- [ ] Model load starts after first paint and never blocks it
- [ ] Progress is determinate, read from `Content-Length` via a streamed body
- [ ] Second load resolves from the Cache API with no network request
- [ ] Fetch failure returns a typed error the UI can act on; the app stays usable without the model
- [ ] `lib/sam/` is dynamically imported so ORT sits outside the initial chunk
      **Verify:** `npm run build && npm run preview` — **not dev-server only**, per the plan's ORT asset-path risk · DevTools: throttle to Fast 3G, confirm progress; reload, confirm cache hit; block the CDN, confirm the error path
      **Dependencies:** T11 · **Scope:** M
      **Files:** `src/lib/sam/session.ts`, `src/lib/sam/session.test.ts`, `vite.config.ts`

### T14: Decoder invocation and mask extraction — TDD

**Description:** Prompt points in model space → decoder inputs → logits → binary mask at source resolution. Tested against fixture tensors; the real model is never loaded in unit tests.
**Acceptance:**

- [ ] Prompt encoding matches the T11 signature exactly (point coords, labels, mask input, `has_mask_input`)
- [ ] Logits threshold to a binary mask and resample to source dimensions
- [ ] Encoder embedding is cached per image, so a redrawn loop re-runs only the decoder
      **Verify:** `npx vitest run src/lib/sam/decode.test.ts` against fixture tensors · browser: redraw a loop and confirm the encoder does not re-run
      **Dependencies:** T12, T13 · **Scope:** M
      **Files:** `src/lib/sam/decode.ts`, `src/lib/sam/decode.test.ts`, `src/lib/sam/fixtures/`

### T15: Live mask preview

**Description:** Run the encoder on image load and the decoder on loop completion; render the mask as a translucent overlay with loading states throughout.
**Acceptance:**

- [ ] Drawing a loop over a clearly-separated subject produces a visibly correct mask
- [ ] Encoder and decoder each have a distinct, honest loading state
- [ ] Redrawing updates the preview without re-running the encoder
      **Verify:** `npm run check` · browser: three fixture images, several loops each
      **Dependencies:** T14 · **Scope:** M
      **Files:** `src/main.ts`, `src/ui/status.ts`, `src/ui/stage.ts`

### T16: Performance checkpoint

**Description:** `/performance-optimization` audit. Measure, then decide quantization on evidence rather than in advance.
**Acceptance:**

- [ ] FCP < 1.5s and interactive-before-model-ready confirmed under Fast 3G
- [ ] Initial JS chunk < 150 KB gzipped, excluding model weights and ORT WASM
- [ ] Encoder < 3s and decoder < 200ms measured on 1024×1024
- [ ] fp32 vs int8 encoder decided against measured load time and fixture mask quality; recorded as an ADR
- [ ] Main-thread jank assessed; Web Worker decision made and recorded
      **Verify:** Lighthouse on the built preview · `performance.measure` around encoder/decoder · bundle analysis
      **Dependencies:** T15 · **Scope:** M
      **Files:** `vite.config.ts`, `src/lib/sam/*`, `docs/adr/0006-*.md`

### ✅ Checkpoint: Phase 2

- [ ] Mask preview works in a real browser on the fixture set
- [ ] Performance budget met, or consciously renegotiated and documented
- [ ] `docs/phase-02.md` written · **Human review before Phase 3**

### T17: Phase 2 documentation

**Verify:** reads correctly against the diff · **Dependencies:** T16 · **Scope:** S
**Files:** `docs/phase-02.md`

---

## Phase 3 — Mask to SVG

> T20–T24 are independent pure modules sharing only the `BinaryMask` type. Parallelizable once T19 lands.

### T18: Binary mask type and hole filling — TDD

**Acceptance:**

- [ ] `BinaryMask` type with width, height, and a typed-array backing store
- [ ] Hole filling removes enclosed background regions below a size threshold
- [ ] **A donut stays a donut** — a large genuine hole is never filled
      **Verify:** `npx vitest run src/lib/mask/binary-mask.test.ts` · **Dependencies:** T1 · **Scope:** S
      **Files:** `src/lib/mask/binary-mask.ts`, `src/lib/mask/binary-mask.test.ts`

### T19: Mask post-processing — TDD

**Description:** Morphological open/close smoothing plus connected-component selection anchored to the prompt point.
**Acceptance:**

- [ ] Speckle below threshold is removed; boundaries smooth without eroding thin features to nothing
- [ ] The component containing the prompt anchor is the one kept, even when a larger component exists elsewhere
- [ ] Donut topology survives the full pipeline
      **Verify:** `npx vitest run src/lib/mask/postprocess.test.ts` on square, circle, donut, speckled, and two-component fixtures
      **Dependencies:** T18 · **Scope:** M
      **Files:** `src/lib/mask/postprocess.ts`, `src/lib/mask/postprocess.test.ts`

### T20: Marching squares contour extraction — TDD

**Acceptance:**

- [ ] Closed contours for outer boundaries and holes, with opposite winding
- [ ] **Saddle-point ambiguity resolved consistently** — named explicitly as a fixture case
- [ ] Masks touching the raster border produce closed contours, not open paths
      **Verify:** `npx vitest run src/lib/vectorize/contours.test.ts` · square/circle/donut/border-touching fixtures
      **Dependencies:** T19 · **Scope:** M
      **Files:** `src/lib/vectorize/contours.ts`, `src/lib/vectorize/contours.test.ts`

### T21: Douglas-Peucker simplification — TDD

**Acceptance:**

- [ ] Tolerance 0 is lossless; larger tolerance monotonically reduces point count
- [ ] Closed contours stay closed; no self-intersection introduced at practical tolerances
      **Verify:** `npx vitest run src/lib/vectorize/simplify.test.ts` · **Dependencies:** T20 · **Scope:** S
      **Files:** `src/lib/vectorize/simplify.ts`, `src/lib/vectorize/simplify.test.ts`

### T22: Bezier curve fitting — TDD

**Description:** Schneider least-squares cubic fit with recursive error-driven subdivision.
**Acceptance:**

- [ ] Max deviation from input points stays within the configured tolerance
- [ ] A sampled circle fits to 4 cubics within a tight error bound
- [ ] Sharp corners are preserved, not rounded away
      **Verify:** `npx vitest run src/lib/vectorize/bezier.test.ts` with explicit error assertions
      **Dependencies:** T21 · **Scope:** M
      **Files:** `src/lib/vectorize/bezier.ts`, `src/lib/vectorize/bezier.test.ts`

### T23: Contours to SVG path data — TDD

**Acceptance:**

- [ ] Emits valid `d` strings with `M`/`C`/`Z`
- [ ] **Donut produces two subpaths rendering correctly under `fill-rule: evenodd`** (SPEC §9.6)
- [ ] Coordinates rounded to a fixed precision to keep output compact
      **Verify:** `npx vitest run src/lib/vectorize/path.test.ts` · **Dependencies:** T22 · **Scope:** S
      **Files:** `src/lib/vectorize/path.ts`, `src/lib/vectorize/path.test.ts`

### T24: Fill colour sampling — TDD

**Acceptance:**

- [ ] Representative fill colour sampled from source pixels inside the mask only
- [ ] Optional k-means palette of up to N flat colours
- [ ] Deterministic for a fixed seed
      **Verify:** `npx vitest run src/lib/color/sample.test.ts` · **Dependencies:** T19 · **Scope:** S
      **Files:** `src/lib/color/sample.ts`, `src/lib/color/sample.test.ts`

### T25: SVG assembly and output hardening — TDD

**Description:** Assemble the document; sanitize before it reaches the user (`/security-and-hardening`). We emit every byte ourselves, so this is about not constructing something unsafe from user-controlled input — filename, dimensions, colour values.
**Acceptance:**

- [ ] Output has a correct `viewBox`, no scripts, no external references, no event attributes
- [ ] Every numeric value is finite and range-checked; no `NaN` reaches the output
- [ ] Filename derived from the upload is sanitized before use in the download attribute
      **Verify:** `npx vitest run src/lib/svg/` · output validates and opens in Inkscape and Figma
      **Dependencies:** T23, T24 · **Scope:** M
      **Files:** `src/lib/svg/document.ts`, `src/lib/svg/sanitize.ts`, plus tests

### T26: Result panel and download

**Acceptance:**

- [ ] SVG renders beside the original at comparable scale
- [ ] Download produces a file that opens cleanly in a browser, Inkscape, and Figma (SPEC §9.7)
- [ ] Download button is disabled with an explanation until a result exists
      **Verify:** `npm run check` · browser: full pipeline, open the downloaded file in all three
      **Dependencies:** T25 · **Scope:** M
      **Files:** `src/ui/result-panel.ts`, `src/main.ts`, `src/styles/app.css`

### ✅ Checkpoint: Phase 3

- [ ] Upload → draw → mask → SVG → download works end to end in a real browser
- [ ] `docs/phase-03.md` written · **Human review before Phase 4**

### T27: Phase 3 documentation

**Dependencies:** T26 · **Scope:** S · **Files:** `docs/phase-03.md`

---

## Phase 4 — Polish and ship

### T28: Loading, progress, and error states

**Acceptance:**

- [ ] Every async step has an honest state; no indeterminate spinner where progress is knowable
- [ ] Model-load failure shows an actionable message with a working retry (SPEC §9.12)
- [ ] Non-model features stay usable when the model is unavailable
      **Verify:** DevTools: block the CDN, throttle, fail mid-download, then retry · **Dependencies:** T27 · **Scope:** M
      **Files:** `src/ui/status.ts`, `src/lib/sam/session.ts`, `src/main.ts`

### T29: Mobile touch and responsive pass

**Acceptance:**

- [ ] Freehand drawing works with touch on iOS Safari and Android Chrome
- [ ] Page scroll does not fight the drawing gesture; pinch-zoom is not broken elsewhere
- [ ] Controls meet 44px touch targets; layout holds at 360px
      **Verify:** real devices or device emulation · **Dependencies:** T28 · **Scope:** M
      **Files:** `src/ui/stroke-overlay.ts`, `src/styles/app.css`

### T30: Accessibility pass

**Description:** `/frontend-ui-engineering`. The canvas is the hard part — SPEC §9.14 requires either a keyboard-accessible alternative or an explicit, labeled limitation. Decide and implement one.
**Acceptance:**

- [ ] Every control is keyboard reachable and operable with a visible focus state
- [ ] Async state changes are announced via a live region
- [ ] axe reports no violations; contrast passes in both themes
- [ ] The canvas decision is implemented and documented, not left implicit
      **Verify:** keyboard-only run-through · axe · VoiceOver spot-check · **Dependencies:** T29 · **Scope:** M
      **Files:** `index.html`, `src/ui/*`, `src/styles/app.css`

### T31: Final visual pass

**Description:** `/minimalist-ui` + `/design-taste-frontend` across the finished app.
**Verify:** both themes, three widths, full pipeline · **Dependencies:** T30 · **Scope:** M
**Files:** `src/styles/*`

### T32: Code review and simplification

**Description:** `/code-review-and-quality`, then `/code-simplification`. Also a `/constraint-driven-development` sweep: no backend, no framework, no paid service, no key.
**Acceptance:**

- [ ] Review findings resolved or consciously declined
- [ ] Dead code, speculative abstraction, and duplicated geometry removed
- [ ] Comment audit: every comment explains a non-obvious project-specific decision; obvious ones deleted
      **Verify:** `npm run check` · coverage still ≥ 90% on `src/lib/**` · **Dependencies:** T31 · **Scope:** M
      **Files:** repo-wide

### T33: README, deploy, and Phase 4 documentation

**Description:** `/shipping-and-launch`. README explaining what it does, how it works, and how to run it. Deploy to GitHub Pages.
**Acceptance:**

- [ ] README covers the pitch, a demo GIF or screenshot, architecture, local setup, and links to the ADRs
- [ ] GitHub Actions workflow builds and deploys on push to `main`
- [ ] Live URL works end to end from a cold cache
- [ ] No API key or secret exists in the repo or the deployed artifact (SPEC §9.16)
      **Verify:** visit the live URL in a fresh profile and complete the full pipeline
      **Dependencies:** T32 · **Scope:** M
      **Files:** `README.md`, `.github/workflows/deploy.yml`, `docs/phase-04.md`

### ✅ Checkpoint: Complete

- [ ] Every Success Criterion in SPEC §9 demonstrably met
- [ ] All five ADRs plus any added in Phase 2 are current
- [ ] Deployed and working from a cold cache
