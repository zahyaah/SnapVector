# ADR-0003: MobileSAM ONNX over full SAM ViT-H

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** @zahyaah

## Context

[ADR-0001](0001-client-side-first-architecture.md) puts inference in the visitor's
browser, which makes model size and inference latency user-facing costs rather than
infrastructure ones. Every megabyte of weights is a megabyte the visitor downloads
before the app does anything useful, and every second of encoder time is a second they
spend watching a spinner on whatever hardware they happen to own.

Segment Anything's architecture splits cleanly for this. The heavy image encoder runs
once per image and produces an embedding; the mask decoder runs per prompt against that
embedding and is tiny by comparison. Only the encoder is a size problem.

The encoder options differ by roughly an order of magnitude. SAM ViT-H is around 600 MB
of weights — plainly unusable as a browser download. ViT-B is smaller but still far too
large. MobileSAM replaces SAM's ViT encoder with a distilled TinyViT trained to
reproduce the original encoder's embeddings, landing in the tens of megabytes while
keeping the decoder bit-compatible with SAM's.

SnapVector's input also changes the accuracy calculus. The user draws a rough loop, so
we hand the model both a bounding box and several interior points. A box-plus-points
prompt is far more constrained than the single ambiguous click that exposes the biggest
quality gap between full SAM and its distilled variants. We are asking an easier
question than the SAM demo asks.

Finally, the mask is not the deliverable. It is an intermediate that gets hole-filled,
morphologically smoothed, contour-traced, simplified with a Douglas-Peucker tolerance,
and fitted to Bezier curves. That pipeline discards exactly the kind of single-pixel
boundary precision that separates ViT-H from MobileSAM.

## Decision

Use MobileSAM's ONNX export, encoder and decoder as separate model files, loaded and run
through `onnxruntime-web`.

The encoder runs once per uploaded image and its embedding is held in memory, so
redrawing the loop re-runs only the decoder. That is what makes iteration feel
interactive: the expensive step is paid once per image, not once per attempt.

Two things are deliberately **not** decided here and are deferred to the phase that can
measure them:

- The exact published ONNX artifact to pin. Verified against the real files at Phase 2
  start rather than guessed from memory.
- Quantization level (fp32 vs int8 encoder). Decided at the Phase 2
  `/performance-optimization` checkpoint against measured load time and mask quality on
  the fixture set, not in advance.

## Consequences

**Good**

- Encoder weights drop from ~600 MB to tens of megabytes, which is the difference
  between impossible and merely expensive.
- Meets the Phase 2 performance targets: encoder under 3s, decoder under 200ms on a
  1024×1024 input.
- The decoder stays SAM-compatible, so the prompt format, the 1024×1024 letterboxed
  input convention, and the logits-to-mask thresholding are all standard SAM behavior.
  Reference material and exported artifacts from the SAM ecosystem apply directly.
- Caching the embedding makes loop redraws nearly instant, which is the interaction that
  most affects how the app feels.

**Bad**

- Mask quality is measurably below ViT-H on hard cases: thin structures, hair, fine
  transparency, low-contrast boundaries. We accept this, and the vectorization stage
  partly masks it.
- We are dependent on a third-party ONNX export being correct. Mitigated by verifying
  input and output tensor names and shapes against the actual artifact at Phase 2 start
  rather than assuming them.
- Distilled models can fail in ways the original does not, and we have no server-side
  telemetry to observe it. The loop input bounds the damage: the prompt is strongly
  constrained, so catastrophic mis-segmentation is unlikely.

**Neutral**

- EdgeSAM is a comparable distillation. If MobileSAM's measured numbers disappoint at
  the Phase 2 checkpoint, swapping it is contained to `src/lib/sam/`, because the rest
  of the pipeline consumes a binary mask and knows nothing about the model.

## Alternatives considered

**SAM ViT-H or ViT-B.** Rejected on download size alone. No amount of caching makes a
600 MB first visit acceptable, and ViT-B is still multiples of the MobileSAM budget.

**EdgeSAM.** Viable and close in spirit. MobileSAM chosen for the more established ONNX
export path and its decoder's direct SAM compatibility. Kept as the fallback if Phase 2
measurements go badly.

**Classical segmentation — GrabCut or watershed seeded from the loop.** Genuinely
tempting: zero model download, pure TypeScript, instant. Rejected because it degrades
badly on exactly the cluttered, low-contrast images where a user most wants help, and
because "it runs a real segmentation model in your browser" is a substantial part of
what this project is demonstrating. Worth revisiting as an instant-preview mode that
renders while the model downloads.

**`@huggingface/transformers` (transformers.js) instead of raw `onnxruntime-web`.**
Rejected for v1: it wraps the same runtime with convenient model loading, but adds a
dependency and hides the session, tensor, and caching details we specifically want
direct control over for the performance work in Phase 2.
