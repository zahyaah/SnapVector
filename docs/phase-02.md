# Phase 2: MobileSAM ONNX Integration

> Status: complete · Tasks: T11-T17 · See [tasks/todo.md](../tasks/todo.md) for acceptance
> criteria and verification detail per task.

## What shipped

Real segmentation, running entirely in the browser, verified against ground truth:

- MobileSAM's ONNX artifacts pinned to an exact commit and their real tensor signature
  documented from the actual graph, not memory (T11) — see
  [docs/model-signature.md](model-signature.md).
- Image preprocessing and coordinate mapping, simplified once T11 revealed the ONNX
  graph already handles normalization and padding internally (T12).
- ONNX Runtime Web session: lazy-loaded, fetched from the pinned Hugging Face CDN
  revision with determinate progress, persisted via the Cache API (T13).
- Decoder invocation and mask thresholding, including the box-as-two-points encoding
  MobileSAM's decoder shares with Meta's original SAM ONNX export (T14).
- The full pipeline wired together: encoder on image load, decoder on loop completion,
  a translucent live mask preview, honest per-stage loading states (T15).
- A performance checkpoint that measured real numbers against SPEC's targets and made
  one confirmed trade-off explicit rather than silent (T16).

## Key decisions and findings

**Every claim in this phase is checked against the real model, not assumed from
documentation.** This phase's defining trait: at T11, T12, T13, T14, and T15, a design
decision that looked settled from documentation or a first pass turned out to need
correcting once checked against the actual ONNX graph or a real browser running the real
model. Four examples:

- T11: the encoder's preprocessing convention (normalize/pad in JS, or inside the graph?)
  was genuinely ambiguous from the export script's own flags — only reading the actual
  graph's input shape settled it.
- T13: online guidance on whether Vite auto-resolves onnxruntime-web's WASM asset was
  directly contradictory, including a reverted upstream fix attempt. Building and
  serving the real production bundle settled it empirically.
- T15: rather than eyeball whether a mask "looked about right," a fixture with known
  geometry (a circle at an exact center and radius) let the real model's output be
  checked against ground truth: **0.996 IoU**, on a loop drawn loosely around the shape,
  not tracing it.
- T16: the plan assumed COOP/COEP threading was a plausible mitigation for main-thread
  blocking. Testing it directly found it broken (a real bundler/worker incompatibility)
  and, independently, undeployable on the target host (GitHub Pages cannot set custom
  response headers) — closing off a path that looked viable on paper.

**Two modules ended up smaller than planned, for the same underlying reason.** T12 and
T14 were both scoped by the original plan to include image/mask resampling logic that
turned out to already be the ONNX graph's own job — the encoder resizes internally, and
the decoder upscales its output to `orig_im_size` internally. Both modules do less than
their task descriptions implied, once the real contract was known.

**The `onnxruntime-web/wasm` entry point, not the default import.** The default
`onnxruntime-web` import resolves to a WebGPU/WebNN-capable build this project never
uses, at roughly double the size of the plain CPU build. Switching entry points cut
~14 MB from the first-visit download with zero measured cost to correctness (identical
0.996 IoU before and after).

**The main-thread blocking finding was surfaced, not silently accepted or silently
fixed.** The encoder blocks the main thread for ~3.4s, about 13% over SPEC's 3s budget —
confirmed with the browser's own Long Task API, not estimated. The only structural fix
(cross-origin isolation to unlock WASM threading) was tested, found to have no
production path on the deploy target, and found broken in dev besides. The alternative
(a dedicated Web Worker) is real architectural scope: it would change the calling
convention of two already-tested, already-consumed modules. This was a genuine decision
point, not something to resolve unilaterally — presented to the user with a
recommendation, decided to accept for v1. Recorded in
[ADR-0006](adr/0006-performance-checkpoint.md).

## Trade-offs and deferred items

- **The 3.4s encoder block ships as-is for v1.** Revisit if a real, visually complex
  photo (rather than the flat-color test fixture) proves meaningfully worse, or at
  Phase 4 polish.
- **No quantized encoder variant exists or was produced.** The pinned model repository
  only publishes fp32 weights; producing an int8 version ourselves is deferred rather
  than undertaken speculatively, since fp32 already measures correct (0.996 IoU) and no
  ready comparison artifact exists.
- **The mask preview's fill color and alpha are fixed constants**, not yet tied to the
  theme system or configurable — acceptable for a preview whose job is to show *where*
  the mask is, not to look finished; Phase 3's actual SVG output is the real deliverable.

## Verification

- `npm run check`: typecheck, lint, 120 tests — clean.
- `npm run build`: initial JS 6.26 KB gzipped, WASM runtime 14.2 MB (down from 28.3 MB),
  both isolated in on-demand chunks separate from the initial bundle.
- `npm run a11y`: 0 axe violations, 0px horizontal overflow, all 6 configurations,
  unaffected by this phase's changes.
- Real-browser, real-model verification via Playwright for every task: a full cold load
  against the actual ~44 MB of downloaded weights (not mocked) reaching a working
  segmentation; cache-hit reload in 669ms with zero network requests; CDN-blocked error
  path with working retry; FCP measured at 628ms under Fast 3G + 4× CPU throttle; a
  geometric ground-truth check (0.996 IoU) proving the segmentation is actually correct,
  not merely correctly shaped; confirmed the encoder does not re-run on a redraw via a
  live `MutationObserver` on the status line; confirmed real main-thread blocking
  durations via the Long Task API.
