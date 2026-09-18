# Implementation Plan: SnapVector

> Derived from [SPEC.md](../SPEC.md) · Tasks in [todo.md](todo.md) · 2026-09-18

## Overview

Build a static single-page app that takes an uploaded image plus a rough freehand loop,
runs MobileSAM in the browser to turn that loop into a segmentation mask, and vectorizes
the mask into a downloadable SVG cutout. Four phases, 33 tasks, no backend at any point.

The build order is driven by one structural fact: four of the six modules are pure
functions over plain data. Those get written test-first and verified without a browser,
a canvas, or a model. Everything that touches the DOM or ONNX Runtime is thin wiring on
top, verified in a real browser instead.

## Architecture Decisions

All five decisions are recorded in [docs/adr/](../docs/adr/README.md). In brief:

- **Client-side-first, zero backend** ([ADR-0001](../docs/adr/0001-client-side-first-architecture.md)) — the founding constraint. Inference in the visitor's browser makes hosting free forever and makes the privacy claim structural rather than a promise.
- **Vanilla TS + Vite** ([ADR-0002](../docs/adr/0002-vanilla-typescript-and-vite.md)) — the UI is thin; the canvas and WASM work is imperative and sits badly inside a render cycle. `lib/` ends up framework-free and testable in Node.
- **MobileSAM over ViT-H** ([ADR-0003](../docs/adr/0003-mobilesam-over-sam-vit-h.md)) — 600 MB of weights is not a download. The encoder embedding is cached per image so redrawing the loop re-runs only the cheap decoder.
- **Weights from the HF CDN, cached via Cache API** ([ADR-0004](../docs/adr/0004-model-delivery-and-caching.md)) — keeps the repo proportionate to its source; first visit downloads, later visits do not.
- **Hand-written vectorization** ([ADR-0005](../docs/adr/0005-hand-written-vectorization.md)) — vtracer traces full-colour rasters; we have a one-bit mask. Marching squares + Douglas-Peucker + Schneider fit adds zero bundle bytes and makes the donut case ours to guarantee.

## Dependency Graph

```
    Toolchain (T1)
        │
        ├── Theme + brand tokens (T2) ── Layout shell (T3) ── Stage + image load (T4)
        │                                                          │
        │                                                          ├── Stroke overlay (T7)
        │                                                          │       │
        ├── geometry/loop.ts (T5) ── geometry/prompt.ts (T6) ──────┴── Loop→prompt wiring (T8)
        │        [pure, no DOM]           [pure, no DOM]                     │
        │                                                                    │
        │                          MobileSAM export pinned (T11)             │
        │                                    │                               │
        │                     sam/preprocess (T12) ── sam/session (T13)      │
        │                                    │             │                 │
        │                                    └── sam/decode (T14) ───────────┴── Mask preview (T15)
        │                                                                          │
        └── mask/binary-mask (T18) ── mask/postprocess (T19) ─────────────────────┘
                     │                        │
                     │              vectorize/contours (T20)
                     │                        │
                     │              vectorize/simplify (T21)
                     │                        │
                     │              vectorize/bezier (T22)
                     │                        │
              color/sample (T24)     vectorize/path (T23)
                     │                        │
                     └──────── svg/document + sanitize (T25) ── result-panel (T26)
```

## Slicing Strategy

Each phase ends with something demonstrable in a browser, not with a layer completed:

- **Phase 1** ends with: upload an image, draw a loop, see the derived bounding box and prompt points drawn on the overlay. No model involved. This proves the entire input path before a single megabyte of weights is downloaded.
- **Phase 2** ends with: draw a loop, see a live mask preview. The mask is still raster.
- **Phase 3** ends with: that mask becomes a downloadable SVG.
- **Phase 4** hardens all of it.

The high-risk unknown — whether the MobileSAM ONNX artifact has the input and output
signature we expect — is pulled to the front of Phase 2 as a research-only task (T11)
with no code attached, so it fails cheaply if it fails.

## Checkpoints

| After | Gate                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T10   | Phase 1: `npm run check` clean, loop→prompt verified in browser, design pass done, `docs/phase-01.md` written. **Human review.**          |
| T17   | Phase 2: mask preview works in browser, performance budget met or consciously renegotiated, `docs/phase-02.md` written. **Human review.** |
| T27   | Phase 3: full pipeline produces a downloadable SVG that opens in Inkscape/Figma, `docs/phase-03.md` written. **Human review.**            |
| T33   | Complete: every Success Criterion in SPEC §9 demonstrably met, deployed, `docs/phase-04.md` written.                                      |

## Parallelization

- **Safe to parallelize:** T20–T24 (contours, simplify, bezier, path, colour sampling) are independent pure modules sharing only a `BinaryMask` type. Once T19 lands, they can be built in any order or concurrently.
- **Must be sequential:** T1→T2→T3→T4 (toolchain then shell then stage), T11→T12/T13→T14 (pin the model before writing against its signature), T25→T26 (SVG assembly before the panel that renders it).
- **Needs coordination:** T5/T6 define the `Polygon` and `SamPrompt` types consumed by both the overlay and the SAM layer. Land those types first; they are the contract everything else is written against.

## Risks and Mitigations

| Risk                                                                                                           | Impact                         | Mitigation                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MobileSAM ONNX export's tensor names/shapes differ from what we assume                                         | **High** — invalidates T12/T14 | T11 is a research-only task that inspects the real artifact and records the actual signature before any code is written against it (`/source-driven-development`) |
| ~~ORT Web's WASM asset paths break under a Vite production build~~ **RESOLVED at T13** | ~~High~~ | Verified against the real build+preview with Playwright: Vite's static analysis of `ort.bundle.min.mjs` correctly detected and hashed the WASM asset with no manual `wasmPaths` config needed. Zero 404s, full real-network model load succeeded |
| Encoder blocks the main thread and freezes the UI for seconds                                                  | Medium                         | Measure at T16; move the session to a Web Worker if jank is visible. `lib/sam/` is already isolated behind an async interface so this does not ripple             |
| Model download too slow to meet the Fast 3G target                                                             | Medium                         | T16 decides quantization against measurements; int8 encoder is the lever                                                                                          |
| Marching squares saddle-point ambiguity produces self-touching contours                                        | Medium                         | Named explicitly as a T20 fixture case, tested before it is a bug                                                                                                 |
| Bezier fit quality is visibly poor on real masks                                                               | Medium                         | Error-bounded fit with recursive subdivision; tolerance is a tunable constant. Polyline output is the degraded fallback                                           |
| ORT Web blows the 150 KB bundle budget                                                                         | Medium                         | Dynamic-import `lib/sam/` so it is a separate chunk outside the initial bundle; audited at T16                                                                    |
| Hugging Face CDN unreachable on a visitor's first load                                                         | Medium                         | Retry UI (T28); app stays usable for everything not needing the model                                                                                             |
| Cache API eviction causes surprise re-download                                                                 | Low                            | Accepted. Invisible apart from the progress indicator                                                                                                             |
| Hand-written vectorization takes longer than budgeted                                                          | Low                            | Contained: `path.ts` is an interface, and `vtracer-wasm` remains available behind it if the estimate proves wrong                                                 |

## Open Questions

None blocking. Two decisions are deliberately deferred to the phase that can measure them:

- Exact MobileSAM ONNX artifact and revision to pin → resolved by **T11**.
- Encoder quantization level (fp32 vs int8) → resolved by **T16** against measured load time and fixture mask quality.
