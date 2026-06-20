import type { Logger } from "./logger";

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 80;

export interface CompressedImage {
  base64DataUrl: string;
  originalSize: number;
  compressedSize: number;
}

export async function compressImage(log: Logger, originalBuffer: Buffer): Promise<CompressedImage | null> {
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
    return null;
  }
}

export function encodeUncompressed(buffer: Buffer, contentType: string): string {
  const mime = contentType || "application/octet-stream";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
