#pragma once
struct timeval { int64_t tv_sec, tv_usec; };
static int gettimeofday(timeval* result, void*) {
  const int64_t now = FakePower::epoch + FakeBoard::nowUs / 1000;
  result->tv_sec = now / 1000; result->tv_usec = (now % 1000) * 1000;
  return 0;
}
