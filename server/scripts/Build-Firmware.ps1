param(
    [ValidateSet('controller', 'node', 'fingerprint-test', 'fingerprint-enroll')]
    [string]$Target = 'controller',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$comlabRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$comlabCli = Join-Path $env:ProgramFiles 'Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (-not (Test-Path -LiteralPath $comlabCli)) { throw 'Arduino CLI was not found in the installed Arduino IDE folder.' }
$comlabSketchName = switch ($Target) {
    'controller' { 'comlab_cloud' }
    'node' { 'comlab_node' }
    'fingerprint-test' { 'as608_test' }
    'fingerprint-enroll' { 'as608_enroll' }
}
$comlabOutputName = switch ($Target) {
    'controller' { 'cloud-firmware-build' }
    'node' { 'node-firmware-build' }
    default { "$Target-build" }
}
$comlabSketch = Join-Path $comlabRoot "firmware\$comlabSketchName"
$comlabOutput = Join-Path $comlabRoot "server\.local\$comlabOutputName"
$comlabLog = Join-Path $comlabRoot "server\.local\$comlabOutputName.log"
if ($Target -in @('controller', 'node') -and -not (Test-Path -LiteralPath (Join-Path $comlabSketch 'secrets.h'))) { throw 'Configure the local sketch secrets.h first.' }
if ($CheckOnly) {
    Write-Output "Ready to compile $Target with --jobs 1. No compilation or upload performed."
    return
}
if (Get-Process cc1plus -ErrorAction SilentlyContinue) { throw 'Another compiler is running. Stop or finish the Arduino IDE build first.' }
New-Item -ItemType Directory -Path $comlabOutput -Force | Out-Null
Write-Output "Compiling $Target with one compiler job. Keep Arduino IDE Verify/Upload stopped."
try {
    $ErrorActionPreference = 'Continue'
    & $comlabCli compile --fqbn esp32:esp32:esp32doit-devkit-v1 --jobs 1 --output-dir $comlabOutput $comlabSketch *> $comlabLog
    $comlabBuildExit = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop' }
if ($comlabBuildExit -ne 0) { throw "Build failed. Inspect the local log: $comlabLog. Close unused apps to free memory before retrying." }
Get-Content -LiteralPath $comlabLog | Where-Object { $_ -match '^Sketch uses|^Global variables' }
Write-Output "PASS: $Target built with one compiler job. Firmware was not uploaded."
