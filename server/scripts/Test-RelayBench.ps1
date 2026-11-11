$ErrorActionPreference = 'Stop'
$comlabRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$comlabLlvm = 'C:\Android\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin'
if (-not (Test-Path -LiteralPath $comlabLlvm)) {
    $comlabLlvm = 'C:\Android\Sdk\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin'
}
$comlabClang = Join-Path $comlabLlvm 'clang++.exe'
$comlabLld = Join-Path $comlabLlvm 'ld.lld.exe'
if (-not (Test-Path -LiteralPath $comlabClang)) { throw 'Installed Android NDK clang is required for these Windows host tests.' }
$comlabTests = Join-Path $comlabRoot 'server\test-support\relay-bench'
$comlabSketch = Join-Path $comlabRoot 'firmware\comlab_node'
$comlabOutput = Join-Path $comlabRoot 'server\.local\relay-bench-tests'
New-Item -ItemType Directory -Path $comlabOutput -Force | Out-Null
$comlabObject = Join-Path $comlabOutput 'RelayBenchTest.obj'
$comlabDll = Join-Path $comlabOutput 'RelayBenchTest.dll'
& $comlabClang --target=x86_64-pc-windows-msvc -std=c++17 -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-stack-protector -c (Join-Path $comlabTests 'RelayBenchTest.cpp') -I $comlabTests -I $comlabSketch -o $comlabObject
if ($LASTEXITCODE -ne 0) { throw 'Relay host test compilation failed.' }
& $comlabLld -flavor link /DLL /NOENTRY /NODEFAULTLIB "/OUT:$comlabDll" $comlabObject
if ($LASTEXITCODE -ne 0) { throw 'Relay host test linking failed.' }
& python (Join-Path $comlabTests 'run.py') $comlabDll
if ($LASTEXITCODE -ne 0) { throw 'Relay bench tests failed.' }
$comlabPowerTests = Join-Path $comlabRoot 'server\test-support\remote-power'
$comlabPowerObject = Join-Path $comlabOutput 'RemotePowerTest.obj'
$comlabPowerDll = Join-Path $comlabOutput 'RemotePowerTest.dll'
$comlabBridgeTests = Join-Path $comlabRoot 'server\test-support\controller-power'
$comlabController = Join-Path $comlabRoot 'firmware\comlab_cloud'
& $comlabClang --target=x86_64-pc-windows-msvc -std=c++17 -O1 -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-stack-protector -c (Join-Path $comlabPowerTests 'RemotePowerTest.cpp') -I $comlabPowerTests -I $comlabTests -I $comlabSketch -I $comlabBridgeTests -I $comlabController -o $comlabPowerObject
if ($LASTEXITCODE -ne 0) { throw 'Remote power host test compilation failed.' }
& $comlabLld -flavor link /DLL /NOENTRY /NODEFAULTLIB "/OUT:$comlabPowerDll" $comlabPowerObject
if ($LASTEXITCODE -ne 0) { throw 'Remote power host test linking failed.' }
& python (Join-Path $comlabTests 'run.py') $comlabPowerDll runRemotePowerTests
if ($LASTEXITCODE -ne 0) { throw 'Remote power tests failed.' }
$comlabBridgeTests = Join-Path $comlabRoot 'server\test-support\controller-power'
$comlabController = Join-Path $comlabRoot 'firmware\comlab_cloud'
$comlabBridgeObject = Join-Path $comlabOutput 'PowerBridgeTest.obj'
$comlabBridgeDll = Join-Path $comlabOutput 'PowerBridgeTest.dll'
& $comlabClang --target=x86_64-pc-windows-msvc -std=c++17 -O1 -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-stack-protector -c (Join-Path $comlabBridgeTests 'PowerBridgeTest.cpp') -I $comlabBridgeTests -I $comlabController -o $comlabBridgeObject
if ($LASTEXITCODE -ne 0) { throw 'Controller power bridge host test compilation failed.' }
& $comlabLld -flavor link /DLL /NOENTRY /NODEFAULTLIB "/OUT:$comlabBridgeDll" $comlabBridgeObject
if ($LASTEXITCODE -ne 0) { throw 'Controller power bridge host test linking failed.' }
& python (Join-Path $comlabTests 'run.py') $comlabBridgeDll runPowerBridgeTests
if ($LASTEXITCODE -ne 0) { throw 'Controller power bridge tests failed.' }

$comlabFingerprintTests = Join-Path $comlabRoot 'server\test-support\fingerprint'
$comlabFingerprintObject = Join-Path $comlabOutput 'FingerprintTest.obj'
$comlabFingerprintDll = Join-Path $comlabOutput 'FingerprintTest.dll'
& $comlabClang --target=x86_64-pc-windows-msvc -std=c++17 -ffreestanding -fno-exceptions -fno-rtti -fno-threadsafe-statics -fno-stack-protector -c (Join-Path $comlabFingerprintTests 'FingerprintTest.cpp') -I $comlabFingerprintTests -I $comlabTests -I $comlabController -o $comlabFingerprintObject
if ($LASTEXITCODE -ne 0) { throw 'Fingerprint capture host test compilation failed.' }
& $comlabLld -flavor link /DLL /NOENTRY /NODEFAULTLIB "/OUT:$comlabFingerprintDll" $comlabFingerprintObject
if ($LASTEXITCODE -ne 0) { throw 'Fingerprint capture host test linking failed.' }
& python (Join-Path $comlabTests 'run.py') $comlabFingerprintDll runFingerprintTests
if ($LASTEXITCODE -ne 0) { throw 'Fingerprint capture tests failed.' }
