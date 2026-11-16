#pragma once
#include <stdint.h>

namespace PowerPolicy {
enum State : uint8_t { Unknown = 0, Accepted = 1, ConfirmedOn = 2, Rejected = 3 };
static bool uuid(const char* value) {
  if (!value) return false;
  for (int i = 0; i < 36; ++i) {
    const char c = value[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return value[36] == 0;
}
static bool validTime(int64_t now, int64_t issued, int64_t expires) {
  return now >= 1700000000000LL && issued >= now - 30000 && issued <= now + 2000 &&
    expires > now && expires > issued && expires - issued <= 30000;
}
static bool canStart(bool enabled, bool stableOff, bool rawOff, bool busy, bool unresolved) {
  return enabled && stableOff && rawOff && !busy && !unresolved;
}
// Only independently observed ON after the timed release confirms startup.
static State completion(int relayStatus, bool observedOn, bool deadlinePassed) {
  if (relayStatus == 5) return Rejected;
  if (relayStatus == 4) return Unknown;
  if (relayStatus == 3 && observedOn) return ConfirmedOn;
  if (!deadlinePassed) return Accepted;
  // Pulse finished and the sensor still reads OFF: the PC failed to start.
  // That is a known outcome (the Pi raises a report), so do not lock the node.
  return relayStatus == 3 ? Rejected : Unknown;
}
}
