const ALLOWED_BASENAME_PATTERN = /[^A-Za-z0-9 ._-]/g;
const EDGE_JUNK_PATTERN = /^[.\-\s]+|[.\-\s]+$/g;
const MAX_BASENAME_LENGTH = 100;
const DEFAULT_BASENAME = 'snapvector-export';
const EXTENSION = 'svg';

// Windows treats these as reserved device names regardless of extension — a download
// named "CON.svg" fails or misbehaves on that filesystem even though every character in
// it is otherwise harmless.
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

function stripDirectoryComponents(name: string): string {
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return lastSeparator === -1 ? name : name.slice(lastSeparator + 1);
}

function withoutExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? name : name.slice(0, lastDot);
}

/**
 * Derives a filesystem- and browser-safe `<name>.svg` from a user-supplied upload
 * filename, for use in a download's `download` attribute (T25/T26). Untrusted input —
 * strips directory components (path traversal), replaces or removes any character
 * outside a small safe set, rejects Windows-reserved device names, and truncates to a
 * sane length — falling back to a fixed default name whenever nothing safe survives,
 * rather than ever producing an empty or unsafe result.
 */
export function sanitizeFilename(rawName: string): string {
  const withoutDirectory = stripDirectoryComponents(rawName);
  const rawBase = withoutExtension(withoutDirectory);

  let base = rawBase
    .replace(ALLOWED_BASENAME_PATTERN, '')
    .replace(EDGE_JUNK_PATTERN, '')
    .slice(0, MAX_BASENAME_LENGTH);
  base = base.replace(EDGE_JUNK_PATTERN, '');

  if (base === '' || RESERVED_WINDOWS_NAMES.has(base.toUpperCase())) {
    base = DEFAULT_BASENAME;
  }

  return `${base}.${EXTENSION}`;
}
