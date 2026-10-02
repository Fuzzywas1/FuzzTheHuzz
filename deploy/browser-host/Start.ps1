$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (!(Test-Path -LiteralPath './host-config.json')) { throw 'Run .\Setup.ps1 first.' }
node ./server.mjs ./host-config.json
if ($LASTEXITCODE -ne 0) { throw 'The browser host exited with an error.' }
