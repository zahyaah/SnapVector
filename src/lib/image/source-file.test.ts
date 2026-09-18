import { describe, expect, it } from 'vitest';

import {
  imageLoadErrorMessage,
  isSupportedImageType,
  SUPPORTED_IMAGE_TYPES,
} from './source-file.js';

describe('isSupportedImageType', () => {
  it('accepts every type the file input advertises', () => {
    for (const type of SUPPORTED_IMAGE_TYPES) {
      expect(isSupportedImageType(type)).toBe(true);
    }
  });

  it('rejects image formats the pipeline cannot decode reliably', () => {
    expect(isSupportedImageType('image/gif')).toBe(false);
    expect(isSupportedImageType('image/svg+xml')).toBe(false);
    expect(isSupportedImageType('image/tiff')).toBe(false);
  });

  it('rejects non-image types', () => {
    expect(isSupportedImageType('text/plain')).toBe(false);
    expect(isSupportedImageType('application/pdf')).toBe(false);
    expect(isSupportedImageType('')).toBe(false);
  });

  it('is case-insensitive, since MIME types are not case-sensitive', () => {
    expect(isSupportedImageType('IMAGE/PNG')).toBe(true);
  });
});

describe('imageLoadErrorMessage', () => {
  it('names the accepted formats when the type is wrong', () => {
    const message = imageLoadErrorMessage({ kind: 'unsupported-type', mimeType: 'image/gif' });
    expect(message).toContain('PNG');
    expect(message).toContain('WebP');
  });

  it('explains that a decode failure may mean a renamed or corrupt file', () => {
    const message = imageLoadErrorMessage({ kind: 'decode-failed' });
    expect(message.toLowerCase()).toMatch(/corrupt|renamed/);
  });

  it('always returns a non-empty, human-readable sentence', () => {
    const errors = [
      { kind: 'unsupported-type', mimeType: 'text/plain' },
      { kind: 'decode-failed' },
    ] as const;
    for (const error of errors) {
      const message = imageLoadErrorMessage(error);
      expect(message.length).toBeGreaterThan(10);
      expect(message.endsWith('.')).toBe(true);
    }
  });
});
