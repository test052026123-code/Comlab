#include "RelayBench.h"
#include "PowerPolicy.h"
extern "C" void* memset(void* output, int value, size_t count) {
  for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = value;
  return output;
}
extern "C" void* memcpy(void* output, const void* input, size_t count) {
  for (size_t i = 0; i < count; ++i) static_cast<unsigned char*>(output)[i] = static_cast<const unsigned char*>(input)[i];
  return output;
}
extern "C" int strcmp(const char* a, const char* b) {
  while (*a && *a == *b) { ++a; ++b; } return *a - *b;
}
extern "C" size_t strlen(const char* text) { size_t size = 0; while (text[size]) ++size; return size; }
namespace FakePower {
inline bool on = false, rawOn = false;
inline int64_t epoch = 1800000000000LL;
}
#define COMLAB_NODE_POWER_SENSE 1
#define COMLAB_NODE_ID "NODE-01"
#define COMLAB_WORKSTATION_ID "PC-01"
#define HIGH 1
static int digitalRead(int) { return FakePower::rawOn ? 0 : 1; }
static int64_t time(void*) { return (FakePower::epoch + FakeBoard::nowUs / 1000) / 1000; }
namespace PowerSense {
constexpr int PIN = 33;
static const char* state() { return FakePower::on ? "on" : "off"; }
}
namespace RemoteBench { static bool inFlight = false; }

// Minimal JSON adapter: tests invoke the actual production executor with
// validated command fields. ArduinoJson itself is checked by the ESP32 build.
struct Value {
  const char* text = "";
  int64_t number = 0;
  bool numeric = false;
  template<typename T> T as() const;
  template<typename T> bool is() const { return numeric; }
  template<typename T> T to();
  const char* operator|(const char*) const { return text; }
  Value& operator=(const char* v) { text = v; numeric = false; return *this; }
  Value& operator=(int64_t v) { number = v; numeric = true; return *this; }
};
template<> String Value::as<String>() const { return String(text); }
template<> int64_t Value::as<int64_t>() const { return number; }
struct JsonObjectConst {
  Value values[8];
  bool present = true;
  size_t fields = 6;
  bool isNull() const { return !present; }
  size_t size() const { return fields; }
  Value& operator[](const char* name) {
    const char* keys[] = {"action", "nodeId", "workstationId", "commandId", "issuedAtMs", "expiresAtMs", "powerReady", "powerResult"};
    for (int i = 0; i < 8; ++i) if (strcmp(name, keys[i]) == 0) return values[i];
    return values[7];
  }
};
using JsonObject = JsonObjectConst;
using JsonDocument = JsonObjectConst;
template<> JsonObject Value::to<JsonObject>() { return JsonObject(); }
#include "RemotePower.h"
#include "PowerBridge.h"

