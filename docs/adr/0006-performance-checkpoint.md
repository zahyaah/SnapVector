# ADR-0006: Phase 2 performance checkpoint — WASM variant, budgets, and the main-thread question

- **Status:** Accepted (WASM variant switch); main-thread mitigation deferred — see Open Question
- **Date:** 2026-09-20
- **Deciders:** @zahyaah

## Context

T16 is the plan's performance checkpoint: measure against SPEC §9's targets before moving
into Phase 3, and decide the fp32-vs-quantization question ADR-0003 deferred here. Every
number below is measured against the real production build and the real downloaded
MobileSAM artifacts (Playwright + CDP, `docs/model-signature.md`'s pinned commit) — none
of it is estimated.

## Measurements

| Target (SPEC §9) | Measured | Result |
|---|---|---|
| Initial JS chunk < 150 KB gzipped | 6.26 KB gzipped | **Pass, wide margin** |
| FCP < 1.5s (Fast 3G, 4× CPU throttle) | 628 ms | **Pass** |
| Interactive before model ready | Confirmed: file input usable while `#model-status` still reads "Loading…" | **Pass** |
| Encoder < 3s on 1024×1024 | **3384 ms** single main-thread block | **Fails by ~13%** |
| Decoder < 200ms | 194 ms single main-thread block | **Pass, 3% margin** |
| Second visit loads from cache | 669 ms, zero network requests (measured at T13) | **Pass** |

Encoder/decoder timing measured via the browser's own `PerformanceObserver` for
`longtask` entries — not wall-clock bracketing around async calls, which an earlier
attempt showed gives misleading numbers depending on exactly when the timer starts
relative to in-flight async work. Long tasks are the browser's own record of exactly how
long the main thread was blocked, independent of how a test script measures it.

## Decision 1: `onnxruntime-web/wasm` instead of the default bundle export

The default `onnxruntime-web` import (used since T13) resolves to the **jsep** WASM
build — 28.3 MB, bundled with WebGPU/WebNN support this project has no use for.
Switching every import site to `onnxruntime-web/wasm` (CPU-only) drops that to the plain
build:

| | jsep (default) | wasm (CPU-only) |
|---|---|---|
| WASM binary | 28.3 MB | 14.2 MB |
| Vendor JS bundle | 403 KB (109 KB gzip) | 71 KB (23.5 KB gzip) |

Segmentation correctness was re-verified after the switch, not assumed: the same
circle-fixture IoU check from T15 (0.996 against known geometry) produced an **identical
0.996** with the smaller build. Total first-visit download drops by roughly 14 MB with
no measured cost.

## Decision 2: quantization

No int8 (or any non-fp32) variant of the MobileSAM encoder exists in the pinned
`Acly/MobileSAM` repository (confirmed at T11). Producing one would mean running
`onnxruntime.quantization.quantize_dynamic` ourselves — the export script in that same
repository shows the exact call — and then separately verifying accuracy didn't
regress, since quantization is not free of quality cost. **Deferred, not rejected**:
worth revisiting if the encoder's 3.4s becomes a harder blocker than it is today, but
not undertaken speculatively for v1 given fp32 already produces correct results
(0.996 IoU) and no ready-made artifact exists to compare against.

## Investigated and rejected: cross-origin isolation for WASM threading

The 3.4s encoder block is single-threaded: `onnxruntime-web`'s threaded WASM build
requires `crossOriginIsolated === true` (COOP/COEP response headers), without which it
silently runs on one thread. This was tested directly, not assumed:

Adding `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
require-corp` to Vite's dev/preview server made `window.crossOriginIsolated` true (with
`navigator.hardwareConcurrency` reporting 8 cores available), but **broke model loading
entirely** — the threaded build's spawned pthread-emulation workers throw
`ReferenceError: document is not defined`, a genuine incompatibility between this
onnxruntime-web build's worker bootstrap and Vite's bundling of it. T13 hit and resolved
a similar class of bundler/WASM friction for the non-threaded path; the threaded path
has its own, unresolved version of it.

Separately and more decisively: **GitHub Pages, the deploy target (ADR-0001), cannot
set custom response headers at all.** Even if the Vite/worker bug were fixed, there is
no way to ship COOP/COEP to production on this hosting target without adding a layer
(a service worker intercepting navigation to inject headers, or moving off GitHub
Pages) that ADR-0001's zero-infrastructure reasoning argues against. This closes the
option off independent of whether it could be made to work in dev.

## Open Question: the 3.4s single-threaded encoder block

The encoder blocks the main thread for ~3.4 seconds on the test image (a simple 800×600
synthetic fixture; a more visually complex real photo at full 1024×1024 could plausibly
take longer). During that window the page is fully unresponsive — no clicks, no
scrolling, no animation — which is exactly the risk [tasks/plan.md](../../tasks/plan.md)'s
risk register flagged before Phase 2 began.

Two paths forward, not decided in this ADR:

1. **Accept for v1.** The overage is modest (~13%), the loading state is already honest
   and communicates what's happening (T15), and the only structural fix available
   (cross-origin isolation) has no production path on this host. A future host migration
   could revisit this.
2. **Move inference to a dedicated Web Worker.** Genuinely eliminates the UI freeze
   regardless of how long inference takes, by moving the blocking work off the main
   thread entirely — independent of, and a real alternative to, ONNX Runtime's own
   internal threading. This is a real architectural change: `session.ts` and `decode.ts`
   are consumed directly by `main.ts` today (SPEC's "ask first" boundary: changing the
   public shape of an already-consumed `lib/` module), and a worker-based design
   replaces direct async function calls with message-passing.

Recorded as open pending the human decision this ADR's companion conversation surfaces,
rather than picked unilaterally given the scope difference between the two paths.
