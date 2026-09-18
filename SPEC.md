# Spec: SnapVector

> Status: **approved** · Owner: @zahyaah · Created 2026-09-18

Rough loop in, clean SVG cutout out. 100% client-side.

---

## 1. Objective

A single-page web app where a visitor drops in an image, freehand-draws a rough loop
around the region they want, and gets back a clean, downloadable SVG cutout of that
region — with segmentation and vectorization running entirely in their own browser.

**User:** someone who needs a quick vector cutout (designer, deck-maker, hobbyist) and
does not want to upload their image to a paid service.

**Why it's differentiated:** free, fully client-side (the image never leaves the device),
and a _rough loop_ input instead of remove.bg's "trust our model" or SAM's "click a point."

**Success looks like:** a static site that costs $0 to host at any traffic level, loads
and paints before the model downloads, and turns a sloppy loop into a usable SVG in a
few seconds on a mid-range laptop.

### Non-goals (v1)

- Multi-region / multi-object selection in one pass
- Editing the returned vector paths in-app
- Gradient or photographic fills (flat fill or small flat palette only)
- Server-side anything — see Boundaries

---

## 2. Capability Map

| Module id          | Responsibility                                                                            | Depends on         |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------ |
| `ui-shell`         | Theme system, layout, brand tokens, image load, two-canvas stage, freehand stroke overlay | —                  |
| `loop-prompt`      | Loop polygon → SAM prompt (bbox, interior points, negative point)                         | — (pure geometry)  |
| `sam-runtime`      | ONNX Runtime Web session, image preprocessing, encoder + decoder, mask tensor out         | `loop-prompt`      |
| `mask-postprocess` | Hole filling, morphological smoothing, prompt-matched component selection                 | — (pure raster)    |
| `vectorize`        | Contour trace → simplify → Bezier fit → path data                                         | `mask-postprocess` |
| `svg-export`       | Fill-color sampling, SVG document assembly, sanitization, download                        | `vectorize`        |

Build order: `ui-shell` + `loop-prompt` → `sam-runtime` → `mask-postprocess` → `vectorize` → `svg-export`

`loop-prompt`, `mask-postprocess`, `vectorize`, and `svg-export` are pure functions over
plain data — they are unit-testable with no DOM, no canvas, and no model. That is the
seam the whole test strategy hangs off.

This map matches the four delivery phases in the brief:

- **Phase 1** = `ui-shell` + `loop-prompt`
- **Phase 2** = `sam-runtime` (+ `/performance-optimization` checkpoint)
- **Phase 3** = `mask-postprocess` + `vectorize` + `svg-export`
- **Phase 4** = polish across all modules

---

## 3. Tech Stack

| Concern       | Choice                                                                        | Version           |
| ------------- | ----------------------------------------------------------------------------- | ----------------- |
| Language      | TypeScript, `strict: true`                                                    | 6.0.3             |
| Build         | Vite                                                                          | 8.3.0             |
| Framework     | **none** — vanilla TS + DOM                                                   | —                 |
| Inference     | `onnxruntime-web`                                                             | 1.30.0            |
| Model         | MobileSAM ONNX (encoder + decoder, split)                                     | pinned at Phase 2 |
| Vectorization | hand-written TS — see [ADR-0005](docs/adr/0005-hand-written-vectorization.md) | —                 |
| Unit tests    | Vitest                                                                        | 3.2.7 — see note  |
| Browser tests | Chrome DevTools MCP, manual per phase                                         | —                 |
| Hosting       | GitHub Pages (static)                                                         | —                 |

No runtime dependencies beyond `onnxruntime-web`. No CSS framework — plain CSS with
custom properties.

---

## 4. Commands

```
Install:      npm install
Dev:          npm run dev
Build:        npm run build
Preview:      npm run preview
Test:         npm test
Test (watch): npm run test:watch
Coverage:     npm run test -- --coverage
Typecheck:    npm run typecheck      # tsc --noEmit
Lint:         npm run lint           # eslint . --max-warnings 0
Format:       npm run format         # prettier --write .
Check (all):  npm run check          # typecheck && lint && test
```

`npm run check` is the gate that must pass before every commit.

---

## 5. Project Structure

