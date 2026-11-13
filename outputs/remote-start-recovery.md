# NODE-01 startup recovery ? 2026-11-11

Installed the node firmware with local recovery support on COM11, MAC b0:cb:d8:e9:91:8c. Upload verified flash hashes. Central controller on COM10 was not reflashed.

Recovered only the unresolved power journal entry 52b4e728-b01e-4102-84ed-05768972fb4e after the operator confirmed PC-01 OFF and COM/NO connected to PWR SW. Recovery retained the UUID and issuedAtMs 1794365130258, marked the old attempt rejected, and sent no relay pulse. NVS was not erased.

The central controller subsequently reported NODE-01 connected=yes, executor=ready, power=off, command=none. Authenticated cloud HTTPS sync was acknowledged. Relay GPIO23 remained LOW/disarmed.

Validation: actual relay, remote power executor and controller bridge host suites passed. Recovery tests cover wrong identity, ON feedback, active/armed relay, failed persistence, command deduplication across reboot and a newer authenticated command producing one pulse.

The operator clarified that the earlier PC turns on answer described the desired flow, not an actual completed startup test. Follow-up node and central status show no new command. Next physical test: with PC-01 OFF, scan fingerprint, select PC-01, then Confirm selection once. Remote-start completion remains unverified until that test is performed. Do not send a power pulse while the PC is running.

Known remaining hardware issue: GPIO33 reads OFF with the PC physically ON or OFF. This recovery does not repair power feedback. A normal delivered pulse without ON feedback becomes unknown after 20 seconds and locks further pulses again. Do not present pulse delivery as confirmed PC power or bypass the lock with automatic retries.
