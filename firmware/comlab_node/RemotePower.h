#pragma once
#include <Preferences.h>
#include <sys/time.h>
#include "PowerPolicy.h"

// Signed controller acknowledgements carry powerCommand. Keep this journal
// separate from diagnostics; persist identity BEFORE requesting any pulse.
namespace RemotePower {
static Preferences journal;
static const uint32_t MAGIC = 0x434C5031;
struct Record { uint32_t magic; char id[37]; int64_t issuedAtMs; uint8_t state; };
static Record last = {};
static bool ready = false, inFlight = false;
static bool offCmd = false;  // last command was power_off (press to shut down a running PC)
static int64_t expiresAtMs = 0;
static uint32_t startedMs = 0;
static int64_t nowMs() {
  struct timeval now;
  gettimeofday(&now, nullptr);
  return static_cast<int64_t>(now.tv_sec) * 1000 + now.tv_usec / 1000;
}
// ConfirmedOn means the PC reached the commanded state.
static const char* stateName() { return offCmd ? "confirmed_off" : "confirmed_on"; }
static bool save() {
  journal.putUChar("act", offCmd ? 1 : 0);
  if (journal.putBytes("last", &last, sizeof(last)) == sizeof(last)) return true;
  ready = false;
  Serial.println("[Power command] NVS write failed; power commands disabled.");
  return false;
}
static bool guard() {
  // Called by the relay timer: no storage, logging or networking here.
  return ready && inFlight && COMLAB_NODE_POWER_SENSE &&
    digitalRead(PowerSense::PIN) == (offCmd ? LOW : HIGH) &&
    PowerPolicy::validTime(nowMs(), last.issuedAtMs, expiresAtMs);
}
// Local operator recovery after independently checking that the PC is OFF.
// Preserve command identity and issue watermark: recovery never replays work.
static bool recoverOff(const char* id) {
  if (!ready || !last.magic || last.state != PowerPolicy::Unknown ||
      !PowerPolicy::uuid(id) || strcmp(id, last.id) != 0 || inFlight ||
      RemoteBench::inFlight || RelayBench::active || RelayBench::pending || RelayBench::armed ||
      !COMLAB_NODE_POWER_SENSE || strcmp(PowerSense::state(), "off") != 0 ||
      digitalRead(PowerSense::PIN) != HIGH) return false;
  last.state = PowerPolicy::Rejected;
  if (!save()) { last.state = PowerPolicy::Unknown; return false; }
  Serial.printf("[Power command] Operator confirmed PC OFF; resolved old command %s. Identity retained; no pulse sent.\n", last.id);
  return true;
}
static bool serialCommand(const char* text) {
  if (strcmp(text, "POWERSTATUS") == 0) {
    Serial.printf("[Power command] Ready=%s; command=%s; state=%u; issued=%lld; sensor=%s; inFlight=%s.\n",
      ready ? "yes" : "no", last.magic ? last.id : "none", last.state,
      static_cast<long long>(last.issuedAtMs), PowerSense::state(), inFlight ? "yes" : "no");
    return true;
  }
  const char* prefix = "POWER-RECOVER-OFF ";
  size_t i = 0;
  while (prefix[i] && text[i] == prefix[i]) ++i;
  if (prefix[i]) return false;
  if (!recoverOff(text + i)) Serial.println("[Power command] Recovery refused: exact unknown command ID, idle relay and operator-confirmed PC OFF required.");
  return true;
}
static void begin() {
  RelayBench::pulseGuard = guard;
  RelayBench::commandHook = serialCommand;
  RelayBench::benchAllowed = []() { return !inFlight && (!last.magic || last.state != PowerPolicy::Unknown); };
  ready = journal.begin("comlab-power", false);
  if (!ready) return;
  if (journal.isKey("last")) {
    if (journal.getBytesLength("last") != sizeof(last) ||
        journal.getBytes("last", &last, sizeof(last)) != sizeof(last) ||
        last.magic != MAGIC || last.id[36] != 0 || !PowerPolicy::uuid(last.id) ||
        last.issuedAtMs < 1700000000000LL || last.state > PowerPolicy::Rejected) {
      ready = false;
      Serial.println("[Power command] Journal invalid; power commands disabled.");
      return;
    }
    // A reboot cannot establish whether a pulse occurred. Never replay it.
    offCmd = journal.getUChar("act", 0) == 1;
    if (last.state == PowerPolicy::Accepted) { last.state = PowerPolicy::Unknown; save(); }
  }
  Serial.println("[Power command] Node power-on executor v1 ready; sensor feedback required. Reset GPIO22 reserved, inactive.");
  Serial.println("[Power command] Local recovery v1: POWER-RECOVER-OFF <exact-command-uuid>, only after physically checking PC OFF. Sends no pulse.");
}
static void accept(JsonObjectConst command) {
  if (!ready || command.isNull() || command.size() != 6 ||
      (command["action"].as<String>() != "power_on" && command["action"].as<String>() != "power_off") ||
      command["nodeId"].as<String>() != COMLAB_NODE_ID ||
      command["workstationId"].as<String>() != COMLAB_WORKSTATION_ID ||
      !command["issuedAtMs"].is<int64_t>() || !command["expiresAtMs"].is<int64_t>()) return;
  const String id = command["commandId"] | "";
  const int64_t issued = command["issuedAtMs"].as<int64_t>();
  const int64_t expiry = command["expiresAtMs"].as<int64_t>();
  const int64_t now = nowMs();
  if (!PowerPolicy::uuid(id.c_str()) || id == last.id || issued <= last.issuedAtMs || inFlight ||
      !PowerPolicy::validTime(now, issued, expiry)) return;
  // Unknown past delivery blocks any new pulse, even across reboot. Do not
  // overwrite its identity with a new command's rejection.
  if (last.magic && last.state == PowerPolicy::Unknown) return;
  const bool off = command["action"].as<String>() == "power_off";
  // power_on presses only while the PC is OFF; power_off only while it is ON.
  const bool allowed = PowerPolicy::canStart(COMLAB_NODE_POWER_SENSE,
    strcmp(PowerSense::state(), off ? "on" : "off") == 0,
    COMLAB_NODE_POWER_SENSE && digitalRead(PowerSense::PIN) == (off ? LOW : HIGH),
    RemoteBench::inFlight || !RelayBench::ready, false);
  offCmd = off;
  last = {}; last.magic = MAGIC; id.toCharArray(last.id, sizeof(last.id)); last.issuedAtMs = issued;
  last.state = allowed ? PowerPolicy::Accepted : PowerPolicy::Rejected;
  if (!save() || !allowed) return;
  expiresAtMs = expiry; startedMs = millis(); inFlight = true;
  if (!RelayBench::remotePulse(true)) {
    inFlight = false; last.state = PowerPolicy::Rejected; save();
  } else Serial.printf("[Power command] Authenticated %s queued; one guarded 300ms pulse.\n", off ? "power-off" : "power-on");
}
static void poll() {
  if (!inFlight) return;
  const auto state = PowerPolicy::completion(RelayBench::remoteStatus(),
    strcmp(PowerSense::state(), offCmd ? "off" : "on") == 0,
    millis() - startedMs >= (offCmd ? 150000UL : 20000UL));  // Windows needs time to shut down
  if (state == PowerPolicy::Accepted) return;
  inFlight = false; last.state = state;
  if (!save()) last.state = PowerPolicy::Unknown;
  Serial.printf("[Power command] Result: %s. No automatic pulse retry.\n",
    last.state == PowerPolicy::ConfirmedOn ? stateName() : last.state == PowerPolicy::Rejected ? "rejected" : "unknown");
}
static void addReport(JsonDocument& body) {
  body["powerReady"] = ready && RelayBench::ready && COMLAB_NODE_POWER_SENSE &&
    (!last.magic || last.state != PowerPolicy::Unknown);
  if (!last.magic) return;
  JsonObject result = body["powerResult"].to<JsonObject>();
  result["commandId"] = last.id; result["issuedAtMs"] = last.issuedAtMs;
  result["state"] = last.state == PowerPolicy::ConfirmedOn ? stateName() :
    last.state == PowerPolicy::Rejected ? "rejected" : last.state == PowerPolicy::Accepted ? "accepted" : "unknown";
}
}
