import sharp from 'sharp';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB - WhatsApp limiti
const MAX_DIMENSION = 4096;

/**
 * WAHA / WhatsApp için yüksek kaliteli JPEG; çok büyük görselleri oran koruyarak sınırlar,
 * genişlik/yükseklik meta verisini gönderim API'sine iletir (kırpma/az kalite riskini azaltır).
 * Dosya boyutu 4MB'ı aşarsa kaliteyi kademeli olarak düşürür.
 */
export async function optimizeImageBufferForWhatsapp(buf: Buffer): Promise<{
  base64: string;
  mimetype: string;
  filename: string;
  width?: number;
  height?: number;
}> {
  const meta = await sharp(buf, { failOn: 'none' }).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const fmt = String(meta.format || '').toLowerCase();
  const origMime =
    fmt === 'png'
      ? 'image/png'
      : fmt === 'webp'
        ? 'image/webp'
        : fmt === 'gif'
          ? 'image/gif'
          : fmt === 'heif' || fmt === 'heic'
            ? 'image/heic'
            : 'image/jpeg';
  const origExt =
    origMime === 'image/png'
      ? 'png'
      : origMime === 'image/webp'
        ? 'webp'
        : origMime === 'image/gif'
          ? 'gif'
          : origMime === 'image/heic'
            ? 'heic'
            : 'jpg';

  // Orijinal dosya zaten uygunsa dokunma: kaliteyi koru.
  if (buf.length <= MAX_FILE_SIZE && w <= MAX_DIMENSION && h <= MAX_DIMENSION) {
    return {
      base64: buf.toString('base64'),
      mimetype: origMime,
      filename: `photo_${Date.now()}.${origExt}`,
      width: w || undefined,
      height: h || undefined,
    };
  }

  // Sadece zorunluysa transcode/resize uygula.
  let pipeline = sharp(buf, { failOn: 'none' });
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let quality = 92;
  let out = await pipeline
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();

  while (out.length > MAX_FILE_SIZE && quality > 35) {
    quality -= 8;
    out = await pipeline
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: quality > 72 ? '4:4:4' : '4:2:0',
      })
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
