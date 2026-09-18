# ADR-0002: Vanilla TypeScript + Vite, no UI framework

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** @zahyaah

## Context

SnapVector needs a build tool and a decision about whether to use a UI framework. The
default answer in 2026 is React (or Svelte, or Solid), and reaching for one is close to
reflexive.

The relevant question is what a framework would actually buy here. SnapVector's UI is
roughly: a header with a theme toggle, a file drop zone, two stacked canvases, a small
pen-color control, a status line, and a result panel with a download button. There is
almost no derived state, no lists to reconcile, no routing, and no server state to
synchronize.

Meanwhile the substance of the project — ONNX Runtime Web session management, canvas
pixel manipulation, tensor preprocessing, marching squares, curve fitting — lives
entirely outside the framework's model. Canvas and WASM work is imperative by nature and
sits awkwardly inside a declarative render cycle, typically ending up quarantined in
refs and effects that exist only to opt out of the framework.

## Decision

Vanilla TypeScript with Vite. No React, no Svelte, no framework of any kind. Plain DOM
APIs, plain CSS with custom properties.

TypeScript runs in `strict` mode. `any` is disallowed except where an ONNX or WASM type
definition genuinely forces it, and each such case carries a comment naming the specific
type gap.

## Consequences

**Good**

- The shipped JS is essentially all application code. The Phase 1 bundle budget of
  150 KB gzipped is comfortable rather than tight, which matters when the model download
  is already the expensive part of the page.
- No framework mental-model tax layered on top of the canvas/WASM work that is the real
  difficulty here.
- Imperative canvas code is written imperatively, without effect hooks and refs
  wrapping it to escape a render cycle.
- The `lib/` modules are plain functions over plain data with no framework imports, so
  they unit-test in Node with no DOM, no jsdom, and no component test harness.
- Zero framework churn. The code will still build in five years.

**Bad**

- DOM updates are manual. Every place the UI reflects state, we write the update by
  hand, and a missed update is a bug a framework would have prevented.
- No component model, so reuse and encapsulation are conventions we enforce rather than
  guarantees the tool provides. Mitigated by the `src/ui/` module boundary: anything
  touching the DOM lives there, everything else is pure.
- If the UI grows well past v1 scope — multi-region editing, a layer panel, undo history
  with a real state tree — this decision would need revisiting. That is a v2 problem and
  a v2 rewrite of `src/ui/` only, because `lib/` has no framework coupling either way.

**Neutral**

- Vite itself is uncontroversial: fast dev server, native ESM, first-class TypeScript,
  and Vitest shares its config so the test setup costs nothing extra.

## Alternatives considered

**React.** Rejected: the largest mental-model and bundle cost for the least benefit
given a UI this thin, and the worst fit for imperative canvas work.

**Svelte or Solid.** Rejected for the same reason at a smaller magnitude. Both are
lighter than React and would have been defensible, but "lighter framework we still do
not need" is not a reason to add a framework.

**Lit / Web Components.** Rejected: attractive for encapsulation without a runtime
framework, but it adds a decorator-and-shadow-DOM model for a handful of controls, and
shadow DOM complicates the CSS-custom-property theming in
[the theme system](../../SPEC.md#3-tech-stack) for no gain.

**Plain HTML + script tags, no build step.** Rejected: `onnxruntime-web` needs bundling
for its WASM asset paths, and we want TypeScript's strictness across the geometry code.