static void reset(bool erase = true) {
  FakeBoard::nowUs = FakeBoard::nextTick = FakeBoard::period = 0;
  FakeBoard::callback = nullptr; FakeBoard::failCreate = FakeBoard::failStart = false;
  FakeBoard::level = FakeBoard::risingEdges = 0;
  RelayBench::active = RelayBench::ended = RelayBench::armed = RelayBench::expired = false;
  RelayBench::pending = RelayBench::ready = RelayBench::tested = RelayBench::guardedPulse = false;
  RelayBench::lastTestAt = 0; RelayBench::remoteProgress = 0;
  RelayBench::pulseGuard = nullptr; RelayBench::benchAllowed = nullptr;
  FakeStorage::failWrite = FakeStorage::failOpen = false;
  if (erase) { FakeStorage::length = 0; FakeStorage::writes = 0; }
  RemotePower::last = {}; RemotePower::ready = RemotePower::inFlight = false;
  RemotePower::expiresAtMs = 0; RemotePower::startedMs = 0;
  FakePower::on = FakePower::rawOn = false; RemoteBench::inFlight = false;
  RelayBench::begin(); RemotePower::begin();
}
static JsonObject command(const char* id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", int64_t offset = 0) {
  JsonObject c;
  c["action"] = "power_on"; c["nodeId"] = "NODE-01"; c["workstationId"] = "PC-01";
  c["commandId"] = id; c["issuedAtMs"] = FakePower::epoch + offset; c["expiresAtMs"] = FakePower::epoch + offset + 30000;
  return c;
}
#define CHECK(condition) if (!(condition)) return __LINE__
static int runIntegrationCase() {
  reset();
  PowerBridge::Engine bridge;
  const char* boot = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const char* id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  CHECK(bridge.assign(0, id, FakePower::epoch + 30000, FakePower::epoch, true, PowerBridge::Off, boot));
  CHECK(bridge.dispatch(0, FakePower::epoch, true, PowerBridge::Off, boot));
  auto c = command(); c["issuedAtMs"] = bridge.slots[0].issued; c["expiresAtMs"] = bridge.slots[0].expires;
  RemotePower::accept(c);
  CHECK(bridge.dispatch(0, FakePower::epoch + 1, true, PowerBridge::Off, boot));
  RemotePower::accept(c);
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 1);
  bridge.result(0, id, RemotePower::last.issuedAtMs, PowerBridge::Accepted, PowerBridge::Off);
  CHECK(!bridge.dispatch(0, FakePower::epoch + 10, true, PowerBridge::Off, boot));
  FakeBoard::advance(300000); FakePower::on = FakePower::rawOn = true;
  RemotePower::poll(); CHECK(RemotePower::last.state == PowerPolicy::ConfirmedOn);
  bridge.result(0, id, RemotePower::last.issuedAtMs, PowerBridge::ConfirmedOn, PowerBridge::On);
  bridge.acknowledge(0, id, PowerBridge::Accepted);
  CHECK(bridge.slots[0].state == PowerBridge::ConfirmedOn && bridge.slots[0].dirty);
  RemotePower::accept(c); FakeBoard::advance(3000000); CHECK(FakeBoard::risingEdges == 1);
  bridge.acknowledge(0, id, PowerBridge::ConfirmedOn); CHECK(!bridge.owns(id));
  return 0;
}
static __declspec(noinline) int runRecoveryCases() {
  reset(); RemotePower::accept(command()); reset(false);
  // Local recovery requires the exact unresolved identity and physical OFF.
  CHECK(!RemotePower::recoverOff("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
  FakePower::rawOn = true;
  CHECK(!RemotePower::recoverOff("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  FakePower::rawOn = false; FakePower::on = true;
  CHECK(!RemotePower::recoverOff("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  FakePower::on = false; RelayBench::armed = true;
  CHECK(!RemotePower::recoverOff("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  RelayBench::armed = false;
  FakeBoard::serialInput = "POWER-RECOVER-OFF aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n";
  RelayBench::poll();
  CHECK(RemotePower::last.state == PowerPolicy::Rejected && FakeBoard::risingEdges == 0);
  CHECK(RemotePower::last.issuedAtMs == FakePower::epoch);
  reset(false); RemotePower::accept(command()); FakeBoard::advance(5000);
  CHECK(FakeBoard::risingEdges == 0); // Old command still cannot replay.
  FakeBoard::advance(1000000);
  RemotePower::accept(command("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1000));
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 1);

  // Failed recovery persistence disables execution and keeps uncertainty.
  reset(); RemotePower::accept(command()); reset(false);
  FakeStorage::failWrite = true;
  CHECK(!RemotePower::recoverOff("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
  CHECK(!RemotePower::ready && RemotePower::last.state == PowerPolicy::Unknown);

  return 0;
}
extern "C" __declspec(dllexport) int runRemotePowerTests() {
  reset(); CHECK(FakeBoard::risingEdges == 0);
  auto c = command(); RemotePower::accept(c);
  CHECK(RemotePower::inFlight && FakeStorage::writes == 1 && FakeBoard::risingEdges == 0);
  RemotePower::accept(c); CHECK(FakeStorage::writes == 1);
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 1);
  FakeBoard::advance(300000); RemotePower::poll(); CHECK(RemotePower::inFlight);
  FakePower::on = FakePower::rawOn = true; RemotePower::poll();
  CHECK(!RemotePower::inFlight && RemotePower::last.state == PowerPolicy::ConfirmedOn);
  reset(false); RemotePower::accept(c); FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 0);

  // Reboot after journaling but before HIGH: no replay, and block fresh IDs.
  reset(); RemotePower::accept(command()); reset(false);
  CHECK(RemotePower::last.state == PowerPolicy::Unknown);
  RemotePower::accept(command());
  RemotePower::accept(command("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1000));
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 0);
  CHECK(!RelayBench::remotePulse());

  // Raw power changes before the timer callback prevent a physical pulse.
  reset(); RemotePower::accept(command()); FakePower::rawOn = true;
  FakeBoard::advance(5000); RemotePower::poll();
  CHECK(FakeBoard::risingEdges == 0 && RemotePower::last.state == PowerPolicy::Rejected);
  // Expiry is also rechecked at the timer, not only at network receipt.
  reset(); c = command(); c["expiresAtMs"] = FakePower::epoch + 1;
  RemotePower::accept(c);
  FakeBoard::advance(5000); RemotePower::poll();
  CHECK(FakeBoard::risingEdges == 0 && RemotePower::last.state == PowerPolicy::Rejected);

  // Neither failed durable storage nor known ON may energize the relay.
  reset(); FakeStorage::failWrite = true; RemotePower::accept(command());
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 0 && !RemotePower::ready);
  reset(); FakePower::on = true; RemotePower::accept(command());
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 0 && RemotePower::last.state == PowerPolicy::Rejected);
  reset(); RemoteBench::inFlight = true; RemotePower::accept(command());
  FakeBoard::advance(5000); CHECK(FakeBoard::risingEdges == 0);
  reset(); c = command(); c["nodeId"] = "NODE-02"; RemotePower::accept(c);
  CHECK(FakeStorage::writes == 0);
  reset(); c = command(); c["expiresAtMs"] = FakePower::epoch; RemotePower::accept(c);
  CHECK(FakeStorage::writes == 0);

  // No ON feedback after one pulse becomes unknown, never an automatic retry.
  reset(); RemotePower::accept(command()); FakeBoard::advance(20000000); RemotePower::poll();
  CHECK(FakeBoard::risingEdges == 1 && !RemotePower::inFlight && RemotePower::last.state == PowerPolicy::Unknown);
  RemotePower::accept(command()); FakeBoard::advance(5000000); CHECK(FakeBoard::risingEdges == 1);
  // OFF remains usable while a command is pending.
  reset(); RemotePower::accept(command()); RelayBench::command(String("OFF"));
  FakeBoard::advance(5000); RemotePower::poll();
  CHECK(FakeBoard::risingEdges == 0 && RemotePower::last.state == PowerPolicy::Unknown);
  // Corrupt storage fails closed.
  reset(); RemotePower::accept(command()); FakeStorage::bytes[0] ^= 1; reset(false);
  CHECK(!RemotePower::ready && FakeBoard::risingEdges == 0);

  // Exercise the actual controller lifecycle and node executor together. A
  // retransmitted bridge command must still produce exactly one GPIO pulse.
  const int recovery = runRecoveryCases();
  if (recovery) return recovery;
  return runIntegrationCase();
}
