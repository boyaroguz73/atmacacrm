# Canlıya Alma ve Kurulum Rehberi

Bu doküman, WhatsApp CRM projesini **müşteriye teslim / canlı ortam** için nasıl kuracağınızı özetler: mimari, hosting seçimi, ortam değişkenleri, Docker ve manuel seçenekler, güvenlik ve kontrol listesi.

---

## 1. Sistem bileşenleri

| Bileşen | Açıklama |
|--------|-----------|
| **Frontend** | Next.js 14 (port 3000) — tarayıcıdan erişilen arayüz |
| **Backend** | NestJS API + Socket.IO (port 4000) — `NODE_ENV=production` iken CORS yalnızca `FRONTEND_URL` |
| **PostgreSQL** | Prisma ile şema ve migrasyonlar |
| **Redis** | Kuyruk / önbellek (BullMQ vb.) |
| **WAHA** | WhatsApp oturumları ve webhook — ayrı konteyner veya ayrı sunucu |

Üretimde hepsinin **HTTPS** arkasında ve birbirine **doğru URL’lerle** konuşması gerekir.

---

## 2. Hosting önerisi (müşteri sunumu için)

### Önerilen model: tek VPS + Docker Compose

**Neden:** Repo kökünde `docker-compose.yml` zaten Postgres, Redis, WAHA, backend ve frontend’i birlikte tanımlıyor. Operasyonel maliyet düşük, müşteriye “tek sunucuda çalışan paket” olarak anlatması kolay.

**Sağlayıcı örnekleri (Türkiye / global):**

- **Hetzner**, **Contabo**, **Vultr**, **Linode/Akamai**, **Scaleway**, **DigitalOcean**, **OVH VPS** — hepsinde yöntem aynı: Ubuntu + Docker (aşağıda **OVH yerine ucuz alternatif** tablosu da var).
- **Türkiye içi:** müşteri veri yerleşimi istiyorsa yerel VPS / bulut sağlayıcı seçin.

**Minimum kaynak (küçük ekip, tek WAHA oturumu):**

- **2 vCPU, 4 GB RAM** — rahat başlangıç.
- **4 vCPU, 8 GB RAM** — çok oturum, yoğun medya, daha fazla eşzamanlı kullanıcı için.

**Disk:** SSD, en az **40–80 GB** (WAHA oturum verisi + yüklenen dosyalar büyüyebilir).

**İşletim sistemi:** Ubuntu Server **22.04 LTS** veya **24.04 LTS**.

### Alternatif: yönetilen servisler

- **PostgreSQL:** Neon, Supabase, AWS RDS, DigitalOcean Managed DB — `DATABASE_URL` ile bağlanırsınız; `docker-compose` içinden Postgres servisini çıkarıp URL verirsiniz.
- **Redis:** Upstash, Redis Cloud, ElastiCache — `REDIS_HOST` / şifre ortam değişkenlerine göre ayarlanır.
- **Uygulama:** **Railway**, **Render**, **Fly.io** ile backend/frontend ayrı deploy mümkün; bu durumda WAHA genelde **ayrı bir VPS**’te kalır (WhatsApp oturumu ve dosya sistemi için pratik çözüm).

Müşteriye özet cümle: **“Canlıda en sorunsuz yol: tek güçlü VPS + Docker; büyüdükçe veritabanı ve Redis yönetilen servise taşınabilir.”**

### OVH kurulmadıysa veya daha ucuz sağlayıcı

OVH’de VPS **henüz teslim / kurulmamış**, **iade süreci** veya **bütçe** nedeniyle başka yerden devam etmek istiyorsanız sorun değil: bu proje **herhangi bir VPS’te** aynı şekilde çalışır — şartlar **Ubuntu Server**, **SSH erişimi**, **public IPv4** (ve mümkünse alan adı + SSL).

**Scaleway pahalı geliyorsa** aynı kurulumu (Ubuntu + Docker + bu repo) genelde **daha ucuza** şu sağlayıcılardan birinde yaparsınız; fiyatlar sürekli değiştiği için kurulum öncesi **4 GB RAM**’li bir planın **aylık toplamını** (disk dahil) kendi sitelerinden karşılaştırın.

