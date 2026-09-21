const EMPTY_HINT = 'Draw a loop around a subject to create a downloadable SVG.';
const READY_HINT = 'Ready to download.';

export interface ResultPanel {
  showResult(svg: string, downloadFilename: string): void;
  clear(): void;
}

/**
 * Wires the result panel's preview and download button. The SVG is injected directly
 * as markup (never through an `<img>`/data-URI round-trip) because `svg` always comes
 * from `buildSvgDocument` (T25), which guarantees a fixed, script-free, event-free
 * template — there is nothing untrusted here to isolate it from.
 */
export function createResultPanel(root: HTMLElement): ResultPanel {
  const body = root.querySelector<HTMLElement>('.result-panel__body');
  const preview = root.querySelector<HTMLElement>('.result-preview');
  const downloadButton = root.querySelector<HTMLButtonElement>('.download-button');
  const hint = root.querySelector<HTMLElement>('.download-hint');
  if (body === null || preview === null || downloadButton === null || hint === null) {
    throw new Error('Result panel markup is incomplete');
  }

  let objectUrl: string | null = null;
  let filename = 'snapvector-export.svg';

  const revokeObjectUrl = (): void => {
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  downloadButton.addEventListener('click', () => {
    if (objectUrl === null) return;
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.click();
  });

  hint.textContent = EMPTY_HINT;

  return {
    showResult(svg: string, downloadFilename: string): void {
      revokeObjectUrl();
      preview.replaceChildren();
      preview.insertAdjacentHTML('afterbegin', svg);
      objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      filename = downloadFilename;
      downloadButton.disabled = false;
      hint.textContent = READY_HINT;
      body.dataset.state = 'ready';
    },

    clear(): void {
      revokeObjectUrl();
      preview.replaceChildren();
      downloadButton.disabled = true;
      hint.textContent = EMPTY_HINT;
      body.dataset.state = 'empty';
    },
  };
}
