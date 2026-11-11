param(
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$ControllerPort,
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
& node (Join-Path $PSScriptRoot 'check-controller-binary.js')
if ($LASTEXITCODE -ne 0) { throw 'Controller firmware verification failed; nothing was uploaded.' }
if ($CheckOnly) { return }
if (-not $ControllerPort) { throw 'Specify -ControllerPort COMn for the controller board, not the workstation node.' }
$comlabOutput = Join-Path $comlabRoot 'server\.local\cloud-firmware-build'
Write-Output "Uploading the prebuilt controller to $ControllerPort at 115200 baud. No compilation is needed. Close Serial Monitor first."
& $comlabCli upload @comlabCliConfig --fqbn esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200 --port $ControllerPort --input-dir $comlabOutput --verify
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check the controller port, cable, Serial Monitor and BOOT button.' }
Write-Output 'PASS: controller uploaded. Open Serial Monitor at 115200 baud and confirm the node receiver starts.'
