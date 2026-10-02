param([string]$Destination = (Join-Path $env:USERPROFILE ('Documents\Novaris-browser-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$running = docker ps -q --filter 'label=com.novaris.neko-host=v1'
if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable.' }
if ($running) { throw 'End all Cloud Browser sessions and stop Start.ps1 with Ctrl+C before backing up.' }
$config = Get-Content -LiteralPath './host-config.json' -Raw | ConvertFrom-Json
$backupPath = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
$volumes = docker volume ls --format '{{.Name}}' --filter 'name=novaris-neko-profile-'
if ($LASTEXITCODE -ne 0) { throw 'Could not list profile volumes.' }
foreach ($volume in $volumes) {
    if ($volume -notmatch '^novaris-neko-profile-[a-f0-9]{64}$') { continue }
    docker run --rm --network none --entrypoint tar --mount "type=volume,src=$volume,dst=/profile,readonly" --mount "type=bind,src=$backupPath,dst=/backup" $config.image -czf "/backup/$volume.tar.gz" -C /profile .
    if ($LASTEXITCODE -ne 0) { throw "Backup failed for $volume." }
}
Write-Host "Profiles saved in $backupPath. These archives contain browser logins and history; store them privately."
