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

### T4: Two-canvas stage and image loading ✅

**Description:** Source-image canvas and a transparent overlay canvas, exactly aligned, DPR-aware. Load images via file input, drag-and-drop, and paste.
**Acceptance:**

- [x] Two separate canvas elements; the overlay is never drawn into the source canvas (SPEC §8 Always) — enforced structurally: the source canvas is detached and has no reference passed to the overlay
- [x] PNG, JPEG, and WebP load and render fit-to-stage, longest side capped at 2048 (verified: 4000×2500 fixture backing store is 1500×938 at DPR2, not the raw dimensions; unit-tested exhaustively in viewport.test.ts)
- [x] Both canvases scale with `devicePixelRatio`; the loop coordinates map back to source-image pixels correctly (verified: overlay and source canvas bounding boxes match exactly; clientToSourcePoint unit-tested for corners, centre, and off-canvas drags)
- [x] Non-image or corrupt files produce a visible, actionable error (verified: renamed .txt→.png shows "could not be read... corrupt or renamed", stage stays in `data-state="empty"`)
      **Verify:** `npm run check` · browser: all three input paths, a portrait image, a landscape image, a 4000px image, a `.txt` renamed to `.png`
      **Dependencies:** T3 · **Scope:** M
      **Files:** `src/ui/stage.ts`, `src/ui/controls.ts`, `src/ui/stage.test.ts`, `src/styles/app.css`

### T5: Polygon geometry primitives — TDD ✅

**Description:** Pure polygon operations with no DOM dependency. **Tests written first.**
**Acceptance:**

- [x] `boundingBox`, `signedArea`, `polygonCentroid`, `containsPoint`, `poleOfInaccessibility`
- [x] Degenerate inputs covered: empty, single point, two points, all-collinear, self-intersecting (+ coincident vertices, zero-length edges)
- [x] `containsPoint` correct for concave polygons and for points exactly on an edge (verified against a C-shape fixture; centroid deliberately falls outside it)
      **Verify:** `npx vitest run src/lib/geometry/loop.test.ts` · 100% branch coverage on this module (confirmed: loop.ts drops out of the coverage report entirely once every branch is hit)
      **Dependencies:** T1 · **Scope:** S
      **Files:** `src/lib/geometry/loop.ts`, `src/lib/geometry/loop.test.ts`, `src/lib/geometry/types.ts`

### T6: Loop → SAM prompt conversion — TDD ✅

**Description:** Turn a hand-drawn loop into a SAM prompt: bounding box, a foreground anchor, spread interior points, one background point. **Tests written first.** This is the module SPEC §7 names first for a reason — a prompt point landing outside the shape silently ruins the mask.
**Acceptance:**

- [x] Every returned foreground point is inside the polygon, verified for concave and C-shaped loops where the centroid falls outside
- [x] Returns a bbox and at least 3 points for any non-degenerate loop (enforced: interior sample count is floored at 2 regardless of what the caller requests)
- [x] The background point is outside the loop but inside the image bounds (returns `null` rather than fabricating one when the loop fills the image — verified explicitly)
- [x] Loops extending past the canvas edge are clamped, not rejected (verified both near-edge and far-edge overhangs)
      **Verify:** `npx vitest run src/lib/geometry/prompt.test.ts` · property test: 500 random loops, no foreground point ever outside (all 16 tests pass, including a targeted case proving the corner-sampling fallback fires correctly on an extreme concave shape)
      **Dependencies:** T5 · **Scope:** S
      **Files:** `src/lib/geometry/prompt.ts`, `src/lib/geometry/prompt.test.ts`

### T7: Freehand stroke overlay with halo and palette ✅

**Description:** Pointer capture on the overlay canvas producing a closed loop, rendered as a coloured line with a contrasting halo. Five-hue pen palette; halo inverts with theme.
**Acceptance:**

