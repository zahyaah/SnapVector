# ADR-0001: Client-side-first, zero-backend architecture

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** @zahyaah

## Context

SnapVector segments a user-selected region of an uploaded image and returns an SVG
cutout. The obvious implementation is a server: accept an upload, run SAM on a GPU,
return the result. Every comparable product does this — remove.bg, Adobe's trace
service, Meta's own SAM demo all run inference server-side.

That architecture has a cost curve that goes up and to the right with usage. A GPU
instance capable of serving SAM costs real money per month whether anyone uses it or
not, and each additional user makes it more expensive. For a portfolio project that
should stay online indefinitely with no attention, that is a liability rather than an
asset.

Two things make the server avoidable. SAM's encoder and mask decoder can be exported to
ONNX and executed in a browser through `onnxruntime-web` (WASM, with WebGL/WebGPU
backends available). And contour tracing plus curve fitting is ordinary computational
geometry that runs perfectly well in TypeScript on the main thread or a worker.

## Decision

All image processing, inference, and vectorization runs in the visitor's browser. The
deployed artifact is a static site: HTML, CSS, JS, and model weights. There is no
server, no serverless function, no database, no authentication, and no API key
anywhere in the system.

This is a hard constraint, not a preference. If a feature appears to require a backend,
the feature gets cut or redesigned — the architecture does not bend.

## Consequences

**Good**

- Hosting cost is $0 at any traffic level, forever. Static hosting on GitHub Pages,
  Vercel, or Netlify is free and effectively unlimited for this payload.
- The user's image never leaves their device. This is a genuine privacy property, not a
  policy promise, and it is the single most credible differentiator against remove.bg.
- No operational surface: nothing to patch, rotate, monitor, or pay for. No secrets
  exist, so no secrets can leak.
- The project stays deployable and demoable years from now without maintenance.

**Bad**

- We inherit the user's hardware. A slow laptop means slow inference, and we cannot fix
  that by scaling up. This forces the smaller-model decision in
  [ADR-0003](0003-mobilesam-over-sam-vit-h.md).
- Model weights must be downloaded to the client — tens of megabytes on first visit.
  Mitigated by lazy loading, determinate progress UI, and Cache API persistence
  ([ADR-0004](0004-model-delivery-and-caching.md)).
- No server-side telemetry. We cannot observe failures in the field without adding a
  third-party analytics dependency, which we are not doing for v1.
- Mask quality is capped by what a distilled model can do in WASM. We are trading
  accuracy for reach and cost, deliberately.

**Neutral**

- Everything is inspectable in DevTools, which is excellent for debugging and means the
  implementation is fully legible to anyone reviewing the repo.

## Alternatives considered

**Server-side SAM on a GPU instance.** Best mask quality, fast inference, small client
payload. Rejected: violates the founding constraint. Cost scales with users, requires
ongoing operation, and destroys the privacy story.

**Hybrid — client-side by default, server fallback for large images.** Rejected: a
fallback path that exists is a path that must be paid for and maintained. It also
reintroduces the upload privacy question, which then has to be explained rather than
simply being absent.

**Free-tier inference API (Hugging Face Inference, Replicate).** Rejected: requires an
API key, which cannot be shipped in a static client without exposing it. Free tiers
also rate-limit and change terms, so the "$0 forever" property would not survive.
