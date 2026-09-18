import { isSupportedImageType, type ImageLoadError } from '../lib/image/source-file.js';
import { err, ok, type Result } from '../lib/result.js';

/**
 * A file's reported MIME type comes from its extension on most platforms, so a .txt
 * renamed to .png arrives claiming to be an image. The allowlist is only a cheap
 * pre-filter; the decode attempt is what actually proves the bytes are an image.
 */
export async function loadImageFile(file: File): Promise<Result<ImageBitmap, ImageLoadError>> {
  if (!isSupportedImageType(file.type)) {
    return err({ kind: 'unsupported-type', mimeType: file.type });
  }

  try {
    return ok(await createImageBitmap(file));
  } catch {
    return err({ kind: 'decode-failed' });
  }
}
