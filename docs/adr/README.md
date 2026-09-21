# Architecture Decision Records

| # | Decision | Status |
|---|---|---|
| [0001](0001-client-side-first-architecture.md) | Client-side-first, zero-backend architecture | Accepted |
| [0002](0002-vanilla-typescript-and-vite.md) | Vanilla TypeScript + Vite, no UI framework | Accepted |
| [0003](0003-mobilesam-over-sam-vit-h.md) | MobileSAM ONNX over full SAM ViT-H | Accepted |
| [0004](0004-model-delivery-and-caching.md) | Model weights from a public CDN, persisted in the Cache API | Accepted |
| [0005](0005-hand-written-vectorization.md) | Hand-written TypeScript vectorization instead of vtracer-wasm | Accepted |
| [0006](0006-performance-checkpoint.md) | Phase 2 performance checkpoint: WASM variant, quantization, main-thread question | Accepted (partial) |

Each record states the context that forced the decision, the decision itself, what it
costs us, and what was rejected and why. They are append-only: a superseded decision
gets a new record that references it, rather than an edit.
