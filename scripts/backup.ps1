# WhatsApp CRM - Yedekleme Script'i
# Kullanım: powershell -ExecutionPolicy Bypass -File scripts\backup.ps1

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backupDir = Join-Path $projectRoot "backups\backup_$timestamp"

Write-Host "=== WhatsApp CRM Yedekleme ===" -ForegroundColor Cyan
Write-Host "Tarih: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Hedef: $backupDir"
Write-Host ""

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# 1. PostgreSQL yedeği
Write-Host "[1/4] PostgreSQL veritabanı yedekleniyor..." -ForegroundColor Yellow
$envFile = Join-Path $projectRoot "backend\.env"
$dbUrl = (Get-Content $envFile | Select-String "DATABASE_URL=(.*)").Matches.Groups[1].Value

if ($dbUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)") {
    $dbUser = $Matches[1]
    $dbPass = $Matches[2]
    $dbHost = $Matches[3]
    $dbPort = $Matches[4]
    $dbName = $Matches[5]

    $env:PGPASSWORD = $dbPass
    $dbBackupFile = Join-Path $backupDir "database_$timestamp.sql"

    try {
        $pgDumpResult = $null
        try {
            $pgDumpResult = & pg_dump -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $dbBackupFile 2>&1
        } catch {
            # pg_dump yok, Docker ile deneyelim
        }

        if (-not (Test-Path $dbBackupFile) -or (Get-Item $dbBackupFile).Length -eq 0) {
            Write-Host "  pg_dump bulunamadı, Docker ile deneniyor..." -ForegroundColor Gray
            docker exec -e PGPASSWORD=$dbPass crm-postgres pg_dump -U $dbUser -d $dbName > $dbBackupFile 2>&1
        }

        if ((Test-Path $dbBackupFile) -and (Get-Item $dbBackupFile).Length -gt 0) {
            $size = (Get-Item $dbBackupFile).Length / 1KB
            Write-Host "  OK: $([math]::Round($size, 1)) KB" -ForegroundColor Green
        } else {
            Write-Host "  UYARI: DB yedeklenemedi" -ForegroundColor Red
        }
    } catch {
        Write-Host "  UYARI: Yedekleme hatası: $_" -ForegroundColor Red
    }
    $env:PGPASSWORD = ""
} else {
    Write-Host "  UYARI: DATABASE_URL ayrıştırılamadı" -ForegroundColor Red
}

# 2. Uploads klasörü
Write-Host "[2/4] Medya dosyaları yedekleniyor..." -ForegroundColor Yellow
$uploadsDir = Join-Path $projectRoot "backend\uploads"
if (Test-Path $uploadsDir) {
    $uploadsBackup = Join-Path $backupDir "uploads"
    Copy-Item -Path $uploadsDir -Destination $uploadsBackup -Recurse -Force
    $fileCount = (Get-ChildItem $uploadsBackup -File -Recurse).Count
    Write-Host "  OK: $fileCount dosya kopyalandı" -ForegroundColor Green
} else {
    Write-Host "  Uploads klasörü bulunamadı, atlanıyor" -ForegroundColor Gray
}

# 3. Konfigürasyon dosyaları
Write-Host "[3/4] Konfigürasyon dosyaları yedekleniyor..." -ForegroundColor Yellow
$configDir = Join-Path $backupDir "config"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$configFiles = @(
    "backend\.env",
    "frontend\.env.local",
    "backend\prisma\schema.prisma"
)

foreach ($cf in $configFiles) {
    $src = Join-Path $projectRoot $cf
    if (Test-Path $src) {
        $dest = Join-Path $configDir (Split-Path -Leaf $cf)
        Copy-Item -Path $src -Destination $dest -Force
        Write-Host "  $cf" -ForegroundColor Gray
    }
}
Write-Host "  OK" -ForegroundColor Green

# 4. Prisma migrations
Write-Host "[4/4] Prisma migration'lar yedekleniyor..." -ForegroundColor Yellow
$migrationsDir = Join-Path $projectRoot "backend\prisma\migrations"
if (Test-Path $migrationsDir) {
    $migBackup = Join-Path $backupDir "migrations"
    Copy-Item -Path $migrationsDir -Destination $migBackup -Recurse -Force
    Write-Host "  OK" -ForegroundColor Green
}

# Özet
Write-Host ""
Write-Host "=== Yedekleme Tamamlandı ===" -ForegroundColor Green
$totalSize = (Get-ChildItem $backupDir -File -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Toplam boyut: $([math]::Round($totalSize, 2)) MB"
Write-Host "Konum: $backupDir"
Write-Host ""
