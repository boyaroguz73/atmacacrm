# WhatsApp CRM Sistemi

WAHA, NestJS, Next.js, PostgreSQL ve Redis ile geliştirilmiş, üretime hazır WhatsApp CRM sistemi.

## Özellikler

- **Birleşik Gelen Kutusu** — WhatsApp Web benzeri sohbet deneyimi, gerçek zamanlı mesajlaşma
- **Çoklu Oturum** — Aynı anda 3+ WhatsApp hesabını bağlayabilme
- **CRM** — Kişi yönetimi, etiketler, notlar, satış pipeline'ı (YENİ → KAZANILDI/KAYBEDİLDİ)
- **Agent Sistemi** — Rol tabanlı erişim (süper admin / admin / agent), otomatik atama (round-robin)
- **Dashboard** — Anlık metrikler, agent performansı, dönüşüm oranları
- **Medya Desteği** — Resim ve dosya gönderme/alma
- **WebSocket** — Gerçek zamanlı mesaj iletimi ve durum güncellemeleri

## Teknoloji Yığını

| Katman   | Teknoloji                         |
|----------|-----------------------------------|
| Backend  | NestJS, Prisma, PostgreSQL, Redis |
| Frontend | Next.js 14, TailwindCSS, Zustand  |
| WhatsApp | WAHA (Docker)                     |
| Realtime | Socket.IO                         |
| Auth     | JWT + Passport                    |

---

## Kurulum Rehberi (Adım Adım)

### Ön Gereksinimler

Sisteminizde şunların kurulu olması gerekiyor:

| Yazılım      | Minimum Versiyon | İndirme Linki                          |
|--------------|------------------|----------------------------------------|
| Node.js      | 20+              | https://nodejs.org                     |
| Docker       | 24+              | https://docker.com/products/docker-desktop |
| PostgreSQL   | 16+              | https://www.postgresql.org/download/   |
| Redis        | 7+               | https://redis.io/download/             |

> **Not:** Docker kuruluysa PostgreSQL ve Redis'i Docker üzerinden de çalıştırabilirsiniz.

---

### ADIM 1: Altyapı Servislerini Başlatın

#### Seçenek A: Sadece Altyapıyı Docker ile Çalıştırma (Önerilen — Geliştirme İçin)

Aşağıdaki komutla PostgreSQL, Redis ve WAHA'yı Docker ile başlatın:

```bash
docker run -d --name crm-postgres -p 5432:5432 -e POSTGRES_DB=whatsapp_crm -e POSTGRES_USER=crm_user -e POSTGRES_PASSWORD=crm_secret_password postgres:16-alpine
```

```bash
docker run -d --name crm-redis -p 6379:6379 redis:7-alpine
```

```bash
docker run -d --name crm-waha -p 3001:3000 -e WHATSAPP_DEFAULT_ENGINE=WEBJS -e WAHA_DASHBOARD_ENABLED=true devlikeapro/waha
```

#### Seçenek B: Hepsini Tek Komutla Başlatma (docker-compose)

Eğer projenin tamamını Docker ile ayağa kaldırmak istiyorsanız:

```bash
docker-compose up -d
```

Bu komut; PostgreSQL, Redis, WAHA, Backend ve Frontend'i birlikte başlatır.

---

### ADIM 2: Backend Kurulumu

```bash
cd backend
```

**2.1 — .env dosyasını oluşturun:**

```bash
cp .env.example .env
```

`.env` dosyasındaki değerleri kontrol edin. Varsayılan değerler yerel geliştirme için uygundur.

**2.2 — Bağımlılıkları yükleyin:**

```bash
npm install
```

**2.3 — Prisma istemcisini oluşturun:**

```bash
npx prisma generate
```

**2.4 — Veritabanı tablolarını oluşturun (migration):**

```bash
npx prisma migrate dev --name init
```

**2.5 — Varsayılan kullanıcıları ekleyin (seed):**

```bash
npx ts-node prisma/seed.ts
```

**2.6 — Backend'i başlatın:**

```bash
npm run start:dev
```

Backend çalışıyor olmalı: `http://localhost:4000`
Swagger API Dokümantasyonu: `http://localhost:4000/api/docs`

---

### ADIM 3: Frontend Kurulumu

Yeni bir terminal açın:

```bash
cd frontend
```

**3.1 — .env dosyasını oluşturun:**

```bash
cp .env.example .env.local
```

**3.2 — Bağımlılıkları yükleyin:**

```bash
npm install
```

**3.3 — Frontend'i başlatın:**

```bash
npm run dev
```

Frontend çalışıyor olmalı: `http://localhost:3000`

---

### ADIM 4: WhatsApp Oturumu Bağlama

1. Tarayıcıda `http://localhost:3000` adresine gidin
2. Giriş yapın: `admin@crm.com` / `admin123`
3. Sol menüden **Ayarlar** sayfasına gidin
4. "Yeni oturum adı" alanına bir isim yazın (ör: `session1`) ve **Oturum Başlat**'a tıklayın
5. Oturum durumu "QR Bekliyor" olduğunda **QR Göster** butonuna tıklayın
6. Telefonunuzdaki WhatsApp'tan QR kodu okutun
7. Bağlantı kurulduğunda durum "Bağlı" olarak değişecek

---

## Varsayılan Kullanıcılar

