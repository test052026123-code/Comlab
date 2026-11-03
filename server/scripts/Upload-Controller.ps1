param(
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$ControllerPort,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$comlabRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$comlabCli = Join-Path $env:ProgramFiles 'Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe'
if (-not (Test-Path -LiteralPath $comlabCli)) { throw 'Arduino CLI was not found in the installed Arduino IDE folder.' }
& node (Join-Path $PSScriptRoot 'check-controller-binary.js')
if ($LASTEXITCODE -ne 0) { throw 'Controller firmware verification failed; nothing was uploaded.' }
if ($CheckOnly) { return }
if (-not $ControllerPort) { throw 'Specify -ControllerPort COMn for the controller board, not the workstation node.' }
$comlabOutput = Join-Path $comlabRoot 'server\.local\cloud-firmware-build'
Write-Output "Uploading the prebuilt controller to $ControllerPort at 115200 baud. No compilation is needed. Close Serial Monitor first."
& $comlabCli upload --fqbn esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200 --port $ControllerPort --input-dir $comlabOutput --verify
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check the controller port, cable, Serial Monitor and BOOT button.' }
Write-Output 'PASS: controller uploaded. Open Serial Monitor at 115200 baud and confirm the node receiver starts.'
