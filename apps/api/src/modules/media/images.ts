import sharp, { type Metadata } from 'sharp';
import { MEDIA_LIMITS } from '@mpe/shared';

export type MediaMime = (typeof MEDIA_LIMITS.mimeTypes)[number];

export class ImageRejected extends Error {
  readonly code: 'too_large' | 'not_an_image' | 'unsupported_format' | 'too_many_pixels';
  constructor(code: ImageRejected['code']) { super(code); this.name = 'ImageRejected'; this.code = code; }
}

export interface ProcessedImage {
  mime: MediaMime;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
  /** The upload with its metadata (camera, location) removed and its orientation applied. Kept privately. */
  original: Buffer;
  /** Resized WebP copies for the website, smallest first. */
  variants: { width: number; data: Buffer }[];
}

type Kept = 'jpeg' | 'png' | 'webp';
const FORMATS: Record<Kept, { mime: MediaMime; extension: ProcessedImage['extension'] }> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
};

/**
 * Checks and prepares an uploaded picture. The format is read from the file itself, never from what the browser
 * claims. Everything written out has no EXIF data: phone photos carry the GPS position of where they were taken,
 * and the shop's customers or its address must never leak through a showroom picture.
 */
export async function processImage(upload: Buffer): Promise<ProcessedImage> {
  if (upload.byteLength > MEDIA_LIMITS.maxBytes) throw new ImageRejected('too_large');

  let meta: Metadata;
  try {
    meta = await sharp(upload, { limitInputPixels: MEDIA_LIMITS.maxPixels }).metadata();
  } catch {
    throw new ImageRejected('not_an_image');
  }
  const kind = meta.format as Kept | undefined;
  const format = kind && kind in FORMATS ? FORMATS[kind] : undefined;
  if (!kind || !format) throw new ImageRejected('unsupported_format');
  if (!meta.width || !meta.height) throw new ImageRejected('not_an_image');
  if (meta.width * meta.height > MEDIA_LIMITS.maxPixels) throw new ImageRejected('too_many_pixels');

  // rotate() applies the camera's orientation flag, so the picture stands the right way once the flag is gone.
  const base = () => sharp(upload, { limitInputPixels: MEDIA_LIMITS.maxPixels }).rotate();
  const original = await base().toFormat(kind).toBuffer({ resolveWithObject: true });

  const widths = MEDIA_LIMITS.widths.filter((w) => w < original.info.width);
  const variantWidths = [...widths, Math.min(original.info.width, MEDIA_LIMITS.widths.at(-1)!)];
  const unique = [...new Set(variantWidths)].sort((a, b) => a - b);
  const variants = await Promise.all(unique.map(async (width) => ({
    width,
    data: await base().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
  })));

  return { ...format, width: original.info.width, height: original.info.height, original: original.data, variants };
}
