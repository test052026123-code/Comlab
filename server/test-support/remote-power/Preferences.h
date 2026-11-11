#pragma once
#include <stddef.h>
namespace FakeStorage {
inline unsigned char bytes[128] = {};
inline size_t length = 0;
inline bool failWrite = false, failOpen = false;
inline int writes = 0;
}
class Preferences {
public:
  bool begin(const char*, bool) { return !FakeStorage::failOpen; }
  bool isKey(const char*) { return FakeStorage::length != 0; }
  size_t getBytesLength(const char*) { return FakeStorage::length; }
  size_t getBytes(const char*, void* output, size_t count) {
    if (count != FakeStorage::length) return 0;
    for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = FakeStorage::bytes[i];
    return count;
  }
  size_t putBytes(const char*, const void* input, size_t count) {
    ++FakeStorage::writes;
    if (FakeStorage::failWrite || count > sizeof(FakeStorage::bytes)) return 0;
    for (size_t i = 0; i < count; ++i) FakeStorage::bytes[i] = static_cast<const unsigned char*>(input)[i];
    FakeStorage::length = count; return count;
  }
};
