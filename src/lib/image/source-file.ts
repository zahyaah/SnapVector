export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export type ImageLoadError =
  | { readonly kind: 'unsupported-type'; readonly mimeType: string }
  | { readonly kind: 'decode-failed' };

export function isSupportedImageType(mimeType: string): mimeType is SupportedImageType {
  const normalised = mimeType.toLowerCase();
  return SUPPORTED_IMAGE_TYPES.some((supported) => supported === normalised);
}

export function imageLoadErrorMessage(error: ImageLoadError): string {
  switch (error.kind) {
    case 'unsupported-type':
      return 'That file type is not supported. Use a PNG, JPEG or WebP image.';
    case 'decode-failed':
      return 'That file could not be read as an image. It may be corrupt or renamed.';
  }
}
