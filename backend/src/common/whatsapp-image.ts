import sharp from 'sharp';

/**
 * WAHA / WhatsApp için yüksek kaliteli JPEG; çok büyük görselleri oran koruyarak sınırlar,
 * genişlik/yükseklik meta verisini gönderim API’sine iletir (kırpma/az kalite riskini azaltır).
 */
export async function optimizeImageBufferForWhatsapp(buf: Buffer): Promise<{
  base64: string;
  mimetype: string;
  filename: string;
  width?: number;
  height?: number;
}> {
  let pipeline = sharp(buf, { failOn: 'none' });
  const meta = await pipeline.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w > 4096 || h > 4096) {
    pipeline = sharp(buf, { failOn: 'none' }).resize({
      width: 4096,
      height: 4096,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const out = await pipeline
    .jpeg({
      quality: 94,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();
  const fm = await sharp(out).metadata();
  return {
    base64: out.toString('base64'),
    mimetype: 'image/jpeg',
    filename: 'photo.jpg',
    width: fm.width ?? undefined,
    height: fm.height ?? undefined,
  };
}
