import { describe, expect, it } from 'vitest';

import { sanitizeFilename } from './sanitize.js';

describe('sanitizeFilename — well-behaved input', () => {
  it('replaces the original extension with .svg', () => {
    expect(sanitizeFilename('photo.png')).toBe('photo.svg');
    expect(sanitizeFilename('photo.jpeg')).toBe('photo.svg');
  });

  it('keeps a safe basename made only of letters, digits, spaces, dots, dashes, underscores', () => {
    expect(sanitizeFilename('my vacation-photo_2024.jpg')).toBe('my vacation-photo_2024.svg');
  });

  it('adds the .svg extension when the input has none', () => {
    expect(sanitizeFilename('photo')).toBe('photo.svg');
  });
});

describe('sanitizeFilename — path traversal and separators', () => {
  it('strips directory components from a Unix-style path', () => {
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd.svg');
  });

  it('strips directory components from a Windows-style path', () => {
    expect(sanitizeFilename('C:\\Users\\me\\photo.png')).toBe('photo.svg');
  });

  it('never returns a name containing a path separator', () => {
    expect(sanitizeFilename('a/b\\c.png')).not.toMatch(/[/\\]/);
  });

  it('never returns a name that is a relative-path traversal token', () => {
    const result = sanitizeFilename('..');
    expect(result).not.toBe('..');
    expect(result).not.toBe('...svg');
  });
});

describe('sanitizeFilename — unsafe characters', () => {
  it('replaces disallowed punctuation rather than passing it through', () => {
    const result = sanitizeFilename('weird<>:"|?*name.png');
    expect(result).toMatch(/^[A-Za-z0-9 ._-]+\.svg$/);
  });

  it('strips control characters', () => {
    const result = sanitizeFilename('bad\u0000name\u001f.png');
    expect(result).toMatch(/^[A-Za-z0-9 ._-]+\.svg$/);
  });
});

describe('sanitizeFilename — degenerate input', () => {
  it('falls back to a default name for an empty string', () => {
    expect(sanitizeFilename('')).toMatch(/^[A-Za-z0-9 ._-]+\.svg$/);
  });

  it('falls back to a default name when nothing survives sanitization', () => {
    expect(sanitizeFilename('///???***')).toMatch(/^[A-Za-z0-9 ._-]+\.svg$/);
  });

  it('falls back to a default name for a Windows reserved device name', () => {
    const result = sanitizeFilename('CON.png');
    expect(result.toUpperCase()).not.toBe('CON.SVG');
  });

  it('truncates an excessively long name to a reasonable length', () => {
    const longName = 'a'.repeat(500) + '.png';
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(110);
    expect(result.endsWith('.svg')).toBe(true);
  });

  it('never returns a name that is just an extension with an empty basename', () => {
    expect(sanitizeFilename('.png')).not.toBe('.svg');
  });
});
