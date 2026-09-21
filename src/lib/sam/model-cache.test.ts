import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchModelWeights } from './model-cache.js';

// The Cache API doesn't exist in Node's test environment. Stubbing it as always
// rejecting exercises the same "Cache API unavailable" fallback path real private-
// browsing sessions hit, and keeps every test here focused on the fetch/stream
// behavior rather than caching.
function stubCachesUnavailable(): void {
  vi.stubGlobal('caches', {
    open: () => Promise.reject(new Error('Cache API unavailable in this environment')),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchModelWeights', () => {
  it('returns the concatenated bytes from a normal streamed download', async () => {
    stubCachesUnavailable();
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    let index = 0;
    const reader = {
      read: () =>
        Promise.resolve(
          index < chunks.length
            ? { done: false, value: chunks[index++]! }
            : { done: true, value: undefined },
        ),
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => '5' },
        clone: () => ({}) as Response,
        body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
      } as unknown as Response),
    );

    const result = await fetchModelWeights('https://example.invalid/model.onnx');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.value)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    }
  });

  it('returns a network-error Result rather than rejecting when fetch() itself throws', async () => {
    stubCachesUnavailable();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));

    const result = await fetchModelWeights('https://example.invalid/model.onnx');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('returns an http-error Result for a non-ok response', async () => {
    stubCachesUnavailable();
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 404 } as unknown as Response),
    );

    const result = await fetchModelWeights('https://example.invalid/model.onnx');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'http-error', status: 404 });
  });

  it('returns a network-error Result rather than rejecting when the connection drops mid-stream', async () => {
    // The regression case: the connection fails AFTER the response headers already
    // arrived (fetch() resolved, response.ok is true) but DURING the body stream —
    // what a real dropped connection partway through a ~40MB model download looks
    // like, distinct from fetch() itself rejecting (covered above). Before the fix,
    // this rejection propagated straight out of fetchModelWeights instead of becoming
    // a Result, which would have surfaced in the app as a permanently stuck loading
    // state with no error message and no working retry.
    stubCachesUnavailable();
    let readCount = 0;
    const reader = {
      read: () => {
        readCount++;
        if (readCount === 1) {
          return Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) });
        }
        return Promise.reject(
          new Error('network error mid-stream (simulated connection reset)'),
        );
      },
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        clone: () => ({}) as Response,
        body: { getReader: () => reader } as unknown as ReadableStream<Uint8Array>,
      } as unknown as Response),
    );

    const result = await fetchModelWeights('https://example.invalid/model.onnx');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });
});
