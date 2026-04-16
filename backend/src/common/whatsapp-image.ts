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
  let pipeline = sharp(buf, { failOn: 'none' });
  const meta = await pipeline.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  
  // Boyut kontrolü - çok büyük görselleri küçült
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    pipeline = sharp(buf, { failOn: 'none' }).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Başlangıç kalitesi
  let quality = 94;
  let out = await pipeline
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();

  // Dosya boyutu 4MB'ı aşıyorsa kaliteyi kademeli düşür
  while (out.length > MAX_FILE_SIZE && quality > 30) {
    quality -= 10;
    out = await pipeline
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: quality > 70 ? '4:4:4' : '4:2:0',
      })
      .toBuffer();
  }

  // Hâlâ çok büyükse boyutu düşür (ekranda ve WhatsApp’ta daha okunaklı kalite)
  if (out.length > MAX_FILE_SIZE) {
    pipeline = sharp(buf, { failOn: 'none' }).resize({
      width: 2560,
      height: 2560,
      fit: 'inside',
      withoutEnlargement: true,
    });
    out = await pipeline
      .jpeg({
        quality: 82,
        mozjpeg: true,
        chromaSubsampling: '4:2:0',
      })
      .toBuffer();
  }

  const fm = await sharp(out).metadata();
  return {
    base64: out.toString('base64'),
    mimetype: 'image/jpeg',
    filename: `photo_${Date.now()}.jpg`,
    width: fm.width ?? undefined,
    height: fm.height ?? undefined,
  };
}
