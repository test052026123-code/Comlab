param(
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$NodePort,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$comlabRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$comlabCli = Join-Path $env:ProgramFiles 'Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
$comlabCliConfig = @()
if (-not (Test-Path -LiteralPath $comlabCli)) {
    $comlabCli = Join-Path $comlabRoot 'server\.local\toolchain\arduino-cli.exe'
    $comlabCliConfig = @('--config-file', (Join-Path $comlabRoot 'server\.local\toolchain\arduino-cli.yaml'))
}
if (-not (Test-Path -LiteralPath $comlabCli)) { throw 'Arduino CLI was not found in Arduino IDE or server/.local/toolchain.' }
& node (Join-Path $PSScriptRoot 'check-node-binary.js')
if ($LASTEXITCODE -ne 0) { throw 'Node binary verification failed; nothing was uploaded.' }
if ($CheckOnly) { return }
if (-not $NodePort) { throw 'Specify -NodePort COMn for the workstation node, not the controller.' }
$comlabOutput = Join-Path $comlabRoot 'server\.local\node-firmware-build'
Write-Output "Uploading the prebuilt workstation node to $NodePort at 115200 baud. Close Serial Monitor first. Keep relay COM/NO disconnected from the PC."
& $comlabCli upload @comlabCliConfig --fqbn esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200 --port $NodePort --input-dir $comlabOutput --verify
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check the node port, Serial Monitor, cable and BOOT button.' }
Write-Output 'PASS: node uploaded, disarmed. Serial Monitor 115200, Newline. ARM then TEST for one pulse; OFF to disarm.'
