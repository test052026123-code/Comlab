#pragma once
#include "Arduino.h"
struct FakeTimer {};
inline FakeTimer fakeTimer;
typedef FakeTimer* esp_timer_handle_t;
struct esp_timer_create_args_t { void (*callback)(void*); int dispatch_method; const char* name; };
#define ESP_TIMER_TASK 0
#define ESP_OK 0
inline int64_t esp_timer_get_time() { return FakeBoard::nowUs; }
inline int esp_timer_create(const esp_timer_create_args_t* args, esp_timer_handle_t* handle) {
  if (FakeBoard::failCreate) return -1;
  FakeBoard::callback = args->callback; *handle = &fakeTimer; return 0;
}
inline int esp_timer_start_periodic(esp_timer_handle_t, int64_t period) {
  if (FakeBoard::failStart) return -1;
  FakeBoard::period = period; FakeBoard::nextTick = FakeBoard::nowUs + period; return 0;
}
