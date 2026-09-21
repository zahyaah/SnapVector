import { loopToSamPrompt, type SamPrompt } from './lib/geometry/prompt.js';
import { encoderInputSize, pixelsToEncoderTensor } from './lib/sam/preprocess.js';
import { buildResultSvg } from './lib/svg/pipeline.js';
import { sanitizeFilename } from './lib/svg/sanitize.js';
import { createResultPanel } from './ui/result-panel.js';
import { createStage } from './ui/stage.js';
import { createStatusLine } from './ui/status.js';
import { createStrokeOverlay } from './ui/stroke-overlay.js';
import { createThemeController } from './ui/theme.js';
import { wireStageControls } from './ui/controls.js';

import type { BinaryMaskResult, RunnableSession } from './lib/sam/decode.js';
import type * as OrtNamespace from 'onnxruntime-web/wasm';

type OrtTensor = OrtNamespace.Tensor;

// What this module actually needs from the lazily-loaded SAM modules, named locally
// rather than importing session.ts's or decode.ts's own types directly — those modules
// (and onnxruntime-web itself) are dynamically imported so the ONNX runtime stays out
// of the initial bundle (SPEC's performance budget). A type-only import would be erased
// at compile time regardless, but naming the shape here keeps this file readable
// without cross-referencing two other files for what "sam" holds.
interface LoadedSam {
  readonly encoder: RunnableSession;
  readonly decoder: RunnableSession;
  readonly runEncoder: (
    session: RunnableSession,
    tensor: { data: Float32Array; dims: readonly [number, number, number] },
  ) => Promise<OrtTensor>;
  readonly runDecoder: (
    session: RunnableSession,
    embedding: OrtTensor,
    prompt: SamPrompt,
    sourceSize: { width: number; height: number },
  ) => Promise<BinaryMaskResult>;
}

const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
if (themeToggle) {
  createThemeController(document.documentElement, themeToggle);
}

const stagePanel = document.querySelector<HTMLElement>('.stage-panel');
const stageEl = stagePanel?.querySelector<HTMLElement>('.stage');
const modelStatusEl = document.querySelector<HTMLElement>('#model-status');
const inferenceStatusEl = stagePanel?.querySelector<HTMLElement>('.inference-status');

function formatProgress(loadedBytes: number, totalBytes: number | null): string {
  const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
  return totalBytes === null
    ? `${mb(loadedBytes)} MB loaded`
    : `${mb(loadedBytes)} / ${mb(totalBytes)} MB (${String(Math.round((loadedBytes / totalBytes) * 100))}%)`;
}

function formatConfidence(iou: number): string {
  return `${String(Math.round(iou * 100))}%`;
}

