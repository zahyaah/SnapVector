import { describe, expect, it } from 'vitest';

import {
  isTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
  type ThemeStorage,
} from './theme.js';

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function throwingStorage(): ThemeStorage {
  return {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
  };
}

describe('isTheme', () => {
  it('accepts only the two theme names', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('solarized')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('follows the OS preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('lets a stored override win over the OS preference in both directions', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('readStoredTheme', () => {
  it('returns a valid stored theme', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('ignores an unrecognised stored value rather than trusting it', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'neon' }))).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readStoredTheme(fakeStorage())).toBeNull();
  });

  it('falls back to null when storage is absent or throws', () => {
    expect(readStoredTheme(null)).toBeNull();
    expect(readStoredTheme(throwingStorage())).toBeNull();
  });
});

describe('writeStoredTheme', () => {
  it('persists the chosen theme', () => {
    const storage = fakeStorage();
    writeStoredTheme(storage, 'dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('swallows a rejected write instead of breaking the page', () => {
    expect(() => {
      writeStoredTheme(throwingStorage(), 'dark');
    }).not.toThrow();
    expect(() => {
      writeStoredTheme(null, 'light');
    }).not.toThrow();
  });
});
