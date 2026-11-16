/*
 * ComLab workstation node v2: reports to the Raspberry Pi server over the lab LAN.
 * ESP32-WROOM DevKit V1, Arduino ESP32 3.3.x, ArduinoJson 7.
 *
 * Every 3 s: POST <COMLAB_SERVER_URL>/node/heartbeat  (header x-node-key)
 *   { nodeId, power: on|off|unknown, rssi, ip, powerResult? }
 * Reply: { ok, serverTimeMs, command? }. The node sets its clock from serverTimeMs
 * (the lab has no internet, so no NTP), and power_on / power_off commands are executed by
 * RemotePower: one guarded 300 ms pulse on GPIO23, only while the sensor reads OFF (power_on) or ON (power_off: Windows shuts down).
 * The Pi decides when something is wrong (PC did not start, PC switched off mid-session).
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <sys/time.h>
#include <time.h>
#include "NodeAuth.h"
#include "RelayBench.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif
#include "RemoteBench.h"
#include "PowerSense.h"
#include "RemotePower.h"

static const uint32_t REPORT_EVERY_MS = 3000;
static uint32_t nextReportMs = 0, nextWifiMs = 0, failures = 0;
static bool configured = false, wasConnected = false;

static void setClock(int64_t ms) {
  if (ms < 1700000000000LL) return;
  struct timeval tv = { static_cast<time_t>(ms / 1000), static_cast<suseconds_t>((ms % 1000) * 1000) };
  settimeofday(&tv, nullptr);
}

static void reportHeartbeat() {
  JsonDocument body;
  body["nodeId"] = COMLAB_NODE_ID;
  body["power"] = PowerSense::state();
  body["rssi"] = WiFi.RSSI();
  body["ip"] = WiFi.localIP().toString();
  if (RemotePower::last.magic) {
    JsonObject r = body["powerResult"].to<JsonObject>();
    r["commandId"] = RemotePower::last.id;
    const uint8_t s = RemotePower::last.state;
    r["state"] = s == PowerPolicy::ConfirmedOn ? RemotePower::stateName() : s == PowerPolicy::Rejected ? "rejected" :
                 s == PowerPolicy::Accepted ? "accepted" : "unknown";
  }
  String raw; serializeJson(body, raw);

  HTTPClient http;
  http.setConnectTimeout(2000); http.setTimeout(2500);
  if (!http.begin(String(COMLAB_SERVER_URL) + "/node/heartbeat")) return;
  http.addHeader("content-type", "application/json");
  http.addHeader("x-node-key", COMLAB_NODE_KEY);
  const int code = http.POST(raw);
  const String reply = code > 0 ? http.getString() : String();
  http.end();

  if (code != 200) {
    ++failures;
    if (code == 401) Serial.println("[Node] Pi rejected the node key. Check COMLAB_NODE_KEY in secrets.h.");
    else if (code == 404) Serial.printf("[Node] Pi does not know %s. Set it as the ESP32 node ID of a workstation in the dashboard.\n", COMLAB_NODE_ID);
    else if (failures % 5 == 1) Serial.printf("[Node] Pi not reachable at %s (code %d).\n", COMLAB_SERVER_URL, code);
    return;
  }
  if (failures) Serial.println("[Node] Connected to the Pi server.");
  failures = 0;
  JsonDocument doc;
  if (deserializeJson(doc, reply)) return;
  setClock(doc["serverTimeMs"] | 0LL);
  JsonObjectConst cmd = doc["command"].as<JsonObjectConst>();
  if (!cmd.isNull()) {
    Serial.printf("[Node] %s command %s received.\n", cmd["action"].as<const char*>(), cmd["commandId"].as<const char*>());
    RemotePower::accept(cmd);
  }
}

void setup() {
  Serial.begin(115200); delay(200);
  RelayBench::begin();
  RemoteBench::begin();
  PowerSense::begin();
  digitalWrite(22, LOW); pinMode(22, OUTPUT);  // reset channel reserved, inactive
  RemotePower::begin();
  configured = strlen(COMLAB_NODE_WIFI_SSID) > 0 && strlen(COMLAB_NODE_KEY) >= 16 &&
    strlen(COMLAB_NODE_ID) > 0 && strlen(COMLAB_SERVER_URL) > 7;
  if (!configured) { Serial.println("[Node] secrets.h is missing or incomplete (Wi-Fi, node ID, node key, server URL)."); return; }
  WiFi.mode(WIFI_STA);
  String hostname = String("comlab-") + COMLAB_NODE_ID; hostname.toLowerCase();
  WiFi.setHostname(hostname.c_str()); WiFi.setAutoReconnect(true);
  WiFi.begin(COMLAB_NODE_WIFI_SSID, COMLAB_NODE_WIFI_PASSWORD);
  nextWifiMs = millis() + 10000;
  Serial.printf("[Node] v2 starting %s / %s -> %s\n", COMLAB_NODE_ID, COMLAB_WORKSTATION_ID, COMLAB_SERVER_URL);
}

void loop() {
  RelayBench::poll();
  RemoteBench::poll();
  PowerSense::poll();
  RemotePower::poll();
  if (!configured) { delay(100); return; }
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wasConnected) { Serial.println("[Node] Wi-Fi lost."); wasConnected = false; }
    if (static_cast<int32_t>(now - nextWifiMs) >= 0) { WiFi.reconnect(); nextWifiMs = now + 10000; }
    delay(10); return;
  }
  if (!wasConnected) { wasConnected = true; Serial.printf("[Node] Wi-Fi ready. IP: %s\n", WiFi.localIP().toString().c_str()); }
  if (static_cast<int32_t>(now - nextReportMs) >= 0) {
    reportHeartbeat(); nextReportMs = millis() + REPORT_EVERY_MS;
  }
  delay(2);
}