```
src/
  main.ts                     App entry — wires modules, owns no logic
  ui/
    theme.ts                  Light/dark resolution, toggle, localStorage
    stage.ts                  Two-canvas stage: source image + stroke overlay
    stroke-overlay.ts         Freehand capture, halo rendering, pen palette
    controls.ts               Toolbar, file input, drag-and-drop
    result-panel.ts           SVG preview + download button
    status.ts                 Loading / progress / error surfaces
  lib/
    geometry/
      loop.ts                 Polygon ops: bbox, centroid, area, point-in-polygon
      prompt.ts               Loop -> SAM prompt (points + labels + box)
    sam/
      session.ts              ORT session lifecycle, lazy load, caching
      preprocess.ts           Image -> 1024x1024 normalized NCHW tensor
      decode.ts               Decoder invocation + logits -> binary mask
    mask/
      binary-mask.ts          Mask type + basic ops
      postprocess.ts          Hole fill, morphology, component selection
    vectorize/
      contours.ts             Marching squares boundary extraction
      simplify.ts             Douglas-Peucker
      bezier.ts               Cubic Bezier curve fitting
      path.ts                 Contours -> SVG path `d` strings
    color/
      sample.ts               Fill color / k-means palette from source pixels
    svg/
      document.ts             SVG assembly
      sanitize.ts             Output hardening before download
  styles/
    tokens.css                Design tokens (brand, light + dark)
    app.css                   Layout and components
public/
  (static assets; model files if vendored — see Open Questions)
docs/
  adr/                        Architecture decision records
  phase-01.md ...             Per-phase build log
tasks/
  plan.md                     Technical plan
  todo.md                     Ordered task list
```

Tests are colocated: `src/lib/geometry/prompt.test.ts` next to `prompt.ts`.

---

## 6. Code Style

Naming carries the "why." Comments only where the code encodes a non-obvious,
project-specific decision.

```ts
export interface SamPrompt {
  readonly points: readonly PromptPoint[];
  readonly box: BoundingBox;
}

export function loopToSamPrompt(loop: Polygon, options: PromptOptions = {}): SamPrompt {
  const box = boundingBox(loop);
  const centroid = polygonCentroid(loop);

  // SAM responds to points near an object's center, not its edge. The centroid of a
  // rough hand-drawn loop can fall outside a concave shape, so we keep it only when
  // it is actually inside the polygon and fall back to the pole of inaccessibility.
  const anchor = containsPoint(loop, centroid) ? centroid : poleOfInaccessibility(loop);

  return {
    points: [
      { ...anchor, label: 'foreground' },
      ...interiorSamples(loop, anchor, options.interiorSampleCount ?? 2),
    ],
    box,
  };
}
```

Conventions:

- `camelCase` functions and variables, `PascalCase` types, `SCREAMING_SNAKE` module consts.
- Prefer `readonly` on data that crosses a module boundary.
- No `any`. If an ONNX/WASM `.d.ts` genuinely forces one, narrow it immediately at the
  boundary and comment the specific type gap.
- Pure functions take and return plain data. Anything touching the DOM lives in `src/ui/`.
- Named exports only; no default exports.
- Errors are typed results at module boundaries where the UI must react (model load,
  decode failure), thrown only for programmer error.

---

## 7. Testing Strategy

**Framework:** Vitest, `environment: 'node'` by default; `jsdom` only for the handful of
UI modules that need it.

**Three levels, by module:**

| Level                          | Applies to                                                            | Rigor                                                 |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------- |
| Unit (TDD, red-green-refactor) | `loop-prompt`, `mask-postprocess`, `vectorize`, `svg-export`, `color` | Strict. Test written first.                           |
| Integration                    | `sam-runtime` wiring, pipeline end-to-end on a fixture image          | Smoke-level; asserts shape/ranges, not pixel equality |
| Browser                        | Every phase, via Chrome DevTools MCP                                  | Manual checklist per phase                            |

**What gets tested first, always:**

- Loop → prompt conversion: degenerate loops (2 points, self-intersecting, all-collinear),
  concave shapes where the centroid falls outside, loops partly off-canvas.
- Mask post-processing: a donut must stay a donut; speckle must vanish; the component
  containing the prompt anchor must be the one kept.
- Vectorization math: marching squares on known masks (square, circle, donut), Douglas-Peucker
  tolerance behavior, Bezier fit error bounds against synthetic curves.

**What does not need the same rigor:** canvas wiring, event plumbing, theme toggling, layout.
Those are verified in the browser.

**Coverage expectation:** ≥ 90% line coverage on `src/lib/**`. No coverage target on `src/ui/**`.

