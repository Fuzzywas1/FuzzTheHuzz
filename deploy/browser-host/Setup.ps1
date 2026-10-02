param([string]$MediaAddress = '127.0.0.1', [ValidateRange(1, 4)][int]$MaxSessions = 1)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Get-Command node -ErrorAction Stop | Out-Null
Get-Command docker -ErrorAction Stop | Out-Null
$engine = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $engine -ne 'linux') { throw 'Start Docker Desktop with Linux containers, then run Setup.ps1 again.' }
$configPath = Join-Path $PSScriptRoot 'host-config.json'
if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    Write-Host 'Keeping the existing key and connection settings; rebuilding the image.'
} else {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $random.GetBytes($bytes)
    $random.Dispose()
    $config = [PSCustomObject]@{ key = [Convert]::ToBase64String($bytes); port = 8092; image = ''; mediaAddress = $MediaAddress; mediaPort = 57000; maxSessions = $MaxSessions }
}
docker pull ghcr.io/m1k1o/neko/chromium:3
if ($LASTEXITCODE -ne 0) { throw 'Could not pull the Neko image.' }
$baseImage = docker image inspect ghcr.io/m1k1o/neko/chromium:3 --format '{{index .RepoDigests 0}}'
if ($LASTEXITCODE -ne 0 -or $baseImage -notmatch '@sha256:[a-f0-9]{64}$') { throw 'Could not pin the upstream image.' }
docker build --build-arg "BASE_IMAGE=$baseImage" --tag novaris-neko:local ./image
if ($LASTEXITCODE -ne 0) { throw 'Browser image build failed.' }
$imageId = docker image inspect novaris-neko:local --format '{{.Id}}'
if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Could not read the built image ID.' }
$config.image = $imageId
$config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $configPath -Encoding UTF8
# Keep the shared host key private on disk. Docker access itself remains privileged.
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $configPath /inheritance:r /grant:r "${account}:(F)" 'SYSTEM:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict host-config.json permissions.' }
Write-Host 'Setup finished. Run .\Start.ps1 next.'
Write-Host 'The private host key is in host-config.json. Never upload that file or commit it.'
Write-Host "Media address: $($config.mediaAddress); UDP ports: $($config.mediaPort) through $($config.mediaPort + $config.maxSessions - 1)."
