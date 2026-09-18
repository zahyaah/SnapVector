export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'snapvector:theme';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeController {
  readonly current: Theme;
  toggle(): Theme;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function resolveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  if (stored !== null) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Reading localStorage throws outright in some privacy modes rather than returning null,
 * so every access is guarded — a browser that refuses storage should fall back to the OS
 * preference, not break the page.
 */
export function readStoredTheme(storage: ThemeStorage | null): Theme | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(storage: ThemeStorage | null, theme: Theme): void {
  if (storage === null) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A rejected write costs the user their preference on next load, nothing more.
  }
}

function safeLocalStorage(): ThemeStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createThemeController(
  root: HTMLElement,
  toggleButton: HTMLButtonElement,
): ThemeController {
  const storage = safeLocalStorage();
  const darkQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
  let stored = readStoredTheme(storage);
  let current = resolveTheme(stored, darkQuery.matches);

  const apply = (theme: Theme): void => {
    current = theme;
    root.dataset.theme = theme;
    toggleButton.setAttribute('aria-pressed', String(theme === 'dark'));
    toggleButton.setAttribute(
      'aria-label',
      theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    );
  };

  apply(current);

  // Only track the OS while the user has expressed no preference of their own.
  darkQuery.addEventListener('change', (event) => {
    if (stored === null) apply(event.matches ? 'dark' : 'light');
  });

  toggleButton.addEventListener('click', () => {
    stored = current === 'dark' ? 'light' : 'dark';
    writeStoredTheme(storage, stored);
    apply(stored);
  });

  return {
    get current(): Theme {
      return current;
    },
    toggle(): Theme {
      toggleButton.click();
      return current;
    },
  };
}
