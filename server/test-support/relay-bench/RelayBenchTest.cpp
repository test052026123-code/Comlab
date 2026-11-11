#include "RelayBench.h"
#include "BenchPolicy.h"
#include "PowerPolicy.h"

// Freestanding host DLL: no runtime or hardware dependencies.
extern "C" void* memset(void* destination, int value, size_t length) {
  auto* bytes = static_cast<unsigned char*>(destination);
  for (size_t i = 0; i < length; ++i) bytes[i] = static_cast<unsigned char>(value);
  return destination;
}
extern "C" void* memcpy(void* destination, const void* source, size_t length) {
  auto* target = static_cast<unsigned char*>(destination);
  const auto* input = static_cast<const unsigned char*>(source);
  for (size_t i = 0; i < length; ++i) target[i] = input[i];
  return destination;
}

static void reset() {
  FakeBoard::nowUs = FakeBoard::nextTick = FakeBoard::period = 0;
  FakeBoard::callback = nullptr; FakeBoard::failCreate = FakeBoard::failStart = false;
  FakeBoard::level = FakeBoard::risingEdges = FakeBoard::locks = 0;
  FakeBoard::serialInput = "";
  RelayBench::timer = nullptr;
  RelayBench::active = RelayBench::ended = RelayBench::armed = RelayBench::expired = false;
  RelayBench::pending = RelayBench::ready = RelayBench::tested = RelayBench::inputOverflow = false;
  RelayBench::pulseDeadlineUs = RelayBench::armDeadlineUs = 0;
  RelayBench::lastTestAt = 0; RelayBench::inputLength = 0;
  RelayBench::remoteProgress = 0;
  RelayBench::pulseGuard = nullptr; RelayBench::benchAllowed = nullptr;
  RelayBench::guardedPulse = false;
}
#define CHECK(condition) if (!(condition)) return __LINE__
extern "C" __declspec(dllexport) int runRelayBenchTests() {
  reset(); RelayBench::begin();
  CHECK(FakeBoard::level == 0 && !RelayBench::armed);
  RelayBench::command(String("TEST")); FakeBoard::advance(1000000);
  CHECK(FakeBoard::risingEdges == 0);
  RelayBench::command(String("ARM"));
  CHECK(FakeBoard::level == 0); // Arming alone never pulses.
  RelayBench::command(String("TEST")); FakeBoard::advance(5000);
  CHECK(FakeBoard::level == 1 && FakeBoard::risingEdges == 1);
  FakeBoard::advance(299000); CHECK(FakeBoard::level == 1);
  FakeBoard::advance(1000); CHECK(FakeBoard::level == 0);
  // No loop/poll call during the pulse: timer still releases the output.
  RelayBench::command(String("TEST")); FakeBoard::advance(10000);
  CHECK(FakeBoard::risingEdges == 1);
  FakeBoard::advance(3000000);
  RelayBench::command(String("TEST")); FakeBoard::advance(5000);
  CHECK(FakeBoard::risingEdges == 2 && FakeBoard::level == 1);
  RelayBench::command(String("OFF")); CHECK(FakeBoard::level == 0 && !RelayBench::armed);
  FakeBoard::advance(1000000); CHECK(FakeBoard::risingEdges == 2);

  reset(); RelayBench::begin(); RelayBench::command(String("ARM"));
  RelayBench::command(String("TEST")); RelayBench::command(String("OFF"));
  FakeBoard::advance(1000000); CHECK(FakeBoard::risingEdges == 0);

  reset(); RelayBench::begin(); RelayBench::command(String("ARM"));
  FakeBoard::advance(60000000);
  CHECK(!RelayBench::armed && FakeBoard::level == 0);
  RelayBench::command(String("TEST")); FakeBoard::advance(1000000);
  CHECK(FakeBoard::risingEdges == 0);

  for (int mode = 0; mode < 2; ++mode) {
    reset(); FakeBoard::failCreate = mode == 0; FakeBoard::failStart = mode == 1;
    RelayBench::begin(); RelayBench::command(String("ARM")); RelayBench::command(String("TEST"));
    FakeBoard::advance(1000000); CHECK(FakeBoard::risingEdges == 0);
  }

  reset(); RelayBench::begin();
  FakeBoard::serialInput = " arm \r\n test \r\n"; RelayBench::poll();
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 1);
  FakeBoard::advance(300000); CHECK(FakeBoard::level == 0);
  CHECK(FakeBoard::locks == 0);
  reset(); RelayBench::begin();
  FakeBoard::serialInput = "1234567890123456789012345678901234567890ARM\nTEST\n";
  RelayBench::poll(); FakeBoard::advance(1000000);
  CHECK(FakeBoard::risingEdges == 0 && !RelayBench::armed);

  // Remote bench commands need no USB ARM, but retain the independent 300ms release.
  reset(); RelayBench::begin();
  CHECK(RelayBench::remotePulse());
  CHECK(RelayBench::remoteStatus() == 1);
  CHECK(!RelayBench::remotePulse());
  FakeBoard::advance(5000);
  CHECK(FakeBoard::risingEdges == 1 && RelayBench::remoteStatus() == 2);
  FakeBoard::advance(300000);
  CHECK(FakeBoard::level == 0 && RelayBench::remoteStatus() == 3);
  CHECK(!RelayBench::remotePulse());
  FakeBoard::advance(3000000); CHECK(RelayBench::remotePulse());
  RelayBench::off(); FakeBoard::advance(1000000);
  CHECK(FakeBoard::risingEdges == 1 && RelayBench::remoteStatus() == 4);
  reset(); FakeBoard::failCreate = true; RelayBench::begin();
  CHECK(!RelayBench::remotePulse());
  const int64_t now = 1800000000000LL;
  CHECK(benchTimeValid(now, now, now + 30000));
  CHECK(!benchTimeValid(now, now + 2001, now + 30000));
  CHECK(!benchTimeValid(now, now - 31000, now - 1000));
  CHECK(!benchTimeValid(now, now, now + 60000));
  CHECK(!benchTimeValid(0, 0, 30000));
  CHECK(!benchNewer(now, now));
  CHECK(!benchNewer(now - 1, now));
  CHECK(benchNewer(now + 1, now));

  // A production pulse must pass its final guard at the actual HIGH transition.
  reset(); RelayBench::begin();
  RelayBench::pulseGuard = []() { return false; };
  CHECK(RelayBench::remotePulse(true));
  FakeBoard::advance(5000);
  CHECK(FakeBoard::risingEdges == 0 && RelayBench::remoteStatus() == 5);
  reset(); RelayBench::begin();
  RelayBench::pulseGuard = []() { return true; };
  CHECK(RelayBench::remotePulse(true));
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 1);
  FakeBoard::advance(300000); CHECK(FakeBoard::level == 0);
  // A failed sensor recheck cannot affect subsequent explicitly armed USB tests.
  FakeBoard::advance(3000000);
  RelayBench::pulseGuard = []() { return false; };
  RelayBench::command(String("ARM"));
  RelayBench::command(String("TEST")); FakeBoard::advance(5000);
  CHECK(FakeBoard::risingEdges == 2);
  RelayBench::off();
  RelayBench::benchAllowed = []() { return false; };
  FakeBoard::advance(3000000);
  CHECK(!RelayBench::remotePulse());
  RelayBench::command(String("ARM")); CHECK(!RelayBench::armed);
  CHECK(RelayBench::remotePulse(true)); // Production can use the shared executor.
  RelayBench::command(String("OFF")); CHECK(RelayBench::remoteStatus() == 4);

  CHECK(PowerPolicy::uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  CHECK(!PowerPolicy::uuid("short"));
  CHECK(!PowerPolicy::uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaz"));
  CHECK(PowerPolicy::validTime(now, now, now + 30000));
  CHECK(!PowerPolicy::validTime(now, now, now));
  CHECK(!PowerPolicy::validTime(now, now + 2001, now + 30000));
  CHECK(!PowerPolicy::validTime(now, now - 31000, now + 1));
  CHECK(!PowerPolicy::validTime(now, now, now + 30001));
  CHECK(!PowerPolicy::validTime(0, 0, 30000));
  CHECK(PowerPolicy::canStart(true, true, true, false, false));
  CHECK(!PowerPolicy::canStart(false, true, true, false, false));
  CHECK(!PowerPolicy::canStart(true, false, true, false, false));
  CHECK(!PowerPolicy::canStart(true, true, false, false, false));
  CHECK(!PowerPolicy::canStart(true, true, true, true, false));
  CHECK(!PowerPolicy::canStart(true, true, true, false, true));
  CHECK(PowerPolicy::completion(2, true, false) == PowerPolicy::Accepted);
  CHECK(PowerPolicy::completion(3, false, false) == PowerPolicy::Accepted);
  CHECK(PowerPolicy::completion(3, true, false) == PowerPolicy::ConfirmedOn);
  CHECK(PowerPolicy::completion(3, false, true) == PowerPolicy::Unknown);
  CHECK(PowerPolicy::completion(4, true, false) == PowerPolicy::Unknown);
  CHECK(PowerPolicy::completion(5, true, false) == PowerPolicy::Rejected);
  return 0;
}
