# ADR-0004: Model weights fetched from a public CDN, persisted in the Cache API

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** @zahyaah

## Context

[ADR-0003](0003-mobilesam-over-sam-vit-h.md) settles on MobileSAM ONNX — tens of
megabytes of weights that have to reach the browser somehow. Two delivery options were
on the table, and both cost $0:

1. **Vendor the `.onnx` files in `public/models/`** and serve them from the same origin
   as the app.
2. **Fetch them at runtime from a public CDN** (Hugging Face), which serves model files
   with permissive CORS and range-request support.

Option 1 adds 30–45 MB of binaries to a git repository whose source is a few hundred
kilobytes. Every clone, every CI checkout, and every history operation carries that
weight permanently, and git handles large binaries poorly. Option 2 keeps the repository
proportionate to its source but introduces a third party into the runtime path.

Either way the download happens once and should not happen again.

## Decision

Fetch the ONNX weights from the Hugging Face CDN at runtime, and persist them in the
browser's **Cache API** keyed by model URL so that subsequent visits load from disk.

The fetch is lazy — it starts after first paint, never blocking it — and reports
determinate progress by reading `Content-Length` and consuming the response body as a
stream.

Failure is treated as an expected state, not an exception. If the fetch fails, the app
surfaces an actionable error with a retry, and every feature that does not need the
model (upload, draw, theme, pen palette) keeps working.

This does not weaken [ADR-0001](0001-client-side-first-architecture.md). Downloading a
static asset from a CDN is not a backend: there is no server of ours, no API key, no
request carrying user data, and the visitor's image still never leaves their device.
Inference remains entirely local.

## Consequences

**Good**

- The repository stays small and clonable, and its history stays clean.
- No git-lfs, and no hosting provider's file-size or bandwidth limits to think about.
- The CDN's edge network is faster for most visitors than GitHub Pages serving a large
  binary from origin.
- Range-request support means a future resumable-download improvement is available
  without changing the delivery model.
- Second visits skip the network entirely.

**Bad**

- A third party sits in the runtime path. If Hugging Face is unreachable, first-time
  visitors cannot segment. Mitigated by the retry state, by the app remaining useful
  without the model, and by the cache making it a first-visit-only exposure.
- The model URL is pinned to a specific published revision, so an upstream repository
  being renamed or removed is a real failure mode. Pin by explicit revision rather than
  by branch so the artifact cannot change underneath us.
- Cache API storage can be evicted by the browser under pressure, producing an occasional
  surprise re-download. Acceptable, and invisible apart from the progress indicator.

**Neutral**

- Cache API is chosen over IndexedDB because it stores `Response` objects natively,
  which is exactly the shape a fetch produces, and it avoids manually chunking a
  multi-megabyte `ArrayBuffer` into IndexedDB records. It is not a Service Worker and
  does not require one.

## Alternatives considered

**Vendor the weights in `public/models/`.** The self-contained story is genuinely
appealing for a portfolio repository and removes the third-party runtime dependency
entirely. Rejected because 30–45 MB of binaries in git is a permanent tax on a
repository meant to be read, cloned, and reviewed. Reconsider if CDN availability ever
proves to be a real problem.

**Vendor with a CDN fallback.** Most robust at runtime, and rejected as premature for
v1: two code paths, two sources of truth to keep in sync, and all of the repository cost
of vendoring with none of its simplicity.

**IndexedDB for persistence.** Rejected — more manual work for the same result, as
above.

**Service Worker with a precache manifest.** Rejected for v1: it would enable offline
use, which is attractive, but it adds an install lifecycle and an update-and-invalidate
story for a large binary. Worth revisiting once the pipeline is stable.
