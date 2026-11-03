$ErrorActionPreference = 'Stop'
$comlabRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$comlabLlvm = 'C:\Android\ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin'
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
