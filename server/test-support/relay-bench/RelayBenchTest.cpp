#include "RelayBench.h"

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
  return 0;
}
