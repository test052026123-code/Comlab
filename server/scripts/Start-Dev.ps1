[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId = 'comlab-2ed9d',
    [string]$CredentialsPath = (Join-Path $env:USERPROFILE '.comlab-secrets\comlab-server.json'),
    [ValidateRange(1024, 65535)]
    [int]$ApiPort = 8080,
    [ValidateRange(1000, 15000)]
    [int]$ControllerTimeoutMs = 4000,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$comlabServerDirectory = Split-Path -Parent $PSScriptRoot
$comlabProjectDirectory = Split-Path -Parent $comlabServerDirectory
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer first.' }
$comlabNodeMajor = ((& node --version).TrimStart('v').Split('.')[0])
if ([int]$comlabNodeMajor -lt 22) { throw 'ComLab requires Node.js 22 or newer.' }
if (-not (Test-Path -LiteralPath $CredentialsPath -PathType Leaf)) {
    throw "Create a dedicated ComLab server service-account JSON key and save it at $CredentialsPath. Do not paste the key into chat. See server/WINDOWS_SETUP.md."
}
$comlabResolvedCredentials = (Resolve-Path -LiteralPath $CredentialsPath).Path
if ($comlabResolvedCredentials.StartsWith($comlabProjectDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Move the private server credential outside the project before starting.'
}
try { $comlabCredentialMetadata = Get-Content -LiteralPath $comlabResolvedCredentials -Raw | ConvertFrom-Json }
catch { throw 'Cannot read a valid service-account JSON file. File contents are intentionally omitted.' }
if ($comlabCredentialMetadata.type -ne 'service_account' -or $comlabCredentialMetadata.project_id -ne $ProjectId) {
    throw 'This is not a service-account JSON credential for the selected ComLab project. Web firebaseConfig is not a server credential.'
}
$comlabCredentialMetadata = $null
if (-not (Test-Path -LiteralPath (Join-Path $comlabServerDirectory 'node_modules\firebase-admin'))) {
    throw 'Run npm ci in the server folder first.'
}
if (-not $CheckOnly -and (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue)) {
    throw "Port $ApiPort is already in use. Stop the existing ComLab instance or choose another ApiPort."
}

$comlabEnvironmentNames = @('GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'CONTROLLER_URL', 'CONTROLLER_TOKEN', 'CONTROLLER_TIMEOUT_MS', 'HOST', 'PORT')
$comlabPreviousEnvironment = @{}
foreach ($comlabName in $comlabEnvironmentNames) { $comlabPreviousEnvironment[$comlabName] = [Environment]::GetEnvironmentVariable($comlabName, 'Process') }
$comlabSecret = $null
$comlabSecretPointer = [IntPtr]::Zero
try {
    $env:GOOGLE_APPLICATION_CREDENTIALS = $comlabResolvedCredentials
    $env:GOOGLE_CLOUD_PROJECT = $ProjectId
    $env:CONTROLLER_URL = 'http://comlab-controller.local'
    $env:CONTROLLER_TIMEOUT_MS = [string]$ControllerTimeoutMs
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$ApiPort
    $comlabSecret = Read-Host 'Controller pairing secret (hidden; never saved to a file)' -AsSecureString
    $comlabSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($comlabSecret)
    $env:CONTROLLER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($comlabSecretPointer)
    if ([string]::IsNullOrWhiteSpace($env:CONTROLLER_TOKEN)) { throw 'A controller pairing secret is required.' }
    Push-Location -LiteralPath $comlabServerDirectory
    try {
        & node scripts/check-environment.js
        if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; backend was not started.' }
        if (-not $CheckOnly) {
            Write-Host "Starting ComLab on http://127.0.0.1:$ApiPort (local loopback only)."
            Write-Host 'Use a trusted HTTPS front end for the tablet. Keep this terminal open; Ctrl+C stops the API.'
            & node src/index.js
            if ($LASTEXITCODE -ne 0) { throw 'ComLab API exited with an error.' }
        }
    } finally { Pop-Location }
} finally {
    foreach ($comlabName in $comlabEnvironmentNames) { [Environment]::SetEnvironmentVariable($comlabName, $comlabPreviousEnvironment[$comlabName], 'Process') }
    if ($comlabSecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($comlabSecretPointer) }
    if ($null -ne $comlabSecret) { $comlabSecret.Dispose() }
}
