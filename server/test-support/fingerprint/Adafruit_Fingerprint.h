#pragma once
#include <Arduino.h>
#define SERIAL_8N1 0
enum { FINGERPRINT_OK = 0, FINGERPRINT_NOFINGER = 2, FINGERPRINT_NOTFOUND = 9 };
struct HardwareSerial {
  HardwareSerial(int) {}
  void begin(int, int, int, int) {}
};
namespace FakeFinger {
inline int image = FINGERPRINT_OK, search = FINGERPRINT_OK, model = FINGERPRINT_OK;
inline int imageCalls = 0, conversions = 0, stores = 0;
inline int storedSlot = -1;
}
struct Adafruit_Fingerprint {
  unsigned capacity = 127;
  unsigned fingerID = 3;
  Adafruit_Fingerprint(HardwareSerial*) {}
  void begin(int) {}
  bool verifyPassword() { return true; }
  int getParameters() { return FINGERPRINT_OK; }
  int getImage() { ++FakeFinger::imageCalls; return FakeFinger::image; }
  int image2Tz(int = 1) { ++FakeFinger::conversions; return FINGERPRINT_OK; }
  int fingerSearch(int = 1) { return FakeFinger::search; }
  int createModel() { return FakeFinger::model; }
  int storeModel(int slot) { ++FakeFinger::stores; FakeFinger::storedSlot = slot; return FINGERPRINT_OK; }
};
