import { err, ok, type Result } from '../result.js';

export type ModelLoadError =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http-error'; readonly status: number }
  | { readonly kind: 'cache-unavailable' };

// Versioned so a future change to what gets cached (e.g. switching to a quantized
// weight file, per the open question in docs/model-signature.md) doesn't collide with
// bytes cached under the old scheme.
const CACHE_NAME = 'snapvector-models-v1';

export interface DownloadProgress {
  readonly loadedBytes: number;
  /** Null when the server didn't send Content-Length — render an indeterminate state
   * rather than a fabricated percentage. */
  readonly totalBytes: number | null;
}

/**
 * Fetches a model file, serving from the Cache API on a repeat visit and reporting
 * progress via streamed reads on a cold one. The Cache API is used over IndexedDB
 * because it stores `Response` objects natively — exactly what `fetch` produces — with
 * no manual chunking of a multi-megabyte ArrayBuffer into IndexedDB records. See
 * ADR-0004.
 */
export async function fetchModelWeights(
  url: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Result<ArrayBuffer, ModelLoadError>> {
  // Cache API can be unavailable in private-browsing modes in some browsers. Falling
  // through to an uncached fetch keeps the app usable; only persistence is lost.
  const cache: Cache | null = await caches.open(CACHE_NAME).catch(() => null);

  const cached = await cache?.match(url).catch(() => undefined);
  if (cached) {
    return ok(await cached.arrayBuffer());
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    return err({
      kind: 'network',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) {
    return err({ kind: 'http-error', status: response.status });
  }

  // Cache the pristine response before consuming its body ourselves — cloning after a
  // manual stream read would require reconstructing headers/status by hand instead.
  if (cache) {
    void cache.put(url, response.clone()).catch(() => {
      // A failed cache write costs the next visit a re-download, nothing more.
    });
  }

  const totalBytes = Number(response.headers.get('content-length')) || null;
  const reader = response.body?.getReader();
  if (!reader) {
    return ok(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress?.({ loadedBytes, totalBytes });
    }
  } catch (error) {
    // A connection can drop after the response headers already arrived (fetch()
    // resolved, response.ok was true) but before the body finishes streaming — a
    // genuine "fail mid-download" network interruption, distinct from fetch() itself
    // rejecting (already handled above). Without this, the rejection would propagate
    // uncaught past this function's Result-returning contract.
    return err({
      kind: 'network',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const merged = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(merged.buffer);
}
