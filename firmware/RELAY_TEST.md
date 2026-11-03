# PC-01 node relay bench test

Implemented in `comlab_node/RelayBench.h`, included by `comlab_node.ino`.
The user confirmed a 5V relay module with GPIO23 driving IN1 through a 2N2222A.
This test is controlled only from USB Serial Monitor; no HTTP, UDP, cloud or app
message can actuate the relay. Keep COM/NO disconnected from the motherboard and
any other load while testing. The relay contacts are only checked using a meter.

## Confirmed interface

| Connection | Destination |
|---|---|
| GPIO23 | 1 kilohm resistor to transistor B |
| Transistor B | 10 kilohm resistor to E, to hold the transistor off during reset |
| Transistor E | Common ESP32/module/supply GND |
| Transistor C | Module IN1 |
| Module VCC/JD-VCC | Regulated 5V with the JD-VCC/VCC jumper installed |
| Module GND | Supply negative / common GND |
| Unused IN2 | 10 kilohm pull-up to module VCC for the active-LOW second channel |
| COM/NO/NC | No connection to the PC during this bench test |

Use the transistor's verified B/C/E assignments, not an assumed package pin
order. Supply the module's coil current from a suitable 5V source; GPIO23 only
drives the transistor base. A diode/coil driver is already on this relay module;
the external transistor switches the module input rather than its coil.
Do not connect the 5V module input directly to the ESP32 for this firmware.

GPIO23 LOW releases the transistor and relay; HIGH activates it. The code
preloads LOW before setting output mode. The external pull-down is still needed
while the ESP32 is resetting or being flashed.

## Upload and run

Use the existing configured node folder for PC-01 / NODE-01. It retains Wi-Fi
and authenticated heartbeats. No controller, Render or APK update is required.
Board: DOIT ESP32 DEVKIT V1, ESP32 core 3.3.7, ArduinoJson 7.

From the ComLab project root, compile with one job if needed:

```powershell
.\server\scripts\Build-Firmware.ps1 -Target node
.\server\scripts\Upload-Node.ps1 -CheckOnly
.\server\scripts\Upload-Node.ps1 -NodePort COM6
```

Replace COM6 with the node's actual port. Close Serial Monitor before uploading.
The upload helper uses the already compiled binary and does not recompile.
It checks the bench-test banner and local pairing configuration first.

Open Serial Monitor at **115200 baud**, choose **Newline** or **Both NL & CR**,
then send these commands one at a time:

```text
STATUS
ARM
TEST
OFF
```

ARM opens a 60-second test window without actuating the relay. TEST queues one
approximately 300ms pulse. Expect a click, channel-1 indicator change and then a
release click. At rest, COM/NO should be open; during the pulse, COM/NO should
have continuity. A click/indicator change alone does not prove contact continuity.
Wait at least three seconds before another TEST. OFF cancels a queued test,
releases an active pulse and disarms. HELP lists commands.

An independent ESP timer task starts and releases pulses and expires the arm
window. A blocked Wi-Fi/mDNS loop cannot indefinitely extend the pulse. Timer
startup failure prevents arming. Timing is software scheduled; it is not a
hardware timing guarantee. There is no latched ON command and no automatic
startup pulse. The serial test works while Wi-Fi is disconnected, including
when node credentials are not configured.

PC telemetry deliberately remains power/reachability/input unknown and power
commands from the cloud remain unsupported. A relay pulse never fabricates ON
feedback or makes the workstation eligible for check-in.

## Verification

`server/scripts/Test-RelayBench.ps1` compiles the actual `RelayBench.h` into a
Windows host test DLL using the installed Android NDK clang. GPIO, serial and
ESP timers are simulated. Tests check boot OFF, no pulse before ARM, no pulse
on ARM alone, 300ms timer release without main-loop polling, cooldown,
OFF/cancellation, arm expiry, timer create/start failures, CRLF commands and
oversized-command rejection. This validates software policy, not the physical
module, transistor pinout, power supply, timer scheduling on hardware, or contacts.