| E-posta         | Şifre     | Rol        |
|-----------------|-----------|------------|
| admin@crm.com   | admin123  | SUPERADMIN |
| agent1@crm.com  | admin123  | AGENT      |
| agent2@crm.com  | admin123  | AGENT      |

---

## Sayfalar ve Özellikler

| Sayfa      | URL          | Açıklama                                                    |
|------------|--------------|-------------------------------------------------------------|
| Dashboard  | /dashboard   | Anlık metrikler, lead pipeline, agent performansı           |
| Mesajlar   | /inbox       | WhatsApp Web benzeri sohbet arayüzü, gerçek zamanlı mesaj   |
| Kişiler    | /contacts    | Tüm kişiler, etiketler, arama, lead durumu                  |
| Leads      | /leads       | Kanban benzeri satış hunisi, durum değiştirme                |
| Ayarlar    | /settings    | WhatsApp oturum yönetimi, kullanıcı listesi                 |

---

## API Uç Noktaları

### Kimlik Doğrulama
- `POST /api/auth/register` — Yeni kullanıcı kaydı
- `POST /api/auth/login` — Giriş yap
- `GET /api/auth/me` — Aktif kullanıcı bilgisi

### Görüşmeler
- `GET /api/conversations` — Görüşmeleri listele
- `GET /api/conversations/:id` — Görüşme detayı
- `PATCH /api/conversations/:id/read` — Okundu olarak işaretle
- `POST /api/conversations/:id/assign` — Agent'a ata
- `POST /api/conversations/:id/auto-assign` — Otomatik ata (round-robin)

### Mesajlar
- `GET /api/messages/conversation/:id` — Mesajları getir
- `POST /api/messages/send` — Metin mesajı gönder
- `POST /api/messages/send-media` — Medya gönder

### Kişiler
- `GET /api/contacts` — Kişileri listele
- `GET /api/contacts/:id` — Kişi detayı
- `PATCH /api/contacts/:id` — Kişi güncelle
- `POST /api/contacts/:id/tags` — Etiket ekle
- `DELETE /api/contacts/:id/tags/:tag` — Etiket kaldır

### Lead'ler
- `GET /api/leads` — Lead'leri listele
- `GET /api/leads/pipeline` — Pipeline istatistikleri
- `POST /api/leads` — Yeni lead oluştur
- `PATCH /api/leads/:id/status` — Lead durumu güncelle

### Dashboard
- `GET /api/dashboard/overview` — Genel bakış metrikleri
- `GET /api/dashboard/agent-performance` — Agent istatistikleri
- `GET /api/dashboard/message-stats` — Mesaj grafiği verileri

### WhatsApp Oturumları
- `GET /api/sessions` — Oturumları listele
- `POST /api/sessions/start` — Oturum başlat
- `POST /api/sessions/stop` — Oturum durdur
- `GET /api/sessions/:name/qr` — QR kodu al

---

## Mesaj Akışı

```
Gelen Mesaj:
WhatsApp → WAHA → POST /api/waha/webhook → Veritabanı → WebSocket → Frontend

Giden Mesaj:
Frontend → POST /api/messages/send → Backend → WAHA API → WhatsApp
```

---

## Veritabanı Tabloları

| Tablo              | Açıklama                                      |
|--------------------|-----------------------------------------------|
| users              | Kullanıcılar (admin, agent)                   |
| whatsapp_sessions  | WhatsApp oturum bilgileri                     |
| contacts           | Kişiler (telefon, isim, etiketler, notlar)    |
| conversations      | Görüşmeler (kişi + oturum bazında)            |
| messages           | Mesajlar (gelen/giden, medya, durum)          |
| leads              | Satış fırsatları (pipeline aşamaları)         |
| assignments        | Agent atamaları                               |
| activities         | Aktivite geçmişi (lead durum değişiklikleri)  |
| agent_metrics      | Agent performans metrikleri                   |

---

## Mimari

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Frontend   │◄───►│   Backend    │◄───►│  PostgreSQL   │
│  (Next.js)   │     │  (NestJS)    │     └──────────────┘
└──────┬───────┘     └──────┬───────┘
       │ WebSocket          │ REST
       └────────────────────┤
                            │
                     ┌──────▼───────┐     ┌──────────────┐
                     │    Redis      │     │    WAHA       │
                     │ (Cache/PubSub)│     │  (WhatsApp)   │
                     └──────────────┘     └──────────────┘
```

---

## Sorun Giderme

| Sorun                                    | Çözüm                                                        |
|------------------------------------------|---------------------------------------------------------------|
| Backend başlamıyor                       | `.env` dosyasını kontrol edin, PostgreSQL çalışıyor mu bakın  |
| Prisma migrate hatası                    | PostgreSQL bağlantı bilgilerini kontrol edin                  |
| WAHA'ya bağlanamıyor                     | `docker ps` ile WAHA container'ın çalıştığını doğrulayın      |
| QR kod görünmüyor                        | WAHA dashboard'ı kontrol edin: `http://localhost:3001`        |
| Frontend API'ye bağlanamıyor             | `.env.local` içindeki `NEXT_PUBLIC_API_URL`'yi kontrol edin   |
| WebSocket bağlantı hatası                | Backend'in çalıştığından ve portun doğru olduğundan emin olun |
| "Invalid credentials" hatası             | Seed çalıştırdığınızdan emin olun: `npx ts-node prisma/seed.ts` |
