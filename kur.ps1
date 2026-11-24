# Memleket Savasi - tek komutla kurulum / guncelleme
# PowerShell'i "Yonetici olarak" ac, sonra README'deki komutu yapistir.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$hedef   = 'C:\MemleketSavasi'
$repoZip = 'https://github.com/bdemirhakan-del/memleket-savasi/archive/refs/heads/main.zip'
$nodeUrl = 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi'
$obsUrl  = 'https://github.com/obsproject/obs-studio/releases/download/30.2.3/OBS-Studio-30.2.3-Windows-Installer.exe'
$tmp     = Join-Path $env:TEMP 'memleket-kurulum'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Yenile-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

Write-Host "`n[1/5] Node.js kontrol ediliyor..." -ForegroundColor Cyan
Yenile-Path
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js indiriliyor ve kuruluyor (birkac dakika surebilir)..."
  $msi = Join-Path $tmp 'node.msi'
  Invoke-WebRequest $nodeUrl -OutFile $msi
  Start-Process msiexec.exe -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart' -Wait
  Yenile-Path
}
Write-Host "  Node.js surumu: $(node -v)" -ForegroundColor Green

Write-Host "`n[2/5] OBS kontrol ediliyor..." -ForegroundColor Cyan
$obsExe = 'C:\Program Files\obs-studio\bin\64bit\obs64.exe'
if (-not (Test-Path $obsExe)) {
  Write-Host "  OBS indiriliyor (yaklasik 140 MB) ve kuruluyor..."
  $obsSetup = Join-Path $tmp 'obs-kurulum.exe'
  Invoke-WebRequest $obsUrl -OutFile $obsSetup
  Start-Process $obsSetup -ArgumentList '/S' -Wait
}
if (Test-Path $obsExe) { Write-Host "  OBS kurulu." -ForegroundColor Green } else { Write-Host "  OBS kurulamadi. README'deki elle kurulum adimina bak." -ForegroundColor Yellow }

# Windows Server'da OBS icin gereken medya ozelligi (varsa atlar)
try {
  $r = Install-WindowsFeature Server-Media-Foundation -ErrorAction Stop
  if ($r.RestartNeeded -eq 'Yes') { Write-Host "  NOT: Medya ozelligi kuruldu, isin sonunda sunucuyu yeniden baslatman gerekebilir." -ForegroundColor Yellow }
} catch { }

Write-Host "`n[3/5] Oyun dosyalari indiriliyor..." -ForegroundColor Cyan
$zip = Join-Path $tmp 'oyun.zip'
Invoke-WebRequest $repoZip -OutFile $zip
$cikar = Join-Path $tmp 'cikar'
if (Test-Path $cikar) { Remove-Item $cikar -Recurse -Force }
Expand-Archive $zip -DestinationPath $cikar -Force
$kaynak = Get-ChildItem $cikar -Directory | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $hedef | Out-Null
# guncellemede senin ayarlarin ve kayitlarin silinmesin
foreach ($f in Get-ChildItem $kaynak.FullName -Force) {
  if (($f.Name -in 'config.json','stats.json') -and (Test-Path (Join-Path $hedef $f.Name))) { continue }
  Copy-Item $f.FullName -Destination $hedef -Recurse -Force
}
Write-Host "  Dosyalar: $hedef" -ForegroundColor Green

Write-Host "`n[4/5] Gerekli paketler kuruluyor..." -ForegroundColor Cyan
Push-Location $hedef
& npm.cmd install --omit=dev --no-audit --no-fund
Pop-Location

Write-Host "`n[5/5] Masaustu kisayolu olusturuluyor..." -ForegroundColor Cyan
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Memleket Savasi Baslat.lnk'))
$lnk.TargetPath = Join-Path $hedef 'baslat.bat'
$lnk.WorkingDirectory = $hedef
$lnk.Save()

Write-Host "`nKURULUM TAMAM." -ForegroundColor Green
Write-Host "Siradaki adim: $hedef\config.json dosyasini Not Defteri ile acip tiktokKullanici satirina TikTok kullanici adini yaz."
