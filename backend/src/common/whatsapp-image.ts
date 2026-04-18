import * as sharp from 'sharp';

const MAX_WA_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — WAHA / WhatsApp pratik üst sınırı
const MAX_DIMENSION = 4096;

const PASSTHROUGH_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
const FORMAT_TO_EXT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
};

/**
 * WhatsApp / WAHA için görsel hazırla.
 *
 * Öncelik: KALITE.
 * - Görsel boyut ve ebat limitleri içindeyse DOKUNULMAZ gönderilir (sıfır kalite kaybı).
 * - Sadece limit aşımında sıkıştırma yapılır; kalite 95'ten başlar ve kademeli düşer.
 * - Son çare boyut küçültmedir; WhatsApp'ın kendi yeniden sıkıştırmasına en iyi girdiyi vermek için
 *   4:4:4 kroma alt örnekleme ve mozjpeg tercih edilir.
 */
export async function optimizeImageBufferForWhatsapp(buf: Buffer): Promise<{
  base64: string;
  mimetype: string;
  filename: string;
  width?: number;
  height?: number;
}> {
  const meta = await sharp(buf, { failOn: 'none' }).metadata();
  const format = String(meta.format ?? '').toLowerCase();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const size = buf.length;

  const needsResize = w > MAX_DIMENSION || h > MAX_DIMENSION;
  const needsCompression = size > MAX_WA_IMAGE_BYTES;

  // Passthrough: sıfır kalite kaybı
  if (!needsResize && !needsCompression && PASSTHROUGH_FORMATS.has(format)) {
    return {
      base64: buf.toString('base64'),
      mimetype: FORMAT_TO_MIME[format],
      filename: `photo_${Date.now()}.${FORMAT_TO_EXT[format]}`,
      width: w || undefined,
      height: h || undefined,
    };
  }

  let pipeline = sharp(buf, { failOn: 'none' });
  if (needsResize) {
    pipeline = sharp(buf, { failOn: 'none' }).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let quality = 95;
  let out = await pipeline
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  while (out.length > MAX_WA_IMAGE_BYTES && quality > 55) {
    quality -= 5;
    out = await pipeline
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: quality >= 75 ? '4:4:4' : '4:2:0',
      })
      .toBuffer();
  }

  if (out.length > MAX_WA_IMAGE_BYTES) {
    pipeline = sharp(buf, { failOn: 'none' }).resize({
      width: 2560,
      height: 2560,
      fit: 'inside',
      withoutEnlargement: true,
    });
    out = await pipeline
      .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
  }

  const fm = await sharp(out, { failOn: 'none' }).metadata();
  return {
    base64: out.toString('base64'),
    mimetype: 'image/jpeg',
    filename: `photo_${Date.now()}.jpg`,
    width: fm.width ?? undefined,
    height: fm.height ?? undefined,
  };
}
