#include "PowerBridge.h"
extern "C" void* memset(void* output, int value, size_t count) {
  for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = value;
  return output;
}
extern "C" void* memcpy(void* output, const void* input, size_t count) {
  for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = static_cast<const unsigned char*>(input)[i];
  return output;
}
extern "C" size_t strlen(const char* text) { size_t size = 0; while (text[size]) ++size; return size; }
extern "C" int strcmp(const char* a, const char* b) { while (*a && *a == *b) { ++a; ++b; } return *a - *b; }
#define CHECK(condition) if (!(condition)) return __LINE__
extern "C" __declspec(dllexport) int runPowerBridgeTests() {
  using namespace PowerBridge;
  const int64_t now = 1794268800000LL;
  const char* id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const char* next = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const char* boot = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const char* reboot = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  CHECK(expiry("2026-11-10T00:00:00.000Z") == now);
  CHECK(expiry("2026-11-10T00:00:30.123Z") == now + 30123);
  CHECK(expiry("2028-02-29T00:00:00.000Z") - expiry("2028-02-28T00:00:00.000Z") == 86400000LL);
  CHECK(!expiry("2026-02-29T00:00:00.000Z"));
  CHECK(!expiry("2100-02-29T00:00:00.000Z"));
  CHECK(!expiry("2026-11-31T00:00:00.000Z"));
  CHECK(!expiry("2026-11-10T24:00:00.000Z"));
  CHECK(!expiry("2026-11-10T00:00:00.000+08:00"));
  CHECK(!expiry("2026-11-10T00:00:00.a00Z"));
  CHECK(!expiry("short"));

  Engine engine;
  CHECK(engine.assign(0, id, now + 30000, now, true, Off, boot));
  CHECK(engine.slots[0].state == Waiting && !engine.slots[0].dirty);
  CHECK(engine.assign(0, id, now + 30000, now + 1000, true, Off, boot));
  CHECK(!engine.assign(0, id, now + 31000, now, true, Off, boot));
  CHECK(!engine.assign(0, next, now + 30000, now, true, Off, boot));
  CHECK(!engine.assign(1, id, now + 30000, now, true, Off, boot));
  CHECK(engine.dispatch(0, now, true, Off, boot));
  CHECK(engine.slots[0].dirty && engine.slots[0].state == Accepted);
  CHECK(engine.dispatch(0, now + 1000, true, Off, boot));
  CHECK(engine.slots[0].issued == now && engine.slots[0].expires == now + 30000);
  engine.result(0, next, now, ConfirmedOn, On); CHECK(engine.slots[0].state == Accepted);
  engine.result(0, id, now + 1, ConfirmedOn, On); CHECK(engine.slots[0].state == Accepted);
  engine.result(0, id, now, ConfirmedOn, Off); CHECK(engine.slots[0].state == Accepted);
  engine.result(0, id, now, Accepted, Off);
  CHECK(!engine.dispatch(0, now + 2000, true, Off, boot));
  engine.acknowledge(0, id, Accepted);
  CHECK(!engine.slots[0].dirty && engine.owns(id));
  engine.result(0, id, now, ConfirmedOn, On);
  CHECK(engine.slots[0].dirty && engine.slots[0].state == ConfirmedOn);
  engine.acknowledge(0, id, Accepted); // Delayed cloud ack cannot discard success.
  CHECK(engine.slots[0].dirty && engine.owns(id));
  engine.result(0, id, now, Unknown, Unavailable); CHECK(engine.slots[0].state == ConfirmedOn);
  engine.acknowledge(0, id, ConfirmedOn); CHECK(!engine.owns(id));

  // An undelivered command expires as rejected. A possibly dispatched command
  // expires as unknown and must never be dispatched after node restart.
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Off, boot);
  engine.tick(0, now + 30000, boot); CHECK(engine.slots[0].state == Rejected);
  CHECK(!engine.dispatch(0, now + 30000, true, Off, boot));
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Off, boot);
  engine.dispatch(0, now, true, Off, boot);
  CHECK(!engine.dispatch(0, now + 30000, true, Off, boot));
  engine.tick(0, now + 50000, boot); CHECK(engine.slots[0].state == Unknown);
  engine.acknowledge(0, id, Accepted); CHECK(engine.slots[0].dirty);
  engine.acknowledge(0, id, Unknown); CHECK(engine.owns(id) && !engine.slots[0].dirty);
  engine.result(0, id, now, Accepted, Off); CHECK(engine.slots[0].state == Unknown);
  CHECK(!engine.dispatch(0, now + 1000, true, Off, boot));
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Off, boot);
  engine.dispatch(0, now, true, Off, boot); engine.tick(0, now + 1000, reboot);
  CHECK(engine.slots[0].state == Unknown && !engine.dispatch(0, now + 1000, true, Off, reboot));
  Engine restarted;
  restarted.result(0, id, now, ConfirmedOn, On); CHECK(!restarted.owns(id));

  // OFF and a ready executor are required, while observed ON needs no pulse.
  engine = Engine(); engine.assign(0, id, now + 30000, now, false, Off, boot);
  CHECK(engine.slots[0].state == Rejected);
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Unavailable, boot);
  CHECK(engine.slots[0].state == Waiting && !engine.slots[0].dirty);
  CHECK(engine.slots[0].reason == WaitingFeedback);
  CHECK(!engine.dispatch(0, now + 8000, true, Unavailable, boot));
  CHECK(engine.dispatch(0, now + 9000, true, Off, boot));
  CHECK(engine.slots[0].issued == now && engine.slots[0].expires == now + 30000);
  engine.result(0, id, now, Rejected, Off);
  CHECK(engine.slots[0].reason == NodeRefused);
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Unavailable, boot);
  engine.tick(0, now + 30000, boot);
  CHECK(engine.slots[0].state == Rejected && !engine.slots[0].dispatched);
  CHECK(engine.slots[0].reason == CommandExpired);
  CHECK(!engine.dispatch(0, now + 30001, true, Off, boot));
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, On, boot);
  CHECK(engine.slots[0].state == ConfirmedOn && !engine.dispatch(0, now, true, On, boot));
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Off, boot);
  CHECK(!engine.dispatch(0, now + 1000, true, On, boot));
  CHECK(engine.slots[0].state == ConfirmedOn && !engine.slots[0].dispatched);
  engine = Engine(); engine.assign(0, id, now + 30000, now, true, Off, boot);
  CHECK(!engine.dispatch(0, now, true, Unavailable, boot));
  CHECK(engine.slots[0].state == Waiting);
  CHECK(!engine.assign(5, id, now + 30000, now, true, Off, boot));
  CHECK(!engine.assign(1, "bad", now + 30000, now, true, Off, boot));
  return 0;
}
