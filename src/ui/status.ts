export type StatusTone = 'idle' | 'busy' | 'error';

export interface StatusLine {
  set(text: string, tone?: StatusTone): void;
  clear(): void;
}

/**
 * A tiny wrapper around "set some text and a tone on a status element" — used for the
 * model-download status, the image-load status, and the inference status. Consolidating
 * it avoids three near-identical `el.textContent = ...; el.dataset.tone = ...` call
 * sites drifting out of sync with each other.
 */
export function createStatusLine(el: HTMLElement): StatusLine {
  return {
    set(text: string, tone: StatusTone = 'idle'): void {
      el.textContent = text;
      el.dataset.tone = tone;
    },
    clear(): void {
      el.textContent = '';
      delete el.dataset.tone;
    },
  };
}
