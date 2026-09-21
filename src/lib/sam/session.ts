import * as ort from 'onnxruntime-web/wasm';

import { ok, type Result } from '../result.js';
import { DECODER_MODEL_URL, ENCODER_MODEL_URL } from './model-urls.js';
import {
  fetchModelWeights,
  type DownloadProgress,
  type ModelLoadError,
} from './model-cache.js';

export interface SamSession {
  readonly encoder: ort.InferenceSession;
  readonly decoder: ort.InferenceSession;
}

export interface SamSessionOptions {
  readonly onProgress?: (stage: 'encoder' | 'decoder', progress: DownloadProgress) => void;
}

/**
 * Loads both weight files and constructs both sessions. Called once, lazily, after
 * first paint (SPEC §8: never block on model load) — the caller decides when "lazily"
 * means, this function just does the work when asked.
 */
export async function createSamSession(
  options: SamSessionOptions = {},
): Promise<Result<SamSession, ModelLoadError>> {
  const encoderBytes = await fetchModelWeights(ENCODER_MODEL_URL, (progress) =>
    options.onProgress?.('encoder', progress),
  );
  if (!encoderBytes.ok) return encoderBytes;

  const decoderBytes = await fetchModelWeights(DECODER_MODEL_URL, (progress) =>
    options.onProgress?.('decoder', progress),
  );
  if (!decoderBytes.ok) return decoderBytes;

  const [encoder, decoder] = await Promise.all([
    ort.InferenceSession.create(encoderBytes.value, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(decoderBytes.value, { executionProviders: ['wasm'] }),
  ]);

  return ok({ encoder, decoder });
}
