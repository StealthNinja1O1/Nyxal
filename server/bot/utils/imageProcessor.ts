// backend agnostic image compression. shrink discord attachments before sending
// them to the vision model so we burn fewer tokens. tries Bun.Image first,
// then sharp, then just the raw base64.

import type { Logger } from "./logger";

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 80;

export interface CompressedImage {
  base64DataUrl: string;
  originalSize: number;
  compressedSize: number;
}

export async function compressImage(
  log: Logger,
  originalBuffer: Buffer,
): Promise<CompressedImage | null> {
  // Bun.Image
  if (typeof Bun !== "undefined" && typeof Bun.Image === "function") {
    try {
      const img = new Bun.Image(originalBuffer);
      const out = await img
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside" })
        .jpeg({ quality: JPEG_QUALITY })
        .buffer();

      return {
        base64DataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
        originalSize: originalBuffer.length,
        compressedSize: out.length,
      };
    } catch (error) {
      log.warn(`Bun.Image compression failed, trying fallback: ${error}`);
    }
  }

  // sharp
  try {
    const sharp = (await import("sharp")).default;
    const compressedBuffer = await sharp(originalBuffer)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();

    return {
      base64DataUrl: `data:image/jpeg;base64,${compressedBuffer.toString("base64")}`,
      originalSize: originalBuffer.length,
      compressedSize: compressedBuffer.length,
    };
  } catch (error) {
    log.debug(`Image backend unavailable or failed: ${error}`);
    return null;
  }
}

export function encodeUncompressed(buffer: Buffer, contentType: string): string {
  const mime = contentType || "application/octet-stream";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
