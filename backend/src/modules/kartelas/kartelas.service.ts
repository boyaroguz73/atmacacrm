import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

type KartelaRow = {
  id: string;
  name: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  createdById?: string | null;
  createdByName?: string | null;
};

@Injectable()
export class KartelasService {
  private readonly baseDir = join(process.cwd(), 'uploads', 'kartelas');
  private readonly indexPath = join(this.baseDir, 'index.json');

  private ensureStorage() {
    mkdirSync(this.baseDir, { recursive: true });
    if (!existsSync(this.indexPath)) {
      writeFileSync(this.indexPath, '[]', 'utf8');
    }
  }

  private readRows(): KartelaRow[] {
    this.ensureStorage();
    try {
      const raw = readFileSync(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as KartelaRow[];
    } catch {
      return [];
    }
  }

  private writeRows(rows: KartelaRow[]) {
    this.ensureStorage();
    writeFileSync(this.indexPath, JSON.stringify(rows, null, 2), 'utf8');
  }

  findAll(search?: string) {
    const rows = this.readRows().sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const q = String(search || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLocaleLowerCase('tr-TR').includes(q) ||
        r.fileName.toLocaleLowerCase('tr-TR').includes(q),
    );
  }

  createFromUpload(
    file: Express.Multer.File,
    payload: { name?: string },
    user?: { id?: string; name?: string },
  ) {
    const baseName = String(payload?.name || '').trim();
    const row: KartelaRow = {
      id: randomUUID(),
      name: baseName || file.originalname,
      fileUrl: `/uploads/kartelas/${file.filename}`,
      fileName: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size || 0,
      createdAt: new Date().toISOString(),
      createdById: user?.id || null,
      createdByName: user?.name || null,
    };
    const rows = this.readRows();
    rows.push(row);
    this.writeRows(rows);
    return row;
  }

  remove(id: string) {
    const rows = this.readRows();
    const hit = rows.find((r) => r.id === id);
    if (!hit) throw new NotFoundException('Kartela bulunamadı');
    const next = rows.filter((r) => r.id !== id);
    this.writeRows(next);
    const full = join(process.cwd(), hit.fileUrl.replace(/^\/+/, ''));
    if (existsSync(full)) {
      try {
        unlinkSync(full);
      } catch {
        // Dosya zaten taşınmış/silinmiş olabilir; kayıt yine kaldırılır.
      }
    }
    return { deleted: true };
  }
}
