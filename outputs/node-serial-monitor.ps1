$Host.UI.RawUI.WindowTitle = 'ComLab NODE-01 - COM10 - 115200 baud'
$nodeSerial = [System.IO.Ports.SerialPort]::new('COM10', 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$nodeSerial.DtrEnable = $false
$nodeSerial.RtsEnable = $false
$nodeSerial.NewLine = "`n"
$typedCommand = ''
try {
    $nodeSerial.Open()
    Write-Host 'Connected to COM10 at 115200 baud.' -ForegroundColor Green
    Write-Host 'Type STATUS or HELP and press Enter. Esc closes the monitor.'
    Write-Host 'ARM and TEST can actuate the relay. Disconnect motherboard contacts for bench testing.' -ForegroundColor Yellow
    while ($true) {
        $receivedText = $nodeSerial.ReadExisting()
        if ($receivedText) { [Console]::Write($receivedText) }
        if ([Console]::KeyAvailable) {
            $pressedKey = [Console]::ReadKey($true)
            if ($pressedKey.Key -eq [ConsoleKey]::Escape) { break }
            if ($pressedKey.Key -eq [ConsoleKey]::Enter) {
                [Console]::WriteLine()
                $nodeSerial.WriteLine($typedCommand)
                $typedCommand = ''
            } elseif ($pressedKey.Key -eq [ConsoleKey]::Backspace) {
                if ($typedCommand.Length -gt 0) {
                    $typedCommand = $typedCommand.Substring(0, $typedCommand.Length - 1)
                    [Console]::Write("`b `b")
                }
            } elseif (-not [char]::IsControl($pressedKey.KeyChar)) {
                $typedCommand += $pressedKey.KeyChar
                [Console]::Write($pressedKey.KeyChar)
            }
        }
        Start-Sleep -Milliseconds 40
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    if ($nodeSerial.IsOpen) { $nodeSerial.Close() }
    $nodeSerial.Dispose()
}
