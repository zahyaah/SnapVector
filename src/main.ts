import { loopToSamPrompt, type SamPrompt } from './lib/geometry/prompt.js';
import { createStage } from './ui/stage.js';
import { createStrokeOverlay } from './ui/stroke-overlay.js';
import { createThemeController } from './ui/theme.js';
import { wireStageControls } from './ui/controls.js';

const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');
if (themeToggle) {
  createThemeController(document.documentElement, themeToggle);
}

const stagePanel = document.querySelector<HTMLElement>('.stage-panel');
const stageEl = stagePanel?.querySelector<HTMLElement>('.stage');

if (stagePanel && stageEl) {
  const stage = createStage(stageEl);
  const penSwatch = stagePanel.querySelector<HTMLElement>('.pen-swatch');
  const debugToggle = stagePanel.querySelector<HTMLButtonElement>('.debug-toggle');
  const strokeOverlay = createStrokeOverlay(stage, penSwatch ?? undefined);

  let debugEnabled = false;
  let latestPrompt: SamPrompt | null = null;

  strokeOverlay.onLoopComplete((loop) => {
    if (stage.sourceSize === null) return;

    const result = loopToSamPrompt(loop, stage.sourceSize);
    latestPrompt = result.ok ? result.value : null;
    strokeOverlay.setDebugPrompt(debugEnabled ? latestPrompt : null);
  });

  wireStageControls(stagePanel, stage, {
    onImageCleared: () => {
      strokeOverlay.clear();
      latestPrompt = null;
    },
  });

  penSwatch?.addEventListener('click', () => {
    strokeOverlay.cyclePenColor();
  });
  stagePanel.querySelector('.stage-undo')?.addEventListener('click', () => {
    strokeOverlay.undo();
  });
  stagePanel.querySelector('.stage-loop-clear')?.addEventListener('click', () => {
    strokeOverlay.clear();
    latestPrompt = null;
  });

  debugToggle?.addEventListener('click', () => {
    debugEnabled = !debugEnabled;
    debugToggle.setAttribute('aria-pressed', String(debugEnabled));
    strokeOverlay.setDebugPrompt(debugEnabled ? latestPrompt : null);
  });
}

const modelStatus = document.querySelector<HTMLElement>('#model-status');

function formatProgress(loadedBytes: number, totalBytes: number | null): string {
  const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
  return totalBytes === null
    ? `${mb(loadedBytes)} MB loaded`
    : `${mb(loadedBytes)} / ${mb(totalBytes)} MB (${String(Math.round((loadedBytes / totalBytes) * 100))}%)`;
}

// Dynamically imported so onnxruntime-web's WASM runtime sits in its own chunk, outside
// the initial bundle everything else needs (SPEC's performance budget targets that
// initial chunk, not the model). Triggered after first paint, never blocking it — see
// T15 for wiring this to the actual draw-a-loop flow; this is load/progress/cache/error
// verification only.
async function loadSamModel(): Promise<void> {
  if (!modelStatus) return;
  const { createSamSession } = await import('./lib/sam/session.js');

  modelStatus.dataset.tone = 'idle';
  modelStatus.textContent = 'Loading segmentation model…';

  const result = await createSamSession({
    onProgress: (stage, progress) => {
      modelStatus.textContent = `Loading ${stage}: ${formatProgress(progress.loadedBytes, progress.totalBytes)}`;
    },
  });

  if (!result.ok) {
    modelStatus.dataset.tone = 'error';
    modelStatus.textContent = '';
    const message = document.createElement('span');
    message.textContent = 'Could not load the segmentation model. ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => void loadSamModel());
    modelStatus.append(message, retry);
    return;
  }

  modelStatus.dataset.tone = 'idle';
  modelStatus.textContent = 'Segmentation model ready.';
}

void loadSamModel();
