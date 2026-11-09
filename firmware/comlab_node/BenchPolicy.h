#pragma once
#include <stdint.h>
static bool benchTimeValid(int64_t now, int64_t issued, int64_t expires) {
  return now >= 1700000000000LL && issued >= now - 30000 && issued <= now + 2000 &&
    expires > now && expires > issued && expires - issued <= 30000;
}
static bool benchNewer(int64_t incoming, int64_t previous) { return incoming > previous; }
