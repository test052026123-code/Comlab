# ESP32 Wi-Fi update ? 2026-11-11

Both ignored local secrets.h files now configure SSID Redmi with the operator-provided password. No Firebase project, device signing key, scanner template or node journal was intentionally changed.

Central controller COM10, MAC d4:e9:f4:72:34:cc: backed up all 4 MiB flash locally before updating. The installed firmware is comlab-cloud-enroll-9, newer than the checked-out power-7 source. To avoid downgrading scanner behavior, patched only the existing image's Wi-Fi string storage, image checksum and appended SHA256. Independently verified original/new image checksums and digests, exact changed-byte ranges, segment lengths and addresses. Wrote only the app at 0x10000; esptool verified flash hash. The original firmware and complete flash backup are in ignored server/.local. These binaries contain device credentials: do not publish them. Future builds of the older controller source are not an equivalent replacement for this installed enroll-9 image.

NODE-01 COM11, MAC b0:cb:d8:e9:91:8c: rebuilt current node source with Redmi configuration, passed binary identity/configuration checks, uploaded and verified flash hash. Existing NVS preserved, including command identity/watermark and the prior explicit operator recovery. No relay pulse requested.

Live checks: node received authenticated central heartbeat acknowledgements; central reported NODE-01 connected=yes, executor=ready. Relay GPIO23 LOW, disarmed. Central authenticated cloud HTTPS sync succeeded after its Wi-Fi change; intermittent HTTP 0/-1 transport failures were also observed, as before. Wi-Fi migration does not by itself establish successful fingerprint check-in or fix GPIO33 power feedback.

The tablet was left on its working PLDTHOMEFIBReV4Y7 connection when swapped out for the node USB update. The kiosk uses cloud API access; the ESP32 central/node pair must share Redmi with hotspot enabled. Keep both boards powered.

Subsequent scan-timeout repair: controller upgraded from enroll-9 to reproducible source build comlab-cloud-scan-10 with Redmi retained. See fingerprint-held-scan-fix.md. The older-source warning above describes the Wi-Fi-only migration at that time.
