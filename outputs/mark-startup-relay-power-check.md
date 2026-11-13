# Mark Brian startup ? relay power check

User confirmed selecting PC-01. Live API inspection found session 481c046f-e065-46d5-bb75-2efc5316ee88 for Mark Brian Quimpan STU-20269694, status active, assignment reserved. A matching power_on command was committed and delivered to controller boot 12743a00-c8cf-4ca4-8657-f8b551f5e96c. PC-01 is consequently ineligible for another selection; this is a successful reservation, not a new availability-record failure.

Central subsequently reported the exact command as unknown, executor unavailable, fresh NODE-01 connected/OFF telemetry. No new pulse or replay was requested by the agent. Operator reported no relay click, PC physically OFF, and relay power LED OFF. Operator said relay VCC is connected to ESP32 5V/VIN.

Tablet currently detected by ADB, while NODE-01 is externally powered (not a host serial port). Used Recover pending operation, which only reconciles the saved operation and never sends a relay pulse. Live tablet screenshot showed PC-01 reserved in Firebase and startup status unknown. The session remains reserved intentionally until the uncertain power attempt is resolved.

Physical next step: with node USB disconnected, check VIN/5V to relay VCC and ESP32 GND to relay GND; keep the documented VCC/JD-VCC jumper installed if present. Power NODE-01 again. Confirm power LED/measure roughly 5V across relay VCC and GND before any new startup attempt. A dark LED alone is not a voltage measurement. Do not bridge motherboard pins to the relay supply.

If power is restored, independently reconfirm PC OFF before recovering the exact node journal ID through local USB POWER-RECOVER-OFF. Do not erase NVS. Reconcile the old result and close the failed reserved session through the authenticated staff endpoint with intact linked assignments before a new fingerprint check-in. Do not use a second UUID as a way around the old unknown lock or mark the PC ON without sensing.

Completed direct-node test: operator measured 4.99V between relay VCC/GND, confirming correct supply voltage despite the dark indicator. Operator connected NODE-01 to COM11 and explicitly confirmed PC OFF and COM/NO connected to motherboard PWR SW. Read node journal: exact current command 481c046f-e065-46d5-bb75-2efc5316ee88 unknown. Issued local POWER-RECOVER-OFF for that exact ID; node confirmed resolution with retained identity/watermark and no pulse. Sent ARM, verified its acknowledgement, then TEST exactly once. Node logged timed pulse completion; sent OFF and verified GPIO23 LOW/disarmed.

Operator requested retry. Independently reconfirmed PC physically OFF before sending one additional ARM/TEST pulse and OFF. Operator reported Relay clicked and PC started. This confirms the relay/control/contact path can turn PC-01 on from NODE-01. No further pulses sent.

Read-only status after successful physical startup still reports sensor=off on GPIO33, with last power command state=Rejected and inFlight=no. Therefore power feedback remains incorrect; do not fabricate ON telemetry or call the earlier cloud command confirmed_on. Keep the current reservation, since the PC is now running. Do not close/release it or issue another power pulse merely to reconcile software state. The next outstanding normal-workflow issue is actual isolated power-sense wiring on GPIO33.
