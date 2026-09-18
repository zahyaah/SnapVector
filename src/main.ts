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
