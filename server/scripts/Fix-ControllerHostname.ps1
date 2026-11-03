#Requires -RunAsAdministrator
[CmdletBinding()]
param([System.Net.IPAddress]$ControllerAddress = '192.168.1.122')

$ErrorActionPreference = 'Stop'
if ($ControllerAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use the controller IPv4 address shown by its Serial Monitor.' }
$comlabAddress = $ControllerAddress.ToString()
$comlabBytes = $ControllerAddress.GetAddressBytes()
$comlabPrivate = $comlabBytes[0] -eq 10 -or ($comlabBytes[0] -eq 192 -and $comlabBytes[1] -eq 168) -or ($comlabBytes[0] -eq 172 -and $comlabBytes[1] -ge 16 -and $comlabBytes[1] -le 31)
if (-not $comlabPrivate) { throw 'Use a private laboratory LAN address, not a public address.' }
$comlabHostname = 'comlab-controller.local'
$comlabHostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$comlabHostsBytes = [IO.File]::ReadAllBytes($comlabHostsPath)
if ($comlabHostsBytes -contains 0) { throw 'The hosts file has an unexpected encoding. It was not modified; review it manually.' }
$comlabHostsText = [IO.File]::ReadAllText($comlabHostsPath)
$comlabAlreadyMapped = $false
foreach ($comlabLine in ($comlabHostsText -split '\r?\n')) {
    $comlabFields = ((($comlabLine -split '#', 2)[0]).Trim() -split '\s+')
    if ($comlabFields.Count -gt 1 -and $comlabFields[1..($comlabFields.Count - 1)] -contains $comlabHostname) {
        if ($comlabFields[0] -ne $comlabAddress) { throw 'A different address is already mapped to comlab-controller.local. No changes were made; review the existing entry.' }
        $comlabAlreadyMapped = $true
    }
}
if (-not $comlabAlreadyMapped) {
    # Read-only network probe before changing the single hostname mapping.
    $comlabHttpStatus = 0
    $comlabProbeFailure = 'No HTTP response'
    try {
        $comlabResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://$comlabAddress/v1/health" -TimeoutSec 5 -MaximumRedirection 0
        $comlabHttpStatus = [int]$comlabResponse.StatusCode
    } catch {
        if ($null -ne $_.Exception.Response) { $comlabHttpStatus = [int]$_.Exception.Response.StatusCode }
        elseif ($_.Exception -is [Net.WebException]) { $comlabProbeFailure = $_.Exception.Status.ToString() }
    }
    if ($comlabHttpStatus -eq 0) { throw "Controller $comlabAddress did not return an HTTP response within 5 seconds ($comlabProbeFailure). Keep the ESP32 powered and check its current IP in Serial Monitor at 115200 baud. The hosts file was not changed." }
    if ($comlabHttpStatus -ne 401) { throw "Controller $comlabAddress returned HTTP $comlabHttpStatus instead of the expected unauthenticated HTTP 401. The hosts file was not changed; verify the controller IP and connection-test firmware." }
    $comlabBackupDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) '.local'
    New-Item -ItemType Directory -Path $comlabBackupDirectory -Force | Out-Null
    $comlabBackupPath = Join-Path $comlabBackupDirectory ('hosts.before-comlab-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    Copy-Item -LiteralPath $comlabHostsPath -Destination $comlabBackupPath
    $comlabEntry = "`r`n# ComLab development controller; update if its DHCP address changes.`r`n$comlabAddress $comlabHostname`r`n"
    [IO.File]::AppendAllText($comlabHostsPath, $comlabEntry, (New-Object Text.UTF8Encoding($false)))
    Write-Host "Added only the ComLab hostname mapping. Backup: $comlabBackupPath"
} else {
    Write-Host 'The correct ComLab hostname entry is already present; no file change needed.'
}
Clear-DnsClientCache
$comlabResolved = @([Net.Dns]::GetHostAddresses($comlabHostname) | ForEach-Object { $_.IPAddressToString })
if ($comlabResolved -notcontains $comlabAddress) { throw 'The mapping is present, but Windows still did not resolve the expected address. Review DNS/hosts policy on this computer.' }
Write-Host "PASS: Windows resolves $comlabHostname to $comlabAddress."
Write-Host 'Return to the normal server PowerShell window and run .\scripts\Start-Dev.ps1 again.'
Write-Host 'This affects Windows only. The tablet still needs its own mDNS/router DNS resolution.'
