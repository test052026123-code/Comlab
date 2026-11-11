#include <Arduino.h>
extern "C" void* memcpy(void* output, const void* input, size_t count) {
  for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = static_cast<const unsigned char*>(input)[i];
  return output;
}
using time_t = long long;
static time_t time(void*) { return 1800000000LL + millis() / 1000; }
#include "FingerprintCapture.h"

static void reset() {
  FakeBoard::nowUs = 0;
  fingerprintSensor.fingerID = 3; fingerprintSensor.capacity = 127;
  FakeFinger::image = FakeFinger::search = FakeFinger::model = FINGERPRINT_OK;
  FakeFinger::imageCalls = FakeFinger::conversions = FakeFinger::stores = 0;
  FakeFinger::storedSlot = -1;
  fingerprintReady = true;
  fingerprintRequestId.clear(); fingerprintResultId.clear(); fingerprintState.clear();
  fingerprintSyncNow = false; nextFingerprintMs = 0; fingerprintSlot = -1;
}
static void tick() { FakeBoard::nowUs += 100000; pollFingerprintReader(); }
static void request(bool enroll = false) {
  startFingerprintCapture(String("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), time(nullptr) + 60, enroll, 3);
}
#define CHECK(condition) if (!(condition)) return __LINE__
extern "C" __declspec(dllexport) int runFingerprintTests() {
  // The finger was placed before the delayed cloud request arrived. Capture a
  // new sensor image now, without requiring a lift that the kiosk never asked for.
  reset(); request(); tick();
  CHECK(FakeFinger::imageCalls == 1 && FakeFinger::conversions == 1);
  CHECK(fingerprintState == "matched" && fingerprintSlot == 3 && fingerprintSyncNow);
  tick(); CHECK(FakeFinger::imageCalls == 1); // Finished requests never recapture.

  reset(); FakeFinger::image = FINGERPRINT_NOFINGER; request(); tick();
  CHECK(!fingerprintRequestId.isEmpty() && fingerprintResultId.isEmpty());
  FakeFinger::image = FINGERPRINT_OK; tick(); CHECK(fingerprintState == "matched");

  reset(); FakeFinger::search = FINGERPRINT_NOTFOUND; request(); tick();
  CHECK(fingerprintState == "no_match" && fingerprintSlot == -1);
  reset(); request(); fingerprintDeadline = time(nullptr); tick();
  CHECK(FakeFinger::imageCalls == 0 && fingerprintRequestId.isEmpty());

  // Enrollment cannot reuse a held image for its second pass. It must observe
  // NOFINGER between two conversions, even though first capture accepts a held finger.
  reset(); request(true); tick();
  CHECK(fingerprintStep == 1 && FakeFinger::conversions == 1);
  tick(); tick(); CHECK(fingerprintStep == 1 && FakeFinger::conversions == 1 && FakeFinger::stores == 0);
  FakeFinger::image = FINGERPRINT_NOFINGER; tick(); CHECK(fingerprintStep == 2);
  FakeFinger::image = FINGERPRINT_OK; tick();
  CHECK(fingerprintState == "enrolled" && FakeFinger::conversions == 2);
  CHECK(FakeFinger::stores == 1 && FakeFinger::storedSlot == 3);

  reset(); request(true); tick(); FakeFinger::image = FINGERPRINT_NOFINGER; tick();
  FakeFinger::image = FINGERPRINT_OK; FakeFinger::model = 10; tick();
  CHECK(fingerprintState == "mismatch" && FakeFinger::stores == 0);
  reset(); fingerprintSensor.fingerID = 2; request(true); tick();
  CHECK(fingerprintState == "duplicate" && FakeFinger::stores == 0);
  return 0;
}
