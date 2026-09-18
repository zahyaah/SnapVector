# ADR-0005: Hand-written TypeScript vectorization instead of vtracer-wasm

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** @zahyaah

## Context

The final pipeline stage turns a post-processed binary mask into SVG path data. The
obvious shortcut is vtracer, a well-regarded Rust rasteriser-to-vector tool that
compiles to WebAssembly, and the original project brief listed it as the primary path
with a hand-written TypeScript implementation as an acceptable fallback.

Examining the fit more closely inverts that preference.

vtracer is built to trace **full-colour photographs** into layered SVGs. Its pipeline
clusters pixels into colour regions, builds a hierarchy of those regions, and emits one
stacked path per colour. SnapVector's input is a **one-bit mask**. Colour clustering,
layer stacking, and hierarchy construction — the bulk of what vtracer does and the bulk
of what its WASM binary weighs — are dead weight on a two-value image.

The integration is also not free. We would hand vtracer a synthetic black-and-white
raster, receive an SVG document, parse it back out, discard its styling, and reapply our
own sampled fill colour. That is a round-trip through a text format to obtain geometry we
could have computed directly.

There is a dependency-health question too. The `vtracer-wasm` package on npm is at
0.1.0 with a single published version. That is not disqualifying by itself, but it is
thin ground for the one stage of the pipeline whose output quality the user judges
directly, and it would ship a second WASM binary alongside ONNX Runtime's.

Against that, the replacement is well-trodden. Marching squares for boundary extraction,
Douglas-Peucker for polyline simplification, and Schneider's least-squares cubic fitting
are textbook algorithms with unambiguous correctness criteria.

## Decision

Implement vectorization directly in TypeScript, as four pure modules:

| Module | Responsibility |
|---|---|
| `contours.ts` | Marching squares — mask to closed boundary polylines, outer and hole contours with consistent winding |
| `simplify.ts` | Douglas-Peucker polyline simplification |
| `bezier.ts` | Schneider least-squares cubic Bezier fitting with recursive error-driven subdivision |
| `path.ts` | Contours to SVG `d` strings, holes as subpaths under `fill-rule: evenodd` |

No `vtracer-wasm`, no `imagetracerjs`, no vectorization dependency at all.

Each module is a pure function over plain data, developed test-first per
`/test-driven-development` against synthetic masks with known-correct answers — square,
circle, donut, single-pixel speckle, mask touching the image border.

## Consequences

**Good**

- Zero bytes added to the bundle for this stage, on a page that already asks the visitor
  to download tens of megabytes of model weights.
- Direct control over the simplification tolerance, which is the single knob governing
  whether output reads as "clean vector" or "traced blob." Going through vtracer would
  mean tuning its parameters by proxy.
- The donut case — the requirement that genuinely-holed shapes survive as holes — becomes
  something we guarantee through winding order and `fill-rule: evenodd`, rather than
  something we hope a colour-clustering tracer preserves.
- Fully unit-testable with no WASM, no canvas, and no browser. The most
  algorithmically interesting code in the project ends up being the best-tested code in
  the project.
- No third-party parsing step, so no untrusted SVG enters the pipeline. This makes the
  Phase 3 output sanitisation a much smaller problem: we emit every byte ourselves.

**Bad**

- Roughly 350 lines of geometry to write and test that a dependency would have
  provided. This is the real cost, and it is paid once.
- Curve-fitting quality depends on our own tuning. A mature tracer has absorbed years of
  edge-case fixes we will rediscover. Mitigated by fixture-based tests with explicit
  error bounds.
- Marching squares has genuine subtleties — saddle-point ambiguity, contours touching the
  raster border — that are easy to get subtly wrong. These are named as explicit test
  cases rather than left to be discovered.

**Neutral**

- If the hand-written fit proves inadequate on real masks, `vtracer-wasm` remains
  available behind the same `path.ts` interface. The decision is reversible at the cost
  of one module, since nothing upstream or downstream knows how paths are produced.

## Alternatives considered

**`vtracer-wasm`.** Rejected as described: wrong problem shape, unproven package, second
WASM payload, and an SVG round-trip to recover geometry.

**`imagetracerjs`.** Pure JavaScript, no WASM, and mature at 1.2.6 — so it avoids the
binary-size objection. Rejected for the same architectural reason: it is a colour-region
tracer producing styled SVG output that we would have to parse and restyle, and its
simplification parameters are not the tolerance-in-pixels control this pipeline wants.

**Potrace via WASM.** The closest fit conceptually, since potrace is genuinely a
bitmap-to-vector tracer for one-bit images and its curve optimisation is excellent.
Rejected because the available browser ports are wrappers of varying maintenance quality,
and having settled that we are writing marching squares and Douglas-Peucker regardless,
the incremental work to add curve fitting is small.

**Emit the mask outline as a polygon with no curve fitting.** Simplest possible
implementation and genuinely acceptable for some uses. Rejected because "clean SVG
cutout" is the product promise, and a thousand-point polygon traced along pixel edges is
not a clean SVG.
