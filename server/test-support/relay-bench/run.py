import ctypes
import sys

result = ctypes.WinDLL(sys.argv[1]).runRelayBenchTests()
if result == 0:
    print("PASS: relay bench state/timer tests (simulated GPIO/timers).")
else:
    print(f"FAIL: relay bench test line {result}")
sys.exit(0 if result == 0 else 1)
