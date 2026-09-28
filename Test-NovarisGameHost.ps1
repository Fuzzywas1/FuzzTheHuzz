# Read-only readiness check. Run on the Windows PC intended to host Roblox.
# Does not install software, launch games, change settings, or read credentials.
[CmdletBinding()]
param()

$osLabel = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
$gpuNames = @()
$notes = [System.Collections.Generic.List[string]]::new()

try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $osLabel = "$($os.Caption) ($($os.Version))"
} catch {
    $notes.Add('Detailed Windows version could not be read.')
}
try {
    $gpuNames = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop |
        ForEach-Object { $_.Name })
} catch {
    $notes.Add('GPU detection was unavailable. Find the GPU name in Task Manager > Performance.')
}

$robloxFound = $false
$robloxRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Roblox/Versions'),
    (Join-Path $env:ProgramFiles 'Roblox/Versions')
)
if (${env:ProgramFiles(x86)}) {
    $robloxRoots += Join-Path ${env:ProgramFiles(x86)} 'Roblox/Versions'
}
foreach ($root in $robloxRoots) {
    if (Test-Path -LiteralPath $root) {
        foreach ($version in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            if (Test-Path -LiteralPath (Join-Path $version.FullName 'RobloxPlayerBeta.exe')) {
                $robloxFound = $true
            }
        }
    }
}

$sunshineFound = Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'Sunshine/sunshine.exe')
if (!$sunshineFound -and (Get-Command sunshine.exe -ErrorAction SilentlyContinue)) {
    $sunshineFound = $true
}

if (!$robloxFound) { $notes.Add('Roblox was not found in standard desktop-client locations. A custom or Store installation may need a manual check.') }
if (!$sunshineFound) { $notes.Add('Sunshine was not found in its standard installation location or PATH.') }
$notes.Add('Detection does not verify hardware encoding, Roblox compatibility, or streaming performance.')
$notes.Add('Next test: launch Roblox locally on this host and confirm a game runs normally.')

[ordered]@{
    operatingSystem = $osLabel
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    graphicsAdapters = $gpuNames
    robloxDesktopClientDetected = $robloxFound
    sunshineDetected = [bool]$sunshineFound
    notes = $notes.ToArray()
} | ConvertTo-Json -Depth 4