- [x] Stroke is legible over pure white, pure black, and mid-grey image regions in both themes — **caught and fixed a real gap**: the halo only contrasts one extreme at a time (dark halo vs. white, light halo vs. black), so on the *other* extreme the pen hue alone must carry contrast. Computing WCAG contrast ratios found the original amber (#f4a300) at only 2.08:1 against white — invisible in dark mode over a bright region. Replaced with a burnt sienna (#b5651d, 4.84/4.34), and every hue now has a permanent regression test enforcing ≥3:1 against both pure black and pure white
- [x] Halo is dark in light mode and light in dark mode; palette cycles 5 hues (verified: 6 clicks sample 5 distinct colours then wrap to the first)
- [x] Loop auto-closes on pointer release; clear and undo available (verified: a <3-point stray click leaves no mark; Clear loop empties the canvas)
- [x] Nothing is ever drawn into the source canvas (structural: the overlay only ever holds a reference to `stage.overlayCanvas`, never the source canvas)
      **Verify:** `npm run check` · browser: draw over a black/white/grey test image in both themes, all 5 hues (all pass; contrast gap found and fixed — see above)
      **Dependencies:** T4, T5 · **Scope:** M
      **Files:** `src/ui/stroke-overlay.ts`, `src/ui/stroke-overlay.test.ts`, `src/styles/app.css`

### T8: Wire loop completion to prompt, with debug visualization ✅

**Description:** On loop close, derive the SAM prompt and draw the bbox and points on the overlay behind a debug flag. **This is the Phase 1 end-to-end proof** — the full input path works before any model exists.
**Acceptance:**

- [x] Closing a loop renders its bbox and prompt points in the correct positions (verified with screenshots, not just pixel-count assertions)
- [x] Points visibly sit inside the drawn loop, including for a deliberately C-shaped loop (screenshot: all 3 foreground points land in the shape's solid arms, none in the open notch)
- [x] Debug overlay is off by default and toggleable (verified: 0 debug pixels before toggling, appear after, persist across a redraw while still on, vanish on toggle-off without erasing the loop itself)
      **Verify:** `npm run check` · browser: draw a blob, a C-shape, and a loop crossing the image edge (all verified — the edge-crossing case additionally shows the debug bbox visibly clamp at the canvas boundary, confirming T6's clamping logic end-to-end, not just in isolation)
      **Dependencies:** T6, T7 · **Scope:** S
      **Files:** `src/main.ts`, `src/ui/stroke-overlay.ts`

### T9: Phase 1 design pass ✅

**Description:** Apply `/minimalist-ui` and `/design-taste-frontend` to the shell. Nothing that reads as a templated AI layout. Both skills target marketing/landing pages more than a canvas tool; applied selectively (contrast/consistency/copy hygiene, not heroes or bento grids) rather than mechanically.
**Acceptance:**

- [x] Type scale, spacing rhythm, and colour use are consistent and deliberate in both themes (balanced panel heights so the empty Result panel no longer looks orphaned next to a loaded Source panel; toned down the debug toggle to a quiet text link so it doesn't compete with real controls)
- [x] Focus states are visible and styled, not browser defaults (custom `:focus-visible` ring, verified via keyboard tab order across all 6 toolbar controls)
- [x] No decorative shadow or gradient survives
- [x] **Found and fixed a real bug during this pass**: `.stage-toolbar { display: flex }` silently defeated the `hidden` attribute via equal-specificity/source-order, so the toolbar was visible before any image loaded. Fixed with a defensive `[hidden] { display: none !important; }` reset, verified `true` in a fresh session. Also removed dead duplicate CSS from an earlier phase and fixed a narrow-viewport wrap where a toolbar button floated oddly right-aligned on its own row
- [x] Em-dash audit: 4 instances in user-visible copy (title, meta description, hero lede, error message) replaced with plain punctuation, per `/design-taste-frontend`'s copy hygiene rules
      **Verify:** browser at three widths, both themes · keyboard-only tab through every control (tab order: theme → pen swatch → undo → clear loop → choose image → debug toggle, all reachable) · `npm run a11y` clean at all 6 configurations after every change
      **Dependencies:** T8 · **Scope:** M
      **Files:** `src/styles/tokens.css`, `src/styles/app.css`

### ✅ Checkpoint: Phase 1 — COMPLETE

- [x] `npm run check` clean; `npm run build` succeeds (11.26 kB JS / 4.47 kB gzipped)
- [x] Browser-verified via Playwright (`chrome-devtools` MCP not configured in this session): upload → draw → prompt points render, 0 console errors end to end
- [x] `docs/phase-01.md` written (what was built, decisions, trade-offs)
- [ ] **Human review before Phase 2**

### T10: Phase 1 documentation ✅

**Description:** `docs/phase-01.md` per `/documentation-and-adrs`.
**Acceptance:** [x] Covers what shipped, decisions made during the phase, and what was deferred
**Verify:** reads correctly against the actual diff · **Dependencies:** T9 · **Scope:** S
**Files:** `docs/phase-01.md`

---

## Phase 2 — MobileSAM in the browser

### T11: Pin the MobileSAM ONNX export — research only, no code ✅

**Description:** Identify the exact published encoder and decoder artifacts and record their **real** input/output tensor names, shapes, and dtypes, verified against the files themselves. Highest-risk unknown in the project, deliberately front-loaded (`/source-driven-development`).
**Acceptance:**

- [x] Encoder and decoder URLs pinned to an explicit revision, not a branch (`0d3b403339b4674a82493d5e97964dd78089ddc8` on `Acly/MobileSAM`, MIT licensed)
- [x] Actual tensor signature recorded in `docs/model-signature.md` — read directly from the ONNX graph (`onnx.load`), not assumed. **Found a real ambiguity the export script itself couldn't resolve**: it supports two mutually exclusive preprocessing conventions and the README didn't say which one this file used. Only the graph's actual input shape (`[image_height, image_width, 3]`, dynamic HWC) settled it — normalization, permute, and padding all happen *inside* the graph, so our JS only resizes the longest side to 1024
- [x] File sizes and available quantizations noted (28.16 MiB encoder, 15.7 MiB decoder, fp32 only — no int8 variant exists in this repo, narrowing T16's question)
- [x] CORS headers confirmed to permit browser fetch from our origin (verified via a real GET with `Origin` header following the redirect: `access-control-allow-origin: *`, `accept-ranges: bytes` on the final CDN response)
      **Verify:** `curl -I` each URL · inspect the ONNX graph and confirm the recorded signature (done: both files downloaded, `onnx.load(..., load_external_data=False)` against each, every shape/dtype in `docs/model-signature.md` read from the graph itself). Also verified the point-coordinate scaling convention and label encoding against Meta's official SAM ONNX export script and notebook, since MobileSAM's decoder claims SAM-compatibility (ADR-0003) but that claim needed checking, not trusting
      **Dependencies:** None · **Scope:** S
      **Files:** `docs/model-signature.md`

### T12: Image preprocessing and coordinate mapping — TDD ✅

**Description:** Source image → letterboxed 1024×1024 normalized NCHW tensor, plus the forward and inverse coordinate transforms. **Tests written first** — the inverse transform is where an off-by-one silently misplaces every prompt point.

**Scope turned out smaller than planned**: T11 found normalization, channel-permute, and padding all happen *inside* the ONNX graph, not in JS (see `docs/model-signature.md`). This module only resizes the longest edge to 1024 (HWC, raw 0-255, no normalize) and provides the coordinate scale transform — a pure scale with **no offset term**, since the graph pads bottom-right rather than centering.
**Acceptance:**

- [x] `imageToTensor` produces the exact shape and normalization the T11 signature specifies (renamed `pixelsToEncoderTensor` — produces raw un-normalized HWC float32, matching the graph's expectation exactly)
- [x] `toModelSpace` / `toImageSpace` round-trip within 0.5px for portrait, landscape, and square inputs (plus a 200-sample property test)
- [x] Letterbox padding is correct for extreme aspect ratios (10:1, 1:10) (verified: short edge never collapses to 0; no offset needed since padding isn't centered)
- [x] **Smoke-tested against the real downloaded model** (not just unit tests): fed `encoderInputSize`'s output through the actual encoder.onnx via Python onnxruntime, got exactly the documented `(1,256,64,64)` embedding shape; fed a box-encoded prompt through the real decoder.onnx and got a correctly-upscaled `(1,1,1200,1600)` mask
      **Verify:** `npx vitest run src/lib/sam/preprocess.test.ts` · round-trip property test over random points and sizes · real-model smoke test via Python onnxruntime (see `docs/model-signature.md`)
      **Dependencies:** T11 · **Scope:** S
      **Files:** `src/lib/sam/preprocess.ts`, `src/lib/sam/preprocess.test.ts`

### T13: ONNX session, CDN fetch, and Cache API persistence ✅

**Description:** Lazy ORT Web session creation, weights fetched from the pinned CDN URLs with determinate progress, persisted in the Cache API. Failure is a typed result, not a throw.
**Acceptance:**

- [x] Model load starts after first paint and never blocks it (verified: file input usable and interactive immediately at DOMContentLoaded, before the model reaches "ready")
- [x] Progress is determinate, read from `Content-Length` via a streamed body (verified under CDP-throttled network: real byte counts, e.g. `"Loading encoder: 0.0 / 26.9 MB (0%)"`, not a spinner)
- [x] Second load resolves from the Cache API with no network request (verified: reload after a cold load reached "ready" in 669ms with **zero** network requests for model files)
- [x] Fetch failure returns a typed error the UI can act on; the app stays usable without the model (verified: CDN blocked → clean error + Retry button, stage stays fully interactive; verified Retry actually recovers once the network returns)
- [x] `lib/sam/` is dynamically imported so ORT sits outside the initial chunk (verified in the real build: `index-*.js` is 5.30 kB gzipped, ORT's runtime lives entirely in a separate `session-*.js` chunk, 109.64 kB gzipped, loaded only on demand)
      **Verify:** `npm run build && npm run preview` — **not dev-server only**, per the plan's ORT asset-path risk · DevTools: throttle to Fast 3G, confirm progress; reload, confirm cache hit; block the CDN, confirm the error path. **All verified against the real production build with Playwright, including a full real-network cold load that actually constructed both `InferenceSession`s from the real ~44 MB of downloaded weights** — not mocked. One genuine risk from the plan's register materialized and resolved cleanly: Vite's static analysis of `ort.bundle.min.mjs`'s minified `import.meta.url`-relative WASM reference was uncertain from documentation alone (conflicting reports online, including a reverted upstream fix attempt) — building and serving the real bundle settled it: Vite correctly detected and hashed the WASM asset (`ort-wasm-simd-threaded.jsep-*.wasm`, 200 on load, zero 404s)
      **Dependencies:** T11 · **Scope:** M
      **Files:** `src/lib/sam/session.ts`, `src/lib/sam/session.test.ts`, `vite.config.ts`

### T14: Decoder invocation and mask extraction — TDD ✅

**Description:** Prompt points in model space → decoder inputs → logits → binary mask at source resolution. Tested against fixture tensors; the real model is never loaded in unit tests.

**Scope note**: "resample to source dimensions" turned out to already be the decoder's own job — it resizes `masks` to `orig_im_size` internally (T11/T12 finding), so this module only thresholds logits, it never resamples.
**Acceptance:**

- [x] Prompt encoding matches the T11 signature exactly (point coords, labels, mask input, `has_mask_input`) — 13 unit tests against fixture tensors, per SPEC's testing strategy (real model never loaded in unit tests), **plus re-verified the exact interleaved label order `[1,1,0,2,3]` `buildDecoderInputs` produces against the real downloaded decoder** via Python onnxruntime — ran cleanly, correct output shape
- [x] Logits threshold to a binary mask and resample to source dimensions (thresholding is ours and unit-tested; resampling is the model's own job, confirmed above)
- [x] Encoder embedding is cached per image, so a redrawn loop re-runs only the decoder (API shape supports this — `runEncoder`/`runDecoder` are separate, `runDecoder` takes the embedding as a parameter rather than recomputing it; the actual caller-side caching and its browser verification is T15's job, where a real redraw event exists to test against)
      **Verify:** `npx vitest run src/lib/sam/decode.test.ts` against fixture tensors (13 tests, all pass) · real-decoder cross-check via Python onnxruntime for the exact tensor layout this module emits · browser verification of "redraw does not re-run the encoder" deferred to T15, where the UI event that triggers a redraw actually exists
      **Dependencies:** T12, T13 · **Scope:** M
      **Files:** `src/lib/sam/decode.ts`, `src/lib/sam/decode.test.ts`, `src/lib/sam/fixtures/`

### T15: Live mask preview ✅

**Description:** Run the encoder on image load and the decoder on loop completion; render the mask as a translucent overlay with loading states throughout.
**Acceptance:**

- [x] Drawing a loop over a clearly-separated subject produces a visibly correct mask — **verified against the real model with a genuine geometric ground truth**: a loop drawn loosely around a circle (not tracing it) produced a real SAM mask with **0.996 IoU** against the circle's actual coordinates, 99% model confidence. Screenshot shows the mask tracing the true circle boundary, not the rough hand-drawn loop
- [x] Encoder and decoder each have a distinct, honest loading state ("Preparing image for segmentation…" → "Ready — draw a loop to segment it" → "Segmenting…" → "Segmented (confidence N%)")
- [x] Redrawing updates the preview without re-running the encoder — verified behaviorally, not just structurally: instrumented a `MutationObserver` on the status line and confirmed "Preparing image" never appears a second time across a redraw, only "Segmenting…"/"Segmented" (a second, independent circle at a different radius scored 81% confidence, consistent with a fresh decode against the cached embedding)
      **Verify:** `npm run check` · browser: three fixture images, several loops each. **Went further**: generated a fixture with known geometry (an 800×600 circle) specifically so the real SAM output could be checked against ground truth via IoU, rather than eyeballing whether a mask "looks about right"
      **Dependencies:** T14 · **Scope:** M
      **Files:** `src/main.ts`, `src/ui/status.ts`, `src/ui/stage.ts`

### T16: Performance checkpoint ✅

**Description:** `/performance-optimization` audit. Measure, then decide quantization on evidence rather than in advance.
**Acceptance:**

- [x] FCP < 1.5s and interactive-before-model-ready confirmed under Fast 3G (measured: 628ms under Fast-3G + 4× CPU throttle; file input confirmed usable while model still downloading)
- [x] Initial JS chunk < 150 KB gzipped, excluding model weights and ORT WASM (measured: 6.26 KB gzipped — wide margin)
- [x] Encoder < 3s and decoder < 200ms measured on 1024×1024 — **decoder passes (194ms, 3% margin); encoder measured at 3384ms, fails by ~13%**, via the browser's own Long Task API (not wall-clock estimation, which an earlier attempt showed gives misleading numbers)
- [x] fp32 vs int8 encoder decided against measured load time and fixture mask quality; recorded as an ADR — no int8 artifact exists in the pinned repo (confirmed at T11); producing one is deferred, not undertaken speculatively (ADR-0006)
- [x] Main-thread jank assessed; Web Worker decision made and recorded — **investigated and rejected COOP/COEP threading** (no production path on GitHub Pages; broke model loading entirely in dev with a real bundler incompatibility). **Decision, confirmed with the user**: accept the 3.4s block for v1 rather than build a dedicated Web Worker now — the fix is a genuine architectural change to two already-consumed modules' calling convention, disproportionate to a 13% overage on a synthetic test fixture. Recorded in ADR-0006, revisit if a real photo proves meaningfully worse or at Phase 4 polish

**Also landed**: switched every `onnxruntime-web` import to the `onnxruntime-web/wasm` (CPU-only) entry point — the default import resolves to the WebGPU/WebNN-capable "jsep" build (28.3 MB WASM) which this project has no use for. The plain build measures 14.2 MB WASM / 71 KB vendor JS (was 403 KB), a ~14 MB reduction in first-visit download. Correctness re-verified after the switch, not assumed: the T15 circle-fixture IoU check produced an **identical 0.996** with the smaller build.
      **Verify:** Lighthouse-equivalent measurement via Playwright + CDP (FCP under emulated Fast 3G + 4× CPU throttle) · encoder/decoder timing via `PerformanceObserver` for `longtask` entries against the real production build and real downloaded model · bundle analysis from actual `npm run build` output
      **Dependencies:** T15 · **Scope:** M
      **Files:** `vite.config.ts`, `src/lib/sam/*`, `docs/adr/0006-*.md`

### ✅ Checkpoint: Phase 2 — COMPLETE

- [x] Mask preview works in a real browser on the fixture set (0.996 IoU against known ground truth)
- [x] Performance budget met, or consciously renegotiated and documented (5 of 6 targets met; encoder's 13% overage consciously accepted for v1, per ADR-0006, confirmed with the user)
- [x] `docs/phase-02.md` written · **Human review before Phase 3**

### T17: Phase 2 documentation ✅

**Verify:** reads correctly against the diff · **Dependencies:** T16 · **Scope:** S
**Files:** `docs/phase-02.md`

---

## Phase 3 — Mask to SVG

> T20–T24 are independent pure modules sharing only the `BinaryMask` type. Parallelizable once T19 lands.

### T18: Binary mask type and hole filling — TDD ✅

**Acceptance:**

- [x] `BinaryMask` type with width, height, and a typed-array backing store (`Uint8Array`)
- [x] Hole filling removes enclosed background regions below a size threshold (implemented as a border flood-fill, then component-labeling whatever background is left over — one linear pass rather than a per-component border-adjacency check)
- [x] **A donut stays a donut** — a large genuine hole is never filled (explicit fixture test, hole above threshold verified unchanged)
      **Verify:** `npx vitest run src/lib/mask/binary-mask.test.ts` — 14 tests, 100% branch coverage (one genuinely unreachable defensive bounds-check was removed rather than padded — proven dead by the border-seeding invariant, not just untested) · **Dependencies:** T1 · **Scope:** S
      **Files:** `src/lib/mask/binary-mask.ts`, `src/lib/mask/binary-mask.test.ts`

### T19: Mask post-processing — TDD ✅

**Description:** Morphological open/close smoothing plus connected-component selection anchored to the prompt point.
**Acceptance:**

- [x] Speckle below threshold is removed; boundaries smooth without eroding thin features to nothing — **`smooth()` has an explicit safety guard**: if a single `open()` pass would erase more than half a shape's pixels (a shape thinner than the structuring element, where erosion has no interior to preserve), the open pass is skipped and only `close()` runs. Found via a failing test, not designed in up front: an unguarded open+close completely erased a 2px-tall fixture
- [x] The component containing the prompt anchor is the one kept, even when a larger component exists elsewhere (explicit two-component fixture, smaller/anchored one kept)
- [x] Donut topology survives the full pipeline (ring stays connected all the way around; hole stays background)

**Real morphology facts surfaced by test failures, not bugs**: a single-pixel spike touching a wide solid mass survives one `open()` pass (its junction always has all 4 neighbours foreground, so dilation restores it — removing it needs a bigger structuring element or more iterations than "light" smoothing calls for), and the mask's exact corner pixel always erodes away under a cross structuring element (no diagonal neighbour to restore it from) — correct corner-rounding, not a defect, but a bad point to assert "stays foreground" on. Both are documented in the test file rather than worked around.
      **Verify:** `npx vitest run src/lib/mask/postprocess.test.ts` on square, circle, donut, speckled, and two-component fixtures — 20 tests, 100% branch coverage on both `binary-mask.ts` and `postprocess.ts`
      **Dependencies:** T18 · **Scope:** M
      **Files:** `src/lib/mask/postprocess.ts`, `src/lib/mask/postprocess.test.ts`

### T20: Marching squares contour extraction — TDD ✅

**Acceptance:**

- [x] Closed contours for outer boundaries and holes, with opposite winding — every one of the 14 non-trivial marching-squares cases was derived from **one fixed algebraic rule** (orient each segment so its foreground corner(s) give a strictly negative cross product), rather than picked by eye per case. Opposite winding for outer-vs-hole falls out of that rule automatically rather than being special-cased
- [x] **Saddle-point ambiguity resolved consistently** — both saddle cases (5 and 10) resolve by applying the same single-corner rule to each diagonal corner independently, treating them as separate touching regions. Deliberately consistent with `lib/mask`'s existing 4-connectivity convention, where diagonal contact doesn't count as connected either — not an arbitrary, unrelated choice
- [x] Masks touching the raster border produce closed contours, not open paths (solved by padding the mask with a 1px background border before tracing, removed again from output coordinates — every foreground region is fully enclosed by sample data regardless of where it sits in the original mask)

**Went beyond the fixture set**: extracted a real segmentation mask from the actual browser pipeline (a real MobileSAM output, 750×563, ~62k foreground pixels) and traced it with the real implementation — 16.3ms, one contour, and **the traced area matched the mathematically expected circle area (πr²) to within 0.2%**. This validates the algorithm against real model output, not just hand-built fixtures small enough to verify by eye.
      **Verify:** `npx vitest run src/lib/vectorize/contours.test.ts` · square/circle/donut/border-touching fixtures — 14 tests, 100% line coverage (two categories of defensive branch — a case-table-corruption guard and a degenerate-chain guard — are deliberately left untested rather than proven dead or gamed for coverage, documented inline as to why); plus a real-mask cross-check via `vite-node` against the actual browser pipeline
      **Dependencies:** T19 · **Scope:** M
      **Files:** `src/lib/vectorize/contours.ts`, `src/lib/vectorize/contours.test.ts`

### T21: Douglas-Peucker simplification — TDD ✅

**Acceptance:**

- [x] Tolerance 0 is lossless; larger tolerance monotonically reduces point count — verified against real data too: the real 1124-point circle contour from T20 simplifies to 393 points at tolerance 0 with **exactly 0.00% area drift**, and monotonically down to 16 points by tolerance 4
- [x] Closed contours stay closed; no self-intersection introduced at practical tolerances

**Adapted for closed polygons, not open polylines**: T20's contours are always implicitly closed, which the textbook Douglas-Peucker algorithm doesn't directly handle. Split into two open arcs at a farthest-point pair, simplify each independently, rejoin — the standard technique, done in O(n) rather than an O(n²) all-pairs farthest search, since a single farthest-from-an-arbitrary-anchor point gives an adequate split.

**Found and fixed a real bug via TDD, not a test error this time**: at extreme tolerance, both arcs could independently collapse to just their shared two endpoints, degenerating the whole closed polygon to 2 points — a shape with no area, failing "closed contours stay closed." Fixed with an explicit floor: if simplification would drop below a triangle, fall back to the single most-deviating point from the original polygon, keeping cyclic order (and therefore winding) intact.

**Two provably-dead defensive branches removed, not left untested**: `splitIndex === 0` can never occur (the search sentinel starts at -1, so the first candidate always wins the very first comparison, even for an all-identical-points polygon), and `maxIndex === -1` in the triangle-floor fallback can't either (the calling context already guarantees `polygon.length >= 3`, so at least one candidate index always exists). Same pattern as T18/T20: proved unreachable and removed, not padded or left unexplained.
      **Verify:** `npx vitest run src/lib/vectorize/simplify.test.ts` — 14 tests, 100% coverage · real-contour cross-check via `vite-node` against T20's actual 1124-point mask output · **Dependencies:** T20 · **Scope:** S
      **Files:** `src/lib/vectorize/simplify.ts`, `src/lib/vectorize/simplify.test.ts`

### T22: Bezier curve fitting — TDD ✅

**Description:** Schneider least-squares cubic fit with recursive error-driven subdivision.
**Acceptance:**

- [x] Max deviation from input points stays within the configured tolerance
- [x] A sampled circle fits to 4 cubics within a tight error bound — a 200-point circle fits in 4–12 segments depending on tolerance (not hard-pinned to exactly 4, since that depends on tolerance/threshold choices); **on the real T20/T21 pipeline output** (1124 raw points → 50 simplified → fitted), produced 10 segments at tolerance 1.5 with measured max deviation 1.490 — the fitter correctly targets *meeting* the tolerance, not beating it by a wide margin
- [x] Sharp corners are preserved, not rounded away — corner detection (turn-angle threshold) splits the path before curve fitting ever runs, so a corner always lands exactly at a segment boundary (a P0/P3 junction), never inside a single smoothed span; verified on a densified square

**Deliberate scope cut, stated up front**: implements Schneider's least-squares fit and error-driven recursive subdivision, but not the optional Newton-Raphson re-parameterization pass from the original Graphics Gems algorithm. Chord-length parameterization alone already met this project's accuracy targets, verified directly against real pipeline output rather than assumed.

**A real, non-obvious numerical fact proved and used, not just implemented**: the least-squares linear system's determinant is a Gram determinant and therefore provably non-negative (Cauchy-Schwarz); it hits exactly zero only when the sample points collapse to effectively one contributing term with parallel/antiparallel tangents, which happens precisely for 3 exactly-collinear points — worked out by hand and encoded as a deterministic test, not left as an unexplained magic fixture. The negative-alpha fallback (control point placed behind its own endpoint) has no equally clean closed form, so that fixture was found by randomized search over point configurations instead of hand-derived — a legitimate, disclosed method, not a hidden shortcut.

**One provably-dead branch removed, one genuine one kept and tested**: an internal recursion-depth guard (`points.length < 2`) was proven unreachable (both recursive call sites always pass ≥2 points by construction of the pivot clamp) and removed. The equivalent guard on the *public* `fitPolygon` entry point was kept and given a real test, since external callers — unlike this module's own internal recursion — have no such guarantee enforced on them.
      **Verify:** `npx vitest run src/lib/vectorize/bezier.test.ts` with explicit error assertions — 14 tests, 100% coverage · real pipeline cross-check via `vite-node` against T20/T21's actual mask-derived contour
      **Dependencies:** T21 · **Scope:** M
      **Files:** `src/lib/vectorize/bezier.ts`, `src/lib/vectorize/bezier.test.ts`

### T23: Contours to SVG path data — TDD ✅

**Acceptance:**

- [x] Emits valid `d` strings with `M`/`C`/`Z`
- [x] **Donut produces two subpaths rendering correctly under `fill-rule: evenodd`** (SPEC §9.6) — verified with a real fill-rule test, not a string-shape check: sampled the fitted curves back into polylines and ran a genuine combined ray-crossing count across both subpaths (exactly what evenodd means), confirming a point in the ring is inside (odd crossings) and a point in the hole is outside (even crossings) — including a test proving this holds even when one subpath's winding is deliberately reversed, since evenodd famously doesn't care about winding direction
- [x] Coordinates rounded to a fixed precision to keep output compact (trailing zeros stripped, `-0` normalized to `0`)

**Found and fixed a real, visible geometry bug via full-pipeline real-data testing** — not caught by any of T20/T21/T22's own unit tests, all passing at the time. Rendering the actual pipeline's output (real mask → contour → simplify → fit → path → real SVG in a real browser) showed a small self-intersecting spike on the circle's boundary. Traced it to `bezier.ts`'s `fitOneCubic`: a control point landing ~45 units from its own endpoint on a ~23-unit chord (nearly 2x, pointing backward past it) — a case the existing negative-alpha guard didn't catch, since the computed alpha was positive and the linear system wasn't degenerate. Root cause: a short, sparse sub-segment (produced by recursive splitting) inheriting a tangent estimate from an earlier, larger split that was a poor fit for this particular short run.

Fixed with a symmetric upper bound on alpha (same fallback as the negative case), and this surfaced a second, non-obvious problem: my *first* regression test — extracting just the local 9 points around the failure — passed even with the fix reverted, because the bug depends on the specific tangent inherited from the full 50-point closed polygon's recursive split history, not on those points in isolation. Rebuilt the test around the complete real 50-point contour through `fitPolygon` (matching the actual failing call), and deliberately re-disabled the fix to confirm the rebuilt test actually fails without it before restoring it — a test that can't fail is not a regression test.
      **Verify:** `npx vitest run src/lib/vectorize/path.test.ts` — 9 tests, 100% coverage · full real-pipeline cross-check (real mask → SVG file → rendered in a real browser), which is what actually caught the spike bug above; `src/lib/vectorize/bezier.test.ts` grew a 16th test (the real 50-point fixture) verified to fail without the fix and pass with it · **Dependencies:** T22 · **Scope:** S
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
