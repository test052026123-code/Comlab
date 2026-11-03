#pragma once
#include <stddef.h>
#include <stdint.h>

namespace FakeBoard {
inline int64_t nowUs = 0, nextTick = 0, period = 0;
inline void (*callback)(void*) = nullptr;
inline bool failCreate = false, failStart = false;
inline int level = 0, risingEdges = 0, locks = 0;
inline const char* serialInput = "";
inline void setLevel(int value) { if (value && !level) ++risingEdges; level = value; }
inline void advance(int64_t delta) {
  const int64_t until = nowUs + delta;
  while (callback && period && nextTick <= until) {
    nowUs = nextTick; nextTick += period; callback(nullptr);
  }
  nowUs = until;
}
}

class String {
  char text[96] = {};
public:
  String(const char* value) { size_t i = 0; while (value[i] && i < sizeof(text)-1) { text[i] = value[i]; ++i; } }
  void trim() {
    size_t start = 0, end = 0;
    while (text[end]) ++end;
    while (start < end && text[start] == ' ') ++start;
    while (end > start && text[end-1] == ' ') --end;
    size_t i = 0; while (start < end) text[i++] = text[start++]; text[i] = 0;
  }
  void toUpperCase() { for (size_t i = 0; text[i]; ++i) if (text[i] >= 'a' && text[i] <= 'z') text[i] -= 32; }
  bool operator==(const char* other) const { size_t i = 0; while (text[i] && text[i] == other[i]) ++i; return text[i] == other[i]; }
};
struct FakeSerial {
  void println(const char*) {}
  void printf(const char*, ...) {}
  int available() { return *FakeBoard::serialInput != 0; }
  int read() { return *FakeBoard::serialInput ? *FakeBoard::serialInput++ : -1; }
};
inline FakeSerial Serial;
inline uint32_t millis() { return static_cast<uint32_t>(FakeBoard::nowUs / 1000); }
inline void digitalWrite(uint8_t, int value) { FakeBoard::setLevel(value); }
inline void pinMode(uint8_t, int) {}
#define LOW 0
#define OUTPUT 1
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(value) (++FakeBoard::locks)
#define portEXIT_CRITICAL(value) (--FakeBoard::locks)
