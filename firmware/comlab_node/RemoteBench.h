#pragma once
#include <Preferences.h>
#include "BenchPolicy.h"

namespace RemoteBench {
static Preferences journal;
static const uint32_t MAGIC = 0x434C4231;
struct Record { uint32_t magic; char id[37]; int64_t issuedAtMs; uint8_t state; };
static Record last = {};
static bool ready = false, inFlight = false;

static bool save() {
  if (journal.putBytes("last", &last, sizeof(last)) == sizeof(last)) return true;
  ready = false;
  Serial.println("[Remote bench] NVS write failed; remote testing disabled.");
  return false;
}
static void begin() {
  RelayBench::statusHook = []() {
    Serial.printf("[Remote bench] Ready: %s; last command: %s; state: %u; issued: %lld; now: %lld.\n",
      ready ? "yes" : "no", last.id, last.state, static_cast<long long>(last.issuedAtMs), static_cast<long long>(time(nullptr)) * 1000);
  };
  ready = journal.begin("comlab-bench", false);
  if (!ready) return;
  if (journal.isKey("last")) {
    if (journal.getBytesLength("last") != sizeof(last) || journal.getBytes("last", &last, sizeof(last)) != sizeof(last) ||
        last.magic != MAGIC || last.id[36] != 0 || strlen(last.id) != 36 || last.state > 2) {
      ready = false; Serial.println("[Remote bench] Journal invalid; remote testing disabled."); return;
    }
  }
  Serial.println("[Remote bench] Authenticated app relay test ready v1. One 300ms pulse; PC power stays unknown.");
}
static void accept(JsonObjectConst command) {
  if (!ready || !RelayBench::ready || command.isNull() || command.size() != 6 ||
      command["action"].as<String>() != "relay_bench_pulse" || command["nodeId"].as<String>() != COMLAB_NODE_ID ||
      command["workstationId"].as<String>() != COMLAB_WORKSTATION_ID ||
      !command["issuedAtMs"].is<int64_t>() || !command["expiresAtMs"].is<int64_t>()) return;
  const String id = command["commandId"] | "";
  const int64_t issued = command["issuedAtMs"].as<int64_t>(), expires = command["expiresAtMs"].as<int64_t>();
  const int64_t now = static_cast<int64_t>(time(nullptr)) * 1000;
  if (id.length() != 36 || id == last.id || inFlight) return;
  if (!benchTimeValid(now, issued, expires) || !benchNewer(issued, last.issuedAtMs)) {
    Serial.printf("[Remote bench] Ignored expired/old command %s (issued %lld; expires %lld; now %lld).\n", id.c_str(), static_cast<long long>(issued), static_cast<long long>(expires), static_cast<long long>(now));
    return;
  }
  last = {}; last.magic = MAGIC; id.toCharArray(last.id, sizeof(last.id)); last.issuedAtMs = issued;
  last.state = 0; // Durable unknown BEFORE any GPIO transition; never replay after restart.
  if (!save()) return;
  if (RelayBench::remotePulse()) {
    inFlight = true;
    Serial.printf("[Remote bench] %s: authenticated central command; 300ms pulse queued.\n", last.id);
  } else {
    last.state = 1; save();
    Serial.println("[Remote bench] Test rejected: timer unavailable or relay cooldown/busy.");
  }
}
static void poll() {
  if (!inFlight) return;
  const int status = RelayBench::remoteStatus();
  if (status != 3 && status != 4) return;
  last.state = status == 3 ? 2 : 0;
  inFlight = false;
  if (!save()) last.state = 0;
  Serial.printf("[Remote bench] %s: %s; reporting to central.\n", last.id, last.state == 2 ? "pulse finished (GPIO released)" : "outcome unknown");
}
static void addReport(JsonDocument& body) {
  body["benchReady"] = ready && RelayBench::ready;
  if (!last.magic || inFlight) return;
  JsonObject result = body["benchResult"].to<JsonObject>();
  result["commandId"] = last.id; result["issuedAtMs"] = last.issuedAtMs;
  result["state"] = last.state == 2 ? "pulse_finished" : last.state == 1 ? "rejected" : "unknown";
}
}
