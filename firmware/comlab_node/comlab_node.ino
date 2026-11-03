/*
 * ComLab workstation node: authenticated Wi-Fi heartbeat, version 1.
 * ESP32-WROOM DevKit V1, Arduino ESP32 3.3.7, ArduinoJson 7.
 * This discovery stage never reads or drives relay GPIO. Disconnect PC power-
 * button wiring until relay polarity, supply and real power feedback are verified.
 * Requires the updated comlab_cloud controller with the matching local node key.
 */
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <esp_system.h>
#include <time.h>
#include "NodeAuth.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

static WiFiUDP nodeUdp;
static IPAddress controllerIp;
static String nodeBootId;
static uint32_t sequence = 0, nextReportMs = 0, nextWifiMs = 0, lastAckMs = 0, lastDiscoveryMs = 0;
static bool configured = false, networkStarted = false;

static String makeNodeBootId() {
  char value[33];
  for (size_t i = 0; i < 4; ++i) snprintf(value + i * 8, 9, "%08lx", static_cast<unsigned long>(esp_random()));
  return String(value);
}

static void receiveAcknowledgements() {
  for (int count = 0; count < 8; ++count) {
    const int length = nodeUdp.parsePacket();
    if (length <= 0) return;
    if (length > static_cast<int>(NODE_PACKET_LIMIT) || nodeUdp.remoteIP() != controllerIp || nodeUdp.remotePort() != NODE_CONTROLLER_PORT) {
      while (nodeUdp.available()) nodeUdp.read();
      continue;
    }
    char packet[NODE_PACKET_LIMIT + 1];
    const int received = nodeUdp.read(packet, length);
    if (received != length) continue;
    packet[received] = 0;
    JsonDocument envelope, body;
    if (deserializeJson(envelope, packet)) continue;
    const String raw = envelope["body"] | "";
    if (!nodeVerify(COMLAB_NODE_KEY, NODE_REPLY_DOMAIN, raw, envelope["signature"] | "") || deserializeJson(body, raw)) continue;
    if (body["protocolVersion"] != 1 || body["nodeId"].as<String>() != COMLAB_NODE_ID ||
        body["bootId"].as<String>() != nodeBootId || body["ackSequence"].as<uint32_t>() != sequence) continue;
    lastAckMs = millis();
    Serial.printf("[Node %s / %s] Controller acknowledged heartbeat. PC power: unknown. Relay control disabled.\n", COMLAB_NODE_ID, COMLAB_WORKSTATION_ID);
  }
}

static void reportHeartbeat() {
  if (controllerIp == IPAddress() || (millis() - lastAckMs > 15000 && millis() - lastDiscoveryMs > 15000)) {
    lastDiscoveryMs = millis();
    controllerIp = MDNS.queryHost(COMLAB_CONTROLLER_HOST, 800);
    if (controllerIp == IPAddress()) {
      Serial.println("[Node] Controller not discovered. Upload the updated controller and check router client isolation/mDNS.");
      return;
    }
  }
  ++sequence;
  if (sequence == 0) { nodeBootId = makeNodeBootId(); sequence = 1; }
  JsonDocument body;
  body["protocolVersion"] = 1; body["nodeId"] = COMLAB_NODE_ID;
  body["workstationId"] = COMLAB_WORKSTATION_ID; body["bootId"] = nodeBootId;
  body["sequence"] = sequence; body["uptimeMs"] = millis();
  body["sampledAtMs"] = static_cast<int64_t>(time(nullptr)) * 1000;
  body["power"] = "unknown"; body["reachability"] = "unknown"; body["input"] = "unknown";
  String raw; serializeJson(body, raw);
  const String packet = nodePacket(COMLAB_NODE_KEY, NODE_REPORT_DOMAIN, raw);
  if (packet.isEmpty()) return;
  if (nodeUdp.beginPacket(controllerIp, NODE_CONTROLLER_PORT)) {
    nodeUdp.write(reinterpret_cast<const uint8_t*>(packet.c_str()), packet.length());
    nodeUdp.endPacket();
  }
}

void setup() {
  Serial.begin(115200); delay(200);
  configured = strlen(COMLAB_NODE_WIFI_SSID) > 0 && nodeHex(String(COMLAB_NODE_KEY), 64) &&
    String(COMLAB_NODE_ID).length() > 0 && String(COMLAB_WORKSTATION_ID).length() > 0;
  if (!configured) {
    Serial.println("[Node] Run server/scripts/configure-node.js for this PC. Local secrets.h is missing or incomplete.");
    return;
  }
  nodeBootId = makeNodeBootId();
  WiFi.mode(WIFI_STA);
  String hostname = String("comlab-") + COMLAB_NODE_ID; hostname.toLowerCase();
  WiFi.setHostname(hostname.c_str()); WiFi.setAutoReconnect(true);
  WiFi.begin(COMLAB_NODE_WIFI_SSID, COMLAB_NODE_WIFI_PASSWORD);
  nextWifiMs = millis() + 10000;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.printf("[Node] Starting %s / %s. Waiting for Wi-Fi and synchronized time. Relay control disabled.\n", COMLAB_NODE_ID, COMLAB_WORKSTATION_ID);
}

void loop() {
  if (!configured) { delay(100); return; }
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (networkStarted) { nodeUdp.stop(); MDNS.end(); networkStarted = false; controllerIp = IPAddress(); }
    if (static_cast<int32_t>(now - nextWifiMs) >= 0) { WiFi.reconnect(); nextWifiMs = now + 10000; }
    delay(10); return;
  }
  if (time(nullptr) < 1700000000) { delay(20); return; }
  if (!networkStarted) {
    String hostname = String("comlab-") + COMLAB_NODE_ID; hostname.toLowerCase();
    if (!MDNS.begin(hostname.c_str()) || !nodeUdp.begin(NODE_CLIENT_PORT)) { delay(1000); return; }
    networkStarted = true;
    Serial.printf("[Node] Wi-Fi ready. IP: %s\n", WiFi.localIP().toString().c_str());
  }
  receiveAcknowledgements();
  if (static_cast<int32_t>(now - nextReportMs) >= 0) {
    reportHeartbeat(); nextReportMs = millis() + 3000;
  }
  delay(2);
}