**Model is never loaded in unit tests.** `sam-runtime` is tested against a fake session
that returns fixture tensors; the real model is exercised only in browser testing.

---

## 8. Boundaries

**Always:**

- Run `npm run check` before every commit.
- One atomic commit per verifiable slice.
- Keep the stroke overlay canvas and the source-image canvas as separate layers. The
  encoder reads `sourceCanvas` only — never a composite.
- Lazy-load the model; never block first paint on it.
- Write a `docs/phase-NN.md` entry at the end of every phase.
- Sanitize SVG output before handing the user a file.

**Ask first:**

- Adding any runtime dependency beyond `onnxruntime-web`.
- Changing the model (different export, different variant, quantization level).
- Changing the vectorization approach away from the one in ADR-0005.
- Anything that changes the public shape of a `lib/` module already consumed elsewhere.

**Never:**

- Add a backend, serverless function, API key, database, or auth. If a step appears to
  need one, **stop and flag it** — we solve it client-side or cut the feature.
- Add a paid service of any kind.
- Introduce React or any UI framework.
- Send the user's image anywhere off-device.
- Commit model binaries without an explicit decision recorded (see Open Questions).
- Use `any` without a comment naming the specific type gap.
- Remove or skip a failing test to make the suite green.

---

## 9. Success Criteria

Testable conditions for "v1 is done":

**Functional**

1. Dropping or selecting a PNG/JPEG/WebP renders it on the source canvas, fit to the stage.
2. Drawing a freehand loop renders a stroke with a contrasting halo that stays legible over
   pure white, pure black, and mid-grey regions of the image, in both themes.
3. The pen palette cycles through 5 hues; the halo inverts with the active theme.
4. Completing a loop produces a SAM prompt with a bbox and ≥ 3 points, all inside the loop
   (verified by unit test, not by eye).
5. A rough loop around a clearly-separated subject returns a mask whose IoU against the
   loop's own filled polygon is > 0.5 on the fixture set (sanity bound, not accuracy target).
6. A donut-shaped mask vectorizes to an SVG path with two subpaths and `fill-rule: evenodd`.
7. "Download SVG" produces a file that opens cleanly in a browser and in Inkscape/Figma.

**Performance** (mid-range laptop, cold cache, throttled to Fast 3G for load metrics) 8. First contentful paint < 1.5s, and the app is interactive for upload/draw before the
model has finished downloading. 9. Initial JS bundle (excluding model weights and ORT WASM) < 150 KB gzipped. 10. Model download shows determinate progress; a second visit loads it from cache. 11. Encoder run < 3s and decoder run < 200ms on a 1024×1024 input.

**Robustness** 12. Model-load failure shows an actionable error with a retry, and the app stays usable
for everything that does not need the model. 13. Touch drawing works on iOS Safari and Android Chrome. 14. Keyboard: every control is reachable and operable; the canvas has a documented
keyboard-accessible alternative or an explicit, labeled limitation. 15. `npm run check` passes clean.

**Cost** 16. Total recurring cost is $0. No API keys exist in the repo or in any deployed artifact.

---

## 10. Open Questions

**Resolved at the approval gate (2026-09-18):**

1. ~~Where do the model weights come from?~~ → Fetched from the Hugging Face CDN at
   runtime and persisted via the Cache API. See
   [ADR-0004](docs/adr/0004-model-delivery-and-caching.md).
2. ~~Vectorization path?~~ → Hand-written TypeScript; `vtracer-wasm` rejected. See
   [ADR-0005](docs/adr/0005-hand-written-vectorization.md).

**Deferred to the phase that needs them:**

3. Exact MobileSAM ONNX export to pin — verified against the real artifacts at Phase 2
   start (`/source-driven-development`), not guessed now.
4. Quantization level (fp32 vs int8 encoder) — decided at the Phase 2
   `/performance-optimization` checkpoint against measured load time, not in advance.
5. Max source-image dimension for display. Working assumption: the encoder always
   receives a letterboxed 1024×1024; the display canvas caps the longest side at 2048
   to bound memory.

**Standing assumptions, confirmed at the gate:**

- Modern evergreen browsers only; no legacy fallbacks.
- Vitest for unit tests; ESLint + Prettier gate `npm run check`.
- Deploy target is GitHub Pages.
- `onnxruntime-web` is the only runtime dependency.
- One region per pass; multi-select is a v1 non-goal.
