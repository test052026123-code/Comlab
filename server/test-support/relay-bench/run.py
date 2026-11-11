import ctypes
import sys

entry = sys.argv[2] if len(sys.argv) > 2 else "runRelayBenchTests"
result = getattr(ctypes.WinDLL(sys.argv[1]), entry)()
if result == 0:
    print(f"PASS: {entry} (simulated GPIO/timers/storage).")
else:
    print(f"FAIL: {entry} line {result}")
sys.exit(0 if result == 0 else 1)
