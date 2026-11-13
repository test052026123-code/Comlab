# PC-01 power feedback check — 2026-11-11

After restoring the original case PWR SW connection, the user confirmed the PC
starts normally and is physically running now. Read-only controller POWERSTATUS
still reports NODE-01 connected, power=off, executor=unavailable, with old command
52b4e728-b01e-4102-84ed-05768972fb4e in unknown state.

The source config enables COMLAB_NODE_POWER_SENSE=1. PowerSense uses GPIO27 with
INPUT_PULLUP: LOW means ON, HIGH means OFF. An unwired input therefore reads OFF.
The expected feedback circuit is an EL817/PC817 module sensing PC SATA +5V on
its isolated input, with its output collector to GPIO27 and emitter to ESP32 GND.

This establishes that reported power does not match the physical PC state.
Whether the module is missing, miswired, unpowered, or faulty is not yet known.
The user has been asked whether this optocoupler feedback circuit is connected.
No relay command or new reservation was issued during this readiness check.

Follow-up: the user confirmed sensor OUT is physically wired to GPIO33.
PowerSense was corrected from GPIO27 to GPIO33, with a new v2 startup banner
and pin-aware logs. Node binary preflight now rejects older sensing-enabled
binaries without that banner. The Arduino toolchain configuration was adjusted
to the current D:\ComLab path after the workspace moved from E:.

The corrected node build passed all three existing relay/executor/controller
host suites. Program size: 973,890 bytes (74%); globals: 49,940 bytes (15%).
Board identity was checked before upload: central controller on COM10 has MAC
d4:e9:f4:72:34:cc; NODE-01 on COM11 has MAC b0:cb:d8:e9:91:8c. Only COM11 is
being updated. The saved unknown-command journal is preserved by normal upload.

Upload to COM11 completed with flash hash verification. A controlled boot capture
confirmed 'Power sense input v2: GPIO33; LOW=ON, HIGH=OFF', Wi-Fi reconnection,
and authenticated controller heartbeats. The raw input was GPIO33 HIGH.

The user then confirmed the PC was running, followed by a normal OS shutdown
and confirmation that the PC was off. Throughout both states, the node kept
reporting OFF with no GPIO33 transition. This is not evidence for simply
inverting the sensor polarity: the signal has not changed at all. Sensor
module identity, input power/wiring, output wiring, and output ground need
physical inspection. A clear sensor-module/wiring photo is the next input.
No relay pulse was sent during upload or these power-feedback checks.
