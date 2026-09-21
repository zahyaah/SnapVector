import { imageLoadErrorMessage } from '../lib/image/source-file.js';
import { loadImageFile } from './image-source.js';
import type { Stage } from './stage.js';

export interface StageControlsHooks {
  readonly onImageLoaded?: (file: File) => void;
  readonly onImageCleared?: () => void;
}

export interface StageControls {
  readonly element: HTMLElement;
}

function firstImageFile(files: FileList | null): File | null {
  if (files === null) return null;
  return Array.from(files).find((file) => file.type.startsWith('image/')) ?? null;
}

function firstImageFromDataTransfer(dataTransfer: DataTransfer | null): File | null {
  if (dataTransfer === null) return null;
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file?.type.startsWith('image/') === true) return file;
    }
  }
  return firstImageFile(dataTransfer.files);
}

export function wireStageControls(
  root: HTMLElement,
  stage: Stage,
  hooks: StageControlsHooks = {},
): StageControls {
  const fileInput = root.querySelector<HTMLInputElement>('#file-input');
  const stageEl = root.querySelector<HTMLElement>('.stage');
  const statusEl = root.querySelector<HTMLElement>('.stage-status');
  const toolbar = root.querySelector<HTMLElement>('.stage-toolbar');
  const clearButton = root.querySelector<HTMLButtonElement>('.stage-clear');
  if (
    fileInput === null ||
    stageEl === null ||
    statusEl === null ||
    toolbar === null ||
    clearButton === null
  ) {
    throw new Error('Stage controls markup is incomplete');
  }

  const setStatus = (message: string, tone: 'idle' | 'error' = 'idle'): void => {
    statusEl.textContent = message;
    statusEl.dataset.tone = tone;
  };

  const acceptFile = async (file: File): Promise<void> => {
    const result = await loadImageFile(file);
    if (!result.ok) {
      setStatus(imageLoadErrorMessage(result.error), 'error');
      return;
    }
    stage.setImage(result.value);
    toolbar.hidden = false;
    setStatus('');
    hooks.onImageLoaded?.(file);
  };

  fileInput.addEventListener('change', () => {
    const file = firstImageFile(fileInput.files);
    if (file) void acceptFile(file);
    fileInput.value = '';
  });

  // Drag-and-drop needs dragover prevented too, or the browser's own "navigate to the
  // dropped file" handling wins and the page unloads.
  stageEl.addEventListener('dragover', (event) => {
    event.preventDefault();
    stageEl.dataset.dragging = 'true';
  });
  stageEl.addEventListener('dragleave', () => {
    delete stageEl.dataset.dragging;
  });
  stageEl.addEventListener('drop', (event) => {
    event.preventDefault();
    delete stageEl.dataset.dragging;
    const file = firstImageFromDataTransfer(event.dataTransfer);
    if (file) void acceptFile(file);
  });

  // Paste is scoped to the document rather than the stage element, since a canvas is
  // never a paste target the OS will actually deliver a clipboard event to.
  document.addEventListener('paste', (event) => {
    const file = firstImageFromDataTransfer(event.clipboardData);
    if (file) void acceptFile(file);
  });

  clearButton.addEventListener('click', () => {
    stage.clear();
    toolbar.hidden = true;
    setStatus('');
    hooks.onImageCleared?.();
  });

  return { element: stageEl };
}
