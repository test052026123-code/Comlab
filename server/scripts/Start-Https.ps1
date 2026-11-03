[CmdletBinding()]
param([ValidateRange(1024, 65535)][int]$ApiPort = 8080)
$ErrorActionPreference = 'Stop'
$comlabServerDirectory = Split-Path -Parent $PSScriptRoot
$comlabTunnelExecutable = Join-Path $comlabServerDirectory '.local\bin\cloudflared.exe'
if (-not (Test-Path -LiteralPath $comlabTunnelExecutable)) {
    throw 'Install the official cloudflared Windows executable as server/.local/bin/cloudflared.exe first. See WINDOWS_SETUP.md.'
}
# The actual HTTP/authentication probe is authoritative. Windows TCP inspection
# can return no entries even while the current user can reach the API.
Push-Location -LiteralPath $comlabServerDirectory
try {
    & node scripts/check-https.js "http://127.0.0.1:$ApiPort"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot reach the expected ComLab API on loopback. Keep Start-Dev.ps1 running in its separate window and check that its port matches ApiPort. Tunnel was not started.' }
    Write-Host 'Starting the temporary PUBLIC HTTPS tunnel you selected.'
    Write-Host 'Copy the actual https://...trycloudflare.com address printed by cloudflared into Trusted API HTTPS address.'
    Write-Host 'Use only the HTTPS origin: do not append /health, /v1 or /api. Keep this terminal open.'
    Write-Host 'The URL changes on restart. Ctrl+C closes the tunnel. No certificate-validation bypass is used.'
    & $comlabTunnelExecutable tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$ApiPort"
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflared stopped with an error. Check outbound network access and its console output.' }
} finally { Pop-Location }