| Sağlayıcı | Genel not |
|------------|-------------|
| **[Hetzner](https://www.hetzner.com/cloud)** (CX22, CPX21, CPX31…) | Çoğu projede **fiyat/performans en iyi dengesi**; Almanya / Finlandiya. Önce buraya bakmak mantıklı. |
| **[Contabo](https://contabo.com)** | Liste fiyatı çok düşük; CPU “paylaşımlı” olabilir, destek ve gecikme yorumları değişken. |
| **[Netcup](https://www.netcup.com)** (root sunucu / VPS) | Almanya merkezli; kampanyalı fiyatlar; panel alışkanlığı gerekir. |
| **[IONOS](https://www.ionos.com)** VPS | Paket halinde VPS; fiyat rekabetçi olabilir. |
| **[Hostinger](https://www.hostinger.com/vps-hosting)** VPS | hPanel + KVM; **ayrı bölüm** bu dosyada. |
| **[Vultr](https://www.vultr.com)** | Şehir bazlı lokasyon çok; küçük planlar Scaleway’den ucuz gelebilir. |
| **[Linode (Akamai)](https://www.linode.com)** | Öngörülebilir fiyat; DO ile benzer segment. |
| **[DigitalOcean](https://www.digitalocean.com)** Droplet | Kolay dokümantasyon; fiyat ara sıra kampanyalı. |
| **[Scaleway](https://www.scaleway.com)** | Özellik ve bölge ihtiyacınız varsa; saf fiyat yarışında sık sık geride kalır. |
| **[Google Cloud](https://cloud.google.com)** (Compute Engine) | Kurumsal; küçük VM bazen kampanyalı kredi ile ucuz başlar, sonra pahalılaşabilir. |
| **Yerel Türk VPS / hosting** | Destek TR, KVK konuşması kolay; fiyatı Hetzner ile kıyaslayın. |

**Özet öneri:** Önce **Hetzner Cloud** fiyatına bakın; yetmezse **Contabo** veya **Vultr** ile **≥4 GB RAM** planlarını karşılaştırın. Kurulum adımları her yerde aynı: bu dosyada **Docker** + **Bölüm 4**.

**Ne yapacaksınız:** Sağlayıcı panelinden **Ubuntu 24.04 LTS** (veya 22.04) seçin → **root veya ubuntu kullanıcısı + SSH** ile bağlanın → bu dosyada **OVH bölümündeki “Docker kurulumu” ve sonrası** ile aynı komutlar geçerli (UFW, `docker compose`, env). OVH’ye özel sadece **panel menü isimleri** farklıdır.

---

## Scaleway’de kurulum (Instances)

[Konsol](https://console.scaleway.com) üzerinden; menü isimleri İngilizce olabilir. Bu CRM + Postgres + Redis + WAHA için **en az ~4 GB RAM** önerilir (çok küçük “development” instance’larda sıkışma yaşanır).

### 1) Hesap ve proje

1. Scaleway hesabı oluşturun / giriş yapın.
2. Üst kısımdan doğru **Project**’i seçin (varsayılan proje yeterli).

### 2) Instance oluşturma

1. Sol menü: **Compute** → **Instances** → **Create instance** (veya **+**).
2. **Region / Zone:** Örn. **PAR-1**, **AMS-1**, **WAW-1** — size ve müşteriye yakın bölgeyi seçin.
3. **Image:** **Ubuntu 24.04** veya **Ubuntu 22.04 LTS** (resmi “OS images” listesinden).
4. **Instance type:** Üretim için **General Purpose (GP)** veya eşdeğerinde **≥4 GB RAM** seçin; yalnızca deneme için en küçük tipler kullanılabilir.
5. **Block storage:** Varsayılan disk çoğu kurulum için yeterli; canlıda **40 GB+** düşünün.
6. **Public IP:** Açık kalsın (Elastic IP atayabilirsiniz; IP değişmesin istiyorsanız sabit IP dokümantasyonuna bakın).
7. **SSH key:** Instance oluştururken hesabınıza kayıtlı bir **SSH public key** seçin. Key yoksa: **IAM** / **Credentials** / **SSH keys** bölümünden önce anahtarınızı ekleyin. (Çoğu Ubuntu imajında ilk giriş **root** veya Scaleway’in gösterdiği kullanıcı ile **anahtar** üzerinden olur.)
8. İsim verip oluşturun; durum **running** olunca **Public IPv4** adresini not edin.

### 3) Güvenlik grubu (Security group)

1. Instance sayfasında **Security group** veya **Network** altından ilgili gruba girin.
2. **Inbound:** **22** (SSH — mümkünse yalnızca ofis IP’niz), **80**, **443**.  
3. **3000, 4000, 5432, 6379** gibi portları **tüm internete açmayın**; CRM’e **Nginx / Caddy** ile 443 üzerinden gideceksiniz (bkz. bu dosyada TLS bölümü).

### 4) İlk SSH ve güncelleme

Bağlantı bilgisi instance ekranında **“SSH command”** benzeri satırda yazar; genelde **`root@IP`** veya **`ubuntu@IP`**. Konsolda ne yazıyorsa onu kullanın:

```bash
ssh root@SUNUCU_PUBLIC_IP
```

İlk bağlantıda host fingerprint sorusuna **yes** deyin. Ardından:

```bash
apt update && apt upgrade -y
```

(`ubuntu` kullanıcısındaysanız: `sudo apt update && sudo apt upgrade -y`.)

### 5) CRM kurulumuna devam

Bu dosyada **OVH bölümündeki** sırayı izleyin (aynı Ubuntu komutları):

- **Güvenlik duvarı (UFW)** — isteğe bağlı ama önerilir.
- **Docker kurulumu (Ubuntu)** — tam blok aynen çalışır.
- **Bölüm 4** — `git clone`, kök `.env`, `docker-compose` içi şifreler, `FRONTEND_URL`, `WAHA_WEBHOOK_URL`, `docker compose build` / `up -d`.

### Scaleway’e özel kısa notlar

- **Fatura:** kullanım + instance tipi; konsolda **Billing** ile limit/uyarı ayarlayın.
- **Snapshot:** ücretli yedek için instance snapshot kullanılabilir; veritabanı için ayrıca `pg_dump` önerilir.
- **Support plan:** ücretsiz destek sınırlı olabilir; kritik müşteri için ücretli destek paketine bakın.

---

## Contabo’da kurulum (Cloud VPS)

[Contabo](https://contabo.com) **Cloud VPS** veya **VPS** ürünü ile aynı yığın kurulur: **Ubuntu + Docker + bu repodaki `docker-compose`**. Bu CRM + WAHA + Postgres için **en az 4 GB RAM** önerilir (Contabo paketlerinde genelde **Cloud VPS M** ve üzeri uygun başlangıç olur; sayfadaki RAM / vCPU tablosuna bakın).

### 1) Sipariş ve teslim

1. [contabo.com](https://contabo.com) → **Cloud VPS** (veya **VPS**) → bölge (ör. **European Union**, **UK**, **US**) ve **Ubuntu 22.04 / 24.04** imajını seçin.
2. Siparişi tamamlayın. **Kurulum (provisioning) bazen birkaç saat sürebilir**; e-postada veya **Customer Control Panel**’de sunucu **aktif** olunca devam edin.
3. Teslim e-postasında veya panelde **IPv4 adresi**, **root şifresi** veya **hostname** yer alır; not edin.

### 2) Contabo Control Panel

1. [my.contabo.com](https://my.contabo.com) (veya sipariş sonrası verilen **Customer Control Panel** adresi) ile giriş yapın.
2. **VPS** listenizden ilgili sunucuyu seçin.
3. **İşletim sistemi / yeniden kurulum** gerekiyorsa panelde **Reinstall** / **OS reinstall** benzeri seçenekten **Ubuntu 24.04** veya **22.04 LTS** seçin.  
   - **Uyarı:** Yeniden kurulum diski sıfırlar.

### 3) SSH ile bağlanma

Genelde **root** kullanıcısı ve teslim e-postasındaki **şifre** ile:

```bash
ssh root@SUNUCU_IPV4_ADRESI
```

İlk seferde host key sorusuna **yes** deyin. **SSH key** eklemek isterseniz sunucuya girdikten sonra `~/.ssh/authorized_keys` ile root veya ayrı bir kullanıcıya tanımlayabilirsiniz (Contabo sipariş ekranında bazen anahtar alanı da olur).

```bash
apt update && apt upgrade -y
```

(İmaj `ubuntu` kullanıcısı veriyorsa `sudo` kullanın.)

### 4) Güvenlik duvarı

Contabo panelinde hazır “cloud firewall” her planda olmayabilir; sunucuda **UFW** kullanmak iyi olur — bu dosyada **OVH bölümündeki UFW** komutları aynen uygulanır (**22, 80, 443** açık; **3000, 4000, 5432** dışarı kapalı).

### 5) CRM kurulumuna devam

Bu dosyada sıra:

1. **Docker kurulumu (Ubuntu)** — OVH bölümündeki blok birebir.
2. **Bölüm 4** — `git clone`, kök `.env`, `docker-compose` şifreleri, `FRONTEND_URL`, `WAHA_WEBHOOK_URL`, `docker compose build` / `up -d`.
3. **TLS** — Nginx veya Caddy ile **HTTPS** (Let’s Encrypt).

### Contabo’ya özel notlar

- **CPU:** Düşük fiyatta vCPU “paylaşımlı” hissedilebilir; ağır eşzamanlı kullanımda bir üst paketi düşünün.
- **Destek:** Ticket süreleri değişken; üretim müşterisinde yedek ve izleme planı yapın.
- **Yedek:** Panelden snapshot / yedek seçenekleri ürüne göre değişir; ayrıca `pg_dump` ve WAHA volume yedekleri önerilir.

---

## Hostinger VPS ile kurulum

[Hostinger VPS](https://www.hostinger.com/vps-hosting) (KVM) üzerinde kurulum da **Ubuntu + Docker + bu repodaki `docker-compose`** ile yapılır. Bu CRM + WAHA + Postgres için **en az 4 GB RAM** plan seçmeniz önerilir (Hostinger paket isimlerini kendi sitedeki tablodan doğrulayın).

### 1) Panel ve sunucu

1. [Hostinger](https://www.hostinger.com) → giriş → **VPS** bölümü (çoğu kullanıcıda **hPanel** üzerinden).
2. Sipariş ettiğiniz VPS’i seçin; durum **Running / Aktif** ve **IP adresi** görünene kadar bekleyin (ilk kurulum birkaç dakika sürebilir).
3. İşletim sistemi sipariş sırasında seçildiyse genelde **Ubuntu** gelir. Değiştirmek veya yeniden kurmak için panelde **OS şablonu / Reinstall / Change OS** benzeri menüye bakın → **Ubuntu 24.04** veya **22.04 LTS** seçin.  
   - **Uyarı:** OS yenileme diski sıfırlar.

### 2) SSH ile bağlanma

Panelde çoğu zaman **SSH erişimi**, **root şifresi** veya **SSH anahtarı** alanı bulunur; e-postada da iletilir.

```bash
ssh root@SUNUCU_IP_ADRESI
```

Bazı şablonlarda kullanıcı **`ubuntu`** olabilir; panelde “SSH command” veya dokümantasyon satırına uyun. İlk bağlantıda host key sorusuna **yes** deyin:

```bash
apt update && apt upgrade -y
```

(`ubuntu` kullanıcısındaysanız `sudo apt update && sudo apt upgrade -y`.)

### Bağlandıktan sonra — komut sırası (özet)

Aşağıdakileri **SSH oturumunda** sırayla çalıştırın (`root` isen `sudo` yazmanız gerekmez; `ubuntu` kullanıcısıysanız `sudo` ekleyin).

**1) Sistem güncellemesi + Git**

```bash
apt update && apt upgrade -y
apt install -y git
```

**2) Docker Engine + Compose** (Ubuntu için; resmi: [Docker — Ubuntu](https://docs.docker.com/engine/install/ubuntu/))

```bash
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

**3) Proje dosyaları** — repoyu GitHub/GitLab’da tutuyorsanız (URL’yi kendi repoonla değiştir):

```bash
mkdir -p /opt/atmaca-crm && cd /opt/atmaca-crm
git clone https://github.com/KULLANICI/REPO.git .
```

Repoyu bilgisayarında tutuyorsan: kendi PC’nden `scp -r` veya `rsync` ile `/opt/atmaca-crm` içine at; ya da repoyu önce Git’e push edip sunucuda `git clone`.

**4) Ortam dosyaları** — kök dizinde `.env` oluştur (örnek; alan adın yoksa geçici olarak IP ile test — canlıda HTTPS kullanın):

```env
NEXT_PUBLIC_API_URL=http://SUNUCU_IP:4000/api
NEXT_PUBLIC_WS_URL=http://SUNUCU_IP:4000
```

`docker-compose.yml` içindeki `JWT_SECRET`, `POSTGRES_PASSWORD`, `FRONTEND_URL` (ör. `http://SUNUCU_IP:3000` veya alan adın), `WAHA_WEBHOOK_URL` (dışarıdan erişilen backend webhook URL’si) değerlerini üretime göre düzenle. WAHA için güçlü `WAHA_API_KEY` tanımla; geliştirme `WAHA_NO_API_KEY` kullanmayın.

**5) Çalıştırma**

```bash
cd /opt/atmaca-crm
docker compose build --no-cache
docker compose up -d
docker compose ps
```

İlk açılışta backend konteyneri `prisma migrate deploy` çalıştırır. Log: `docker compose logs -f backend`.

### 3) Güvenlik duvarı

Hostinger panelinde **Firewall** varsa: dışarıdan **22** (SSH), **80**, **443** açık olsun. **3000, 4000, 5432** portlarını tüm dünyaya açmayın; CRM trafiği **Nginx / Caddy** ile 443’ten gelsin. Panel firewall yoksa sunucuda **UFW** kullanın — bu dosyada **OVH bölümündeki UFW** komutları geçerlidir.

### 4) CRM kurulumuna devam

1. Bu dosyada **Docker kurulumu (Ubuntu)** — OVH bölümündeki blok.
2. **Bölüm 4** — `git clone`, kök `.env`, `docker-compose`, `FRONTEND_URL`, `WAHA_WEBHOOK_URL`, `docker compose build` / `up -d`.
3. **TLS** — alan adınızı VPS IP’sine yönlendirip Let’s Encrypt (Nginx/Caddy).

### Hostinger’e özel kısa notlar

- **Kiracı paneli:** VPS yönetimi `hpanel.hostinger.com` veya hesap menüsünde **VPS** altında toplanır; arayüz güncellenebilir, menü isimleri İngilizce/Türkçe karışık olabilir.
- **Snapshot:** Ücretli / plana dahil snapshot varsa üretim öncesi bir alın.
- **Destek:** Canlı sohbet / ticket ile OS veya ağ sorularında yardım alabilirsiniz.

---

## Google Cloud (GCP) ile canlıya alma

**Evet.** Bu proje GCP üzerinde de aynı mantıkla çalışır: **Ubuntu sanal makine + Docker + `docker-compose`**.

### Neden sanal makine (Compute Engine)?

**WAHA** (WhatsApp oturumu, kalıcı dosyalar), **PostgreSQL** ve **Redis** bu repoda Docker ile birlikte kurgulanmış. **Cloud Run** veya saf **App Engine** gibi “sunucusuz” ortamlar WAHA + uzun ömürlü volume senaryosu için genelde uygun değildir. En az sürtünmeyle yol: **Compute Engine VM** (tek VM = mevcut `docker-compose` ile birebir).

İleride büyürseniz: **Cloud SQL** (Postgres), **Memorystore** (Redis), ayrı küçük VM’de sadece WAHA gibi parçalara ayırma mümkün; başlangıç için zorunlu değil.

### 1) GCP projesi

1. [Google Cloud Console](https://console.cloud.google.com) → yeni veya mevcut **proje** seçin.
2. **Billing** (faturalandırma) projeye bağlı olsun.
3. **API’leri açın:** **Compute Engine API** (VM oluşturmak için) — ilk VM sihirbazı genelde sizi yönlendirir.

### 2) Compute Engine VM oluşturma

1. **Navigation menu** → **Compute Engine** → **VM instances** → **Create instance**.
2. **Region / Zone:** müşteriye yakın (ör. `europe-west3` Frankfurt, `europe-west1` Belçika).
3. **Machine configuration:** bu stack için makul başlangıç **e2-standard-2** (2 vCPU, 8 GB RAM) veya daha sıkı bütçede **e2-medium** (daha az RAM; WAHA yoğunluğuna dikkat).
4. **Boot disk:** **Ubuntu 24.04 LTS** veya **22.04 LTS**, disk **40 GB** veya üzeri SSD (balanced).
5. **Firewall:** “**Allow HTTP traffic**” ve “**Allow HTTPS traffic**” kutularını işaretleyin (80/443 için network tag’leri ekler). **SSH** varsayılan olarak açılır.
6. **SSH Keys:** “SSH Keys” bölümünden kendi public key’inizi ekleyebilir veya oluşturduktan sonra konsoldan **SSH** butonu ile tarayıcı içi oturum açabilirsiniz.
7. **Create** — VM **Running** olunca **External IP**’yi not edin. IP sabit olsun istiyorsanız **VPC network** → **IP addresses** → **Reserve static external IP** ile VM’e bağlayın.

### 3) Güvenlik duvarı (GCP)

- **VPC network** → **Firewall rules:** VM’e gelen trafikte **tcp:22** (SSH, mümkünse kaynak IP kısıtlı), **tcp:80**, **tcp:443** yeterli.
- **3000, 4000, 5432, 6379** portlarını **0.0.0.0/0’e açmayın**; kullanıcı trafiği **Nginx / HTTPS Load Balancer** veya tek VM’de **Caddy/Nginx → localhost:3000/4000** üzerinden gelsin (bkz. bu dosyada TLS bölümü).

### 4) SSH ve kurulum

Kendi terminalinizden (GCP’de kullanıcı adı çoğu Ubuntu imajında **`YOUR_USERNAME`** veya **`ubuntu`** olabilir):

```bash
ssh -i ~/.ssh/your_key YOUR_USERNAME@DIS_IP_ADRESI
```

Sonra bu dosyada **OVH / Scaleway bölümündeki** sıra:

```bash
sudo apt update && sudo apt upgrade -y
```

→ **UFW** (isteğe bağlı) → **Docker Engine + Compose plugin** → proje dizini → **`.env` + `docker-compose`** (**Bölüm 4**).

### 5) GCP’ye özel pratik notlar

- **Maliyet uyarısı:** [Billing](https://console.cloud.google.com/billing) → **Budgets & alerts** ile aylık limit e-postası tanımlayın.
- **Disk snapshot:** VM’i düzenli yedeklemek için **Snapshots** kullanılabilir (ücretli).
- **Egress:** dışarı çıkan trafik ücretlendirilebilir; WAHA/WhatsApp trafiğini göz önünde bulundurun.
- **GKE (Kubernetes):** mümkün ama bu repo için genelde **fazla karmaşık**; tek VM + Docker daha hızlı canlıya çıkarır.

---

## OVH’de kurulum (VPS veya Public Cloud)

OVH kullanacaksanız aşağıdaki adımlar geçerlidir. **Kullanmayacaksanız** bu bölümü atlayıp yukarıdaki alternatif VPS + **Bölüm 3** (ön koşullar) ve **Docker** adımlarına geçin.

OVHcloud’da akış, diğer VPS sağlayıcılarıyla aynıdır: **Ubuntu + Docker + bu repodaki `docker-compose`**. Aşağıdaki adımlar OVH paneline göre isimlendirilmiştir.

### VPS daha kurulmamışsa — önce bunu yapın

Sipariş verdiniz ama sunucuya hiç girmediyseniz sıra genelde şöyledir:

**Teslim bekliyorsanız:** OVH’de kurulum / provisioning süresi değişebilir (bazen birkaç dakika, bazen daha uzun). Gelen e-postayı ve paneldeki VPS durumunu takip edin; **“Running”** ve **IPv4** görününce aşağıdaki adımlara geçmeniz yeterli.

1. **[OVHcloud Control Panel](https://www.ovh.com/manager/)** ile giriş yapın.
2. Sol menüden **Bare Metal Cloud** → **Virtual private servers** (veya size gösterilen VPS bölümü) → **satın aldığınız VPS** satırına tıklayın.
3. Durum **kurulum / provisioning** ise birkaç dakika bekleyin; hazır olunca **IPv4 adresi** görünür (bunu not edin).
4. **İşletim sistemi yoksa** veya emin değilseniz: VPS sayfasında **“OS’i yeniden yükle” / “Reinstall my VPS”** benzeri seçenek → dağıtım olarak **Ubuntu 24.04 LTS** (veya **22.04 LTS**) seçin → onaylayın.  
   - **Uyarı:** Yeniden yükleme diski sıfırlar; üzerinde henüz veri yoksa sorun değil.
5. Kurulum bitince e-postada veya panelde **ilk kullanıcı** bilgisi gelir: çoğu Ubuntu imajında kullanıcı adı **`ubuntu`** ve giriş **SSH anahtarı** veya **root şifresi** ile olur (OVH’nin gönderdiği metne bakın).
6. Kendi bilgisayarınızdan bağlanın:
   - **Mac / Linux / Windows 10+:** Terminal veya PowerShell:
     ```bash
     ssh ubuntu@SUNUCUNUN_IPV4_ADRESI
     ```
   - **Eski Windows:** [PuTTY](https://www.putty.org/) ile aynı IP ve port 22.
   - İlk seferde “Are you sure you want to continue connecting?” çıkarsa **`yes`** yazın.
7. İçeri girdikten sonra (bağlantı kurulduysa VPS “kurulmuş” sayılır; sırada yazılım var):
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```
   İsteğe bağlı saat dilimi: `sudo timedatectl set-timezone Europe/Istanbul`

Bundan sonra bu bölümdeki **güvenlik duvarı (UFW)** ve **Docker** adımlarına geçin; en sonda **projeyi çalıştırma** var.

---

### 1) Ürün seçimi

- **OVHcloud VPS** (ör. *Value*, *Essential*, *Comfort*): tek sunucu, sabit fiyat; küçük/orta CRM için uygun.
- **Public Cloud** (Compute instance): saatlik faturalama, ölçeklendirme; API ile otomasyon isteyenler için.

Kurulum için ikisinde de **Linux dağıtımı olarak Ubuntu Server 22.04 veya 24.04 LTS** seçin. **En az 4 GB RAM** önerilir (WAHA + Postgres + Node aynı makinede).

### 2) Sunucuyu oluşturma

1. [OVHcloud Control Panel](https://www.ovh.com/manager/) → **Bare Metal Cloud** veya **Public Cloud** (hangi ürünü aldıysanız).
2. Yeni VPS / yeni instance oluşturun; bölge (ör. **Gravelines**, **Frankfurt**) müşteri ile uyumlu olsun.
3. **SSH anahtarı** eklemeniz önerilir (şifre yerine); root veya sudo kullanıcı ile bağlanacaksınız.

### 3) İlk SSH bağlantısı

```bash
ssh ubuntu@SUNUCU_IPV4_ADRESI
```

(İmajda kullanıcı `ubuntu` değilse OVH’nin verdiği kullanıcı adını kullanın, örn. `debian`.)

### 4) Güvenlik duvarı (OVH + sunucu)

- OVH tarafında **Network Security Group** / firewall varsa: dışarıdan yalnız **22** (SSH), **80** ve **443** açık olsun.
- Sunucuda **UFW** kullanıyorsanız:

  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```

PostgreSQL (5432), Redis, WAHA ve uygulama portlarını **internetten açmayın**; erişim **Nginx/Caddy** üzerinden 443 ile gelsin (bkz. bu dosyada “TLS ve reverse proxy”).

### 5) Docker kurulumu (Ubuntu)

Resmi adımlar: [Docker Engine — Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Özet:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Oturumu kapatıp tekrar açın; sonra `docker compose version` ile doğrulayın.

### 6) Alan adı (DNS)

- Alan adı **OVH Web Cloud**’da ise: **Alan adları** → DNS zone → **A** kaydı `@` ve `crm` (veya kullandığınız alt alan) → **VPS’nin IPv4** adresi.
- Alan adı başka firmadaysa yine **A** kaydı aynı şekilde OVH sunucu IP’sine yönlendirilir.
- SSL için sunucuda **Caddy** veya **Certbot + Nginx** kullanın (Let’s Encrypt).

### 7) Bu projeyi çalıştırma

Sunucuda:

```bash
sudo mkdir -p /opt/atmaca-crm && sudo chown $USER:$USER /opt/atmaca-crm
cd /opt/atmaca-crm
git clone <repo-url> .
```

Kök dizinde **üretim `.env`** (Git’e girmesin): `NEXT_PUBLIC_*`, ve `docker-compose.yml` içindeki `JWT_SECRET`, `POSTGRES_PASSWORD`, `FRONTEND_URL`, `WAHA_*` değerlerini canlıya göre düzenleyin. Ardından:

```bash
docker compose build --no-cache
docker compose up -d
```

Detaylı env ve TLS için bu dosyada **Bölüm 4** ve **WAHA güvenliği** bölümlerine bakın.

### OVH’ye özel kısa notlar

- **IPv6:** OVH IPv6 veriyorsa DNS’de `AAAA` ekleyebilirsiniz; Socket.IO ve tarayıcı uyumu için hem A hem AAAA tutarlı olmalı.
- **Kurtarma (rescue) modu:** disk veya önyükleme sorununda OVH Manager’dan rescue açılıp disk onarımı yapılabilir.
- **Yedek:** OVH “Backup” seçeneği ücretli ekstra olabilir; en azından `pg_dump` ve volume yedeklerini kendiniz planlayın.

---

## 3. Ön koşullar

- Sunucuda **Docker** ve **Docker Compose** (v2 plugin: `docker compose`).
- Alan adı (ör. `crm.sirket.com`, `api.sirket.com` veya tek domain altında path/reverse proxy).
- **SSL sertifikası** (Let’s Encrypt önerilir).

---

## 4. Yol A — Docker Compose ile kurulum (önerilen)

### 4.1 Sunucuya kod

```bash
git clone <repo-url> atmaca-crm
cd atmaca-crm
cp .env.example .env
nano .env   # POSTGRES_PASSWORD, JWT_SECRET, FRONTEND_URL, NEXT_PUBLIC_* (canlı URL)
```

Kök `.env` dosyası `docker compose` tarafından otomatik okunur; şablon: repodaki **`.env.example`**.

### 4.2 Üretim için `docker-compose` düzenlemeleri

Kök `docker-compose.yml` geliştirme içindir. Canlıda mutlaka:

1. **Şifreler:** `POSTGRES_PASSWORD`, `JWT_SECRET`, WAHA için güçlü `WAHA_API_KEY` (aşağıdaki WAHA bölümü).
2. **`FRONTEND_URL`:** Müşterinin tarayıcıdan açtığı tam adres, örn. `https://crm.ornek.com`.
3. **Frontend build zamanı env:** Next.js’te `NEXT_PUBLIC_*` değişkenleri **build sırasında** gömülür. Kök dizinde Compose’un okuduğu bir `.env` dosyası oluşturun (bu dosyayı Git’e eklemeyin):

   ```env
   NEXT_PUBLIC_API_URL=https://api.ornek.com/api
   NEXT_PUBLIC_WS_URL=https://api.ornek.com
   ```

   Ardından:

   ```bash
   docker compose build --no-cache frontend
   docker compose up -d
   ```

   `docker-compose.yml` bu değişkenleri frontend imajına `build.args` olarak iletir. İsterseniz doğrudan:

   ```bash
   docker compose build --no-cache frontend \
     --build-arg NEXT_PUBLIC_API_URL=https://api.ornek.com/api \
     --build-arg NEXT_PUBLIC_WS_URL=https://api.ornek.com
   ```

   **Pratik:** Tek domain kullanıyorsanız Nginx/Caddy ile `https://ornek.com` → frontend, `https://ornek.com/api` → backend; bu durumda `NEXT_PUBLIC_API_URL=https://ornek.com/api` ve `NEXT_PUBLIC_WS_URL=https://ornek.com` (tarayıcı HTTPS ise Socket.IO genelde `wss` kullanır).

4. **`WAHA_WEBHOOK_URL`:** İnternetten erişilen **HTTPS** veya en azından WAHA’nın ulaştığı tam URL, örn. `https://api.ornek.com/api/waha/webhook`.

### 4.3 TLS ve reverse proxy (tek sunucu örneği)

Sunucuda **Caddy** veya **Nginx**:

- `crm.ornek.com` → `127.0.0.1:3000` (frontend konteyneri dışarı açmadan, sadece localhost’ta dinletip proxy daha güvenli olabilir).
- `api.ornek.com` → `127.0.0.1:4000` (backend + WebSocket upgrade başlıkları).

`docker-compose` içinde portları sadece `127.0.0.1:3000:3000` şekilde bağlayıp dış dünyaya yalnızca 443 üzerinden proxy açmanız önerilir.

### 4.4 İlk çalıştırma

```bash
docker compose up -d
```

Backend Dockerfile içinde başlangıçta `npx prisma migrate deploy` çalışır; veritabanı şeması güncellenir.

### 4.5 İlk yönetici / seed

Projede `npm run prisma:seed` (backend) tanımlıysa, **tek sefer** konteyner içinde:

```bash
docker compose exec backend npx prisma db seed
```

`backend/package.json` içindeki `prisma.seed` değiştiyse veya ilk kez ekliyorsanız, konteynerdeki dosya güncellenmesi için: **`docker compose build --no-cache backend && docker compose up -d`**, ardından tekrar `db seed`.

**Varsayılan seed hesapları** (`backend/prisma/seed.ts` — ilk kurulumdan sonra mutlaka şifre değiştirin):

| Rol | E-posta | Şifre |
|-----|---------|--------|
| SUPERADMIN | `superadmin@saas.local` | `SuperAdmin2026!` |
| ADMIN | `admin@atmaca.com` | `Atmaca2026!` |

Organizasyon: slug `atmaca`, admin bu org’a bağlıdır.

### 4.6 Veritabanını tamamen sıfırlama (tablolar kalır, veri silinir)

Tüm iş verisini silip migrasyonları yeniden uygulayıp ardından seed çalıştırmak için (Docker):

```bash
cd /opt/atmaca-crm
docker compose exec backend npx prisma migrate reset --force
docker compose restart backend
```

`migrate reset`: veritabanını sıfırlar, tüm migrasyonları tekrar uygular, `package.json` içindeki `prisma.seed` ile seed’i çalıştırır. **Postgres dışındaki volume’lar (ör. WAHA oturumları) etkilenmez.**

Seed yoksa: API veya veritabanı üzerinden ilk `SUPERADMIN` / `ADMIN` kullanıcı oluşturma adımlarınızı dokümante edin (mevcut `register` akışı müşteri planına göre kapatılabilir).

---

## 5. Yol B — Manuel kurulum (Node + PM2 + Nginx)

1. Sunucuya **Node.js 20 LTS** kurun.
2. **PostgreSQL 16** ve **Redis 7** kurun veya yönetilen URL kullanın.
3. **Backend:**

   ```bash
   cd backend
   cp .env.example .env
   # .env dosyasını doldurun
   npm ci
   npx prisma migrate deploy
   npm run build
   NODE_ENV=production node dist/main
   ```

   PM2 örneği: `pm2 start dist/main.js --name crm-api`

4. **Frontend:**

   ```bash
   cd frontend
   cp .env.example .env.local
   # NEXT_PUBLIC_API_URL ve NEXT_PUBLIC_WS_URL üretim URL’leri
   npm ci
   npm run build
   npm run start
   ```

5. Nginx/Caddy ile SSL ve reverse proxy ayarlayın.

---

## 6. Ortam değişkenleri özeti

### Backend (`backend/.env`)

| Değişken | Canlıda not |
|----------|-------------|
| `DATABASE_URL` | Güvenli parola; bağlantı SSL gerekiyorsa sağlayıcı dokümantasyonuna bakın. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Üretimde şifre önerilir. |
| `JWT_SECRET` | Uzun rastgele string; asla repo içine commit etmeyin. |
| `PORT` | Genelde `4000`; proxy ile dışarı açılır. |
| `FRONTEND_URL` | **Tam** kök URL (https, sonunda `/` olmadan). CORS buna kilitlenir. |
| `WAHA_API_URL` | WAHA konteynerinin **iç ağ** adresi (Docker’da `http://waha:3000`). |
| `WAHA_API_KEY` | Üretimde WAHA ile aynı anahtar; boş bırakmayın. |
| `WAHA_WEBHOOK_URL` | Dışarıdan erişilen webhook URL’si. |
| `SMTP_*` | Şifre sıfırlama e-postası için zorunlu. |

### Frontend (`frontend/.env.local` veya build arg)

| Değişken | Açıklama |
|----------|----------|
| `NEXT_PUBLIC_API_URL` | Örn. `https://api.ornek.com/api` |
| `NEXT_PUBLIC_WS_URL` | Socket.IO kökü, örn. `https://api.ornek.com` (aynı hostta path proxy varsa `wss` kullanılır) |

Tarayıcı **HTTPS** ise WebSocket de **WSS** üzerinden gitmeli; aksi halde bağlantı bloklanır.

---

## 7. WAHA güvenliği (canlı zorunlu)

Geliştirme `docker-compose` içinde `WAHA_NO_API_KEY` ve şifresiz panel örnekleri **üretimde kapatılmalıdır.**

- `WAHA_API_KEY` güçlü değer; backend `.env` ile aynı.
- Dashboard şifresi veya erişimi kısıtlayın; mümkünse paneli sadece VPN / iç IP’den açın.
- Webhook URL’sini sadece kendi backend’inize işaret ettirin.

---

## 8. DNS kontrol listesi

- [ ] `A` / `AAAA` kayıtları sunucu IP’sine işaret ediyor.
- [ ] SSL sertifikası geçerli (Let’s Encrypt yenileme cron’u).
- [ ] `FRONTEND_URL` ile tarayıcıda açılan adres birebir uyumlu.
- [ ] WebSocket için reverse proxy’de **Upgrade** ve **Connection** başlıkları doğru.

---

## 9. Yedekleme ve izleme (müşteriye satılabilir paket)

- **PostgreSQL:** günlük `pg_dump` veya sağlayıcı otomatik yedek.
- **WAHA volume:** oturum verisi kaybolursa QR ile yeniden bağlanma gerekir; volume yedekleyin.
- **Yüklenen dosyalar:** backend `uploads/` klasörü — volume veya obje depolama (S3 uyumlu) planlayın.
- **Log:** `docker compose logs -f backend`; üretimde log rotasyonu ve uyarı (disk, 5xx) önerilir.

---

## 10. Müşteriye tanıtım — kısa konuşma metni

1. **“Uygulama sizin alan adınızda çalışır; veriler sizin sunucunuzda (veya seçtiğiniz bölgede) kalır.”**
2. **“WhatsApp oturumu WAHA üzerinden kurulur; telefonu QR ile bir kez bağlarsınız.”**
3. **“Temsilci ve yönetici rolleri vardır; atama ve gelen kutusu filtreleri panelden kullanılır.”**
4. **“İlk kurulumdan sonra şifreler ve API anahtarları sadece sizde kalır; destek için güvenli kanal kullanılır.”**

---

## 11. Sorun giderme

| Belirti | Kontrol |
|---------|---------|
| Giriş sonrası API 401 / CORS | `FRONTEND_URL` tam eşleşiyor mu; `NODE_ENV=production` mı? |
| Socket bağlanmıyor | `NEXT_PUBLIC_WS_URL`, HTTPS’te `wss`, proxy WebSocket |
| Webhook gelmiyor | `WAHA_WEBHOOK_URL` dışarıdan curl ile erişilebiliyor mu; firewall 443 |
| Migrasyon hatası | `DATABASE_URL` doğru; Postgres ayakta |

---

## 12. Hızlı referans komutları

```bash
# Loglar
docker compose logs -f backend

# Migrasyon (manuel tetik)
docker compose exec backend npx prisma migrate deploy

# Veritabanı shell
docker compose exec postgres psql -U crm_user -d whatsapp_crm
```

---

Bu dosya genel bir yol haritasıdır; müşteri sözleşmesine göre SLA, yedekleme sıklığı ve destek kanalı ayrıca yazılmalıdır.