if (stagePanel && stageEl && modelStatusEl && inferenceStatusEl) {
  const stage = createStage(stageEl);
  const penSwatch = stagePanel.querySelector<HTMLElement>('.pen-swatch');
  const debugToggle = stagePanel.querySelector<HTMLButtonElement>('.debug-toggle');
  const strokeOverlay = createStrokeOverlay(stage, penSwatch ?? undefined);
  const modelStatusNode = modelStatusEl;
  const modelStatus = createStatusLine(modelStatusNode);
  const inferenceStatus = createStatusLine(inferenceStatusEl);
  const resultPanelEl = document.querySelector<HTMLElement>('.result-panel');
  const resultPanel = resultPanelEl ? createResultPanel(resultPanelEl) : null;

  let debugEnabled = false;
  let latestPrompt: SamPrompt | null = null;
  let sam: LoadedSam | null = null;
  let currentEmbedding: OrtTensor | null = null;
  let uploadFilename = 'snapvector-export.svg';

  // Bumped whenever the loaded image changes. An in-flight encoder call captures the
  // generation it started with and checks it again on completion — if a newer image
  // has replaced the one it was encoding, it discards its result instead of caching an
  // embedding for an image that is no longer on screen.
  let imageGeneration = 0;

  async function encodeCurrentImage(): Promise<void> {
    if (sam === null || stage.sourceSize === null) return;
    const myGeneration = imageGeneration;
    const sourceSize = stage.sourceSize;

    inferenceStatus.set('Preparing image for segmentation…', 'busy');
    try {
      const targetSize = encoderInputSize(sourceSize);
      const pixels = stage.readResizedSourcePixels(targetSize);
      if (pixels === null) return;

      const tensor = pixelsToEncoderTensor(pixels);
      const embedding = await sam.runEncoder(sam.encoder, tensor);

      if (myGeneration !== imageGeneration) return; // a newer image replaced this one
      currentEmbedding = embedding;
      inferenceStatus.set('Ready — draw a loop to segment it');
    } catch {
      if (myGeneration !== imageGeneration) return;
      inferenceStatus.set('Could not prepare this image for segmentation.', 'error');
    }
  }

  async function decodeCurrentLoop(prompt: SamPrompt): Promise<void> {
    if (sam === null || currentEmbedding === null || stage.sourceSize === null) {
      inferenceStatus.set('Still preparing the model — try drawing again in a moment.');
      return;
    }
    const myGeneration = imageGeneration;

    inferenceStatus.set('Segmenting…', 'busy');
    try {
      const mask = await sam.runDecoder(
        sam.decoder,
        currentEmbedding,
        prompt,
        stage.sourceSize,
      );
      if (myGeneration !== imageGeneration) return; // the image changed mid-decode
      stage.setMaskPreview(mask);
      inferenceStatus.set(`Segmented (confidence ${formatConfidence(mask.iou)})`);

      const sourcePixels = stage.readSourcePixels();
      const svg = sourcePixels ? buildResultSvg(mask, prompt.points[0]!, sourcePixels) : null;
      if (svg) {
        resultPanel?.showResult(svg, sanitizeFilename(uploadFilename));
      } else {
        resultPanel?.clear();
      }
    } catch {
      if (myGeneration !== imageGeneration) return;
      inferenceStatus.set('Could not segment that loop.', 'error');
      resultPanel?.clear();
    }
  }

  strokeOverlay.onLoopComplete((loop) => {
    if (stage.sourceSize === null) return;

    const result = loopToSamPrompt(loop, stage.sourceSize);
    latestPrompt = result.ok ? result.value : null;
    strokeOverlay.setDebugPrompt(debugEnabled ? latestPrompt : null);

    if (latestPrompt) void decodeCurrentLoop(latestPrompt);
  });

  wireStageControls(stagePanel, stage, {
    onImageLoaded: (file) => {
      imageGeneration++;
      currentEmbedding = null;
      uploadFilename = file.name;
      resultPanel?.clear();
      void encodeCurrentImage();
    },
    onImageCleared: () => {
      imageGeneration++;
      currentEmbedding = null;
      strokeOverlay.clear();
      latestPrompt = null;
      inferenceStatus.clear();
      resultPanel?.clear();
    },
  });

  penSwatch?.addEventListener('click', () => {
    strokeOverlay.cyclePenColor();
  });
  stagePanel.querySelector('.stage-undo')?.addEventListener('click', () => {
    strokeOverlay.undo();
    stage.setMaskPreview(null);
    inferenceStatus.clear();
    resultPanel?.clear();
  });
  stagePanel.querySelector('.stage-loop-clear')?.addEventListener('click', () => {
    strokeOverlay.clear();
    latestPrompt = null;
    stage.setMaskPreview(null);
    inferenceStatus.clear();
    resultPanel?.clear();
  });

  debugToggle?.addEventListener('click', () => {
    debugEnabled = !debugEnabled;
    debugToggle.setAttribute('aria-pressed', String(debugEnabled));
    strokeOverlay.setDebugPrompt(debugEnabled ? latestPrompt : null);
  });

  // Dynamically imported so onnxruntime-web's WASM runtime sits in its own chunk,
  // outside the initial bundle everything else needs (SPEC's performance budget
  // targets that initial chunk, not the model). Triggered after first paint, never
  // blocking it.
  async function loadSamModel(): Promise<void> {
    modelStatus.set('Loading segmentation model…');
    const [{ createSamSession }, decodeModule] = await Promise.all([
      import('./lib/sam/session.js'),
      import('./lib/sam/decode.js'),
    ]);

    const result = await createSamSession({
      onProgress: (stageName, progress) => {
        modelStatus.set(
          `Loading ${stageName}: ${formatProgress(progress.loadedBytes, progress.totalBytes)}`,
        );
      },
    });

    if (!result.ok) {
      modelStatusNode.textContent = '';
      modelStatusNode.dataset.tone = 'error';
      const message = document.createElement('span');
      message.textContent = 'Could not load the segmentation model. ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => void loadSamModel());
      modelStatusNode.append(message, retry);
      return;
    }

    sam = {
      encoder: result.value.encoder,
      decoder: result.value.decoder,
      runEncoder: decodeModule.runEncoder,
      runDecoder: decodeModule.runDecoder,
    };
    modelStatus.set('Segmentation model ready.');

    // The user may have uploaded an image while the model was still downloading.
    if (stage.sourceSize !== null) void encodeCurrentImage();
  }

  void loadSamModel();
}
