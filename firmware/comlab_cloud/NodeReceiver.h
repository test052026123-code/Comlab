#pragma once
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <time.h>
#include "NodeAuth.h"
#if __has_include("node_secrets.h")
#include "node_secrets.h"
#else
#include "node_secrets.example.h"
#endif

struct NodeObservation {
  bool seen = false;
  String bootId, raw;
  uint32_t sequence = 0, receivedMs = 0;
  int64_t sampledAtMs = 0;
  bool benchReady = false;
  String power = "unknown";
};
static NodeObservation nodeObservations[5];
static WiFiUDP controllerNodeUdp;
static bool nodeBridgeStarted = false;
static JsonDocument controllerBenchCommand, controllerBenchResult;

static void pollBenchDiagnostics() {
  static String line;
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (line == "BENCHSTATUS") {
        Serial.printf("[Bench] Pending cloud test: %s; node result: %s.\n", (controllerBenchCommand["commandId"] | "none"), (controllerBenchResult["state"] | "none"));
      }
      line.clear();
    } else if (line.length() < 32) line += c;
    else line = "INVALID";
  }
}

static bool nodeRecent(const NodeObservation& observation) {
  const int64_t age = static_cast<int64_t>(time(nullptr)) * 1000 - observation.sampledAtMs;
  return observation.seen && millis() - observation.receivedMs < NODE_FRESH_MS && age >= -2000 && age < NODE_FRESH_MS;
}

static void addControllerBench(JsonDocument& body) {
  body["benchSupported"] = true;
  JsonArray ready = body["benchNodes"].to<JsonArray>();
  for (int i = 0; i < 5; ++i) {
    if (nodeBridgeStarted && nodeRecent(nodeObservations[i]) && nodeObservations[i].benchReady) ready.add(NODE_CREDENTIALS[i].nodeId);
  }
  if (!controllerBenchResult.isNull()) body["benchResult"].set(controllerBenchResult.as<JsonObjectConst>());
}

static void handleControllerBench(JsonDocument& body) {
  if (!controllerBenchResult.isNull() && body["acknowledgedBench"].as<String>() == controllerBenchResult["commandId"].as<String>()) {
    controllerBenchResult.clear();
    controllerBenchCommand.clear();
  }
  JsonObjectConst command = body["benchCommand"].as<JsonObjectConst>();
  // Keep the identity after dispatch expiry so a late signed node result can
  // still reach the cloud. acknowledgeNode never dispatches after expiresAtMs.
  if (command.isNull()) return;
  if (!controllerBenchResult.isNull() || command.size() != 6 || command["action"].as<String>() != "relay_bench_pulse" ||
      command["commandId"].as<String>().length() != 36 || !command["issuedAtMs"].is<int64_t>() || !command["expiresAtMs"].is<int64_t>()) return;
  for (int i = 0; i < 5; ++i) {
    if (command["nodeId"].as<String>() == NODE_CREDENTIALS[i].nodeId && command["workstationId"].as<String>() == NODE_CREDENTIALS[i].workstationId) {
      const String previous = controllerBenchCommand["commandId"] | "";
      controllerBenchCommand.set(command);
      if (previous != command["commandId"].as<String>()) Serial.printf("[Bench] Cloud test received for %s; forwarding in signed node acknowledgement.\n", NODE_CREDENTIALS[i].nodeId);
      return;
    }
  }
}

static void acknowledgeNode(size_t index, const IPAddress& address, uint16_t port) {
  const NodeObservation& observation = nodeObservations[index];
  JsonDocument body;
  body["protocolVersion"] = 1; body["nodeId"] = NODE_CREDENTIALS[index].nodeId;
  body["bootId"] = observation.bootId; body["ackSequence"] = observation.sequence;
  if (!controllerBenchCommand.isNull() && controllerBenchResult.isNull() && nodeRecent(observation) && observation.benchReady &&
      controllerBenchCommand["nodeId"].as<String>() == NODE_CREDENTIALS[index].nodeId &&
      controllerBenchCommand["expiresAtMs"].as<int64_t>() > static_cast<int64_t>(time(nullptr)) * 1000) {
    body["benchCommand"].set(controllerBenchCommand.as<JsonObjectConst>());
    Serial.printf("[Bench] Forwarding test to %s in signed acknowledgement.\n", NODE_CREDENTIALS[index].nodeId);
  }
  String raw; serializeJson(body, raw);
  const String packet = nodePacket(NODE_CREDENTIALS[index].key, NODE_REPLY_DOMAIN, raw);
  if (!packet.isEmpty() && controllerNodeUdp.beginPacket(address, port)) {
    controllerNodeUdp.write(reinterpret_cast<const uint8_t*>(packet.c_str()), packet.length());
    controllerNodeUdp.endPacket();
  }
}

static void pollNodeHeartbeats() {
  if (WiFi.status() != WL_CONNECTED) {
    if (nodeBridgeStarted) { controllerNodeUdp.stop(); MDNS.end(); nodeBridgeStarted = false; }
    return;
  }
  if (!nodeBridgeStarted) {
    bool paired = false;
    for (const NodeCredential& credential : NODE_CREDENTIALS) paired |= nodeHex(String(credential.key), 64);
    if (!paired) return; // Cloud-only fallback still works with the example header.
    if (!MDNS.begin("comlab-controller") || !controllerNodeUdp.begin(NODE_CONTROLLER_PORT)) { MDNS.end(); return; }
    MDNS.addService("comlab-node", "udp", NODE_CONTROLLER_PORT);
    nodeBridgeStarted = true;
    Serial.printf("[Nodes] Authenticated heartbeat receiver ready at %s:%u. Remote relay bench tests supported; PC power control disabled.\n", WiFi.localIP().toString().c_str(), NODE_CONTROLLER_PORT);
  }
  for (int count = 0; count < 8; ++count) {
    const int length = controllerNodeUdp.parsePacket();
    if (length <= 0) return;
    if (length > static_cast<int>(NODE_PACKET_LIMIT)) {
      while (controllerNodeUdp.available()) controllerNodeUdp.read();
      continue;
    }
    const IPAddress address = controllerNodeUdp.remoteIP();
    const uint16_t port = controllerNodeUdp.remotePort();
    char packet[NODE_PACKET_LIMIT + 1];
    const int received = controllerNodeUdp.read(packet, length);
    if (received != length) continue;
    packet[received] = 0;
    JsonDocument envelope, body;
    if (deserializeJson(envelope, packet) || !envelope.is<JsonObject>() || envelope.size() != 2) continue;
    const String raw = envelope["body"] | "";
    if (deserializeJson(body, raw) || !body.is<JsonObject>()) continue;
    if (body.size() != 10 && !(body["benchReady"].is<bool>() && (body.size() == 11 || (body.size() == 12 && body["benchResult"].is<JsonObject>())))) continue;
    int index = -1;
    for (int i = 0; i < 5; ++i) {
      if (body["nodeId"].as<String>() == NODE_CREDENTIALS[i].nodeId && body["workstationId"].as<String>() == NODE_CREDENTIALS[i].workstationId) { index = i; break; }
    }
    if (index < 0 || !nodeVerify(NODE_CREDENTIALS[index].key, NODE_REPORT_DOMAIN, raw, envelope["signature"] | "")) continue;
    if (body["protocolVersion"] != 1 || !nodeHex(body["bootId"].as<String>(), 32) ||
        !body["sequence"].is<uint32_t>() || body["sequence"].as<uint32_t>() == 0 ||
        !body["uptimeMs"].is<uint32_t>() || !body["sampledAtMs"].is<int64_t>() ||
        !(body["power"] == "unknown" || body["power"] == "on" || body["power"] == "off") || body["reachability"].as<String>() != "unknown" || body["input"].as<String>() != "unknown") continue;
    const int64_t sampledAtMs = body["sampledAtMs"].as<int64_t>();
    const int64_t currentMs = static_cast<int64_t>(time(nullptr)) * 1000;
    // Current dates fit in JSON's exact integer range; bound before subtraction.
    if (currentMs < 1700000000000LL || sampledAtMs < currentMs - NODE_FRESH_MS || sampledAtMs > currentMs + 2000) continue;
    NodeObservation& observation = nodeObservations[index];
    const String boot = body["bootId"].as<String>();
    const uint32_t sequence = body["sequence"].as<uint32_t>();
    if (observation.seen) {
      if (observation.bootId == boot) {
        if (sequence < observation.sequence || sampledAtMs < observation.sampledAtMs) continue;
        if (sequence == observation.sequence) {
          if (raw == observation.raw) acknowledgeNode(index, address, port);
          continue; // An exact duplicate never refreshes connectivity or sample time.
        }
      } else if (sampledAtMs <= observation.sampledAtMs) continue;
    }
    const bool wasRecent = nodeRecent(observation);
    observation.seen = true; observation.bootId = boot; observation.raw = raw;
    observation.sequence = sequence; observation.receivedMs = millis(); observation.sampledAtMs = sampledAtMs;
    observation.benchReady = body["benchReady"] | false;
    const String previousPower = observation.power;
    observation.power = body["power"].as<String>();
    if (wasRecent && previousPower != observation.power) Serial.printf("[Nodes] %s power: %s.\n", NODE_CREDENTIALS[index].nodeId, observation.power.c_str());
    JsonObjectConst bench = body["benchResult"].as<JsonObjectConst>();
    const String state = bench["state"] | "";
    if (bench.size() == 3 && !controllerBenchCommand.isNull() &&
        bench["commandId"].as<String>() == controllerBenchCommand["commandId"].as<String>() &&
        bench["issuedAtMs"].is<int64_t>() && bench["issuedAtMs"].as<int64_t>() == controllerBenchCommand["issuedAtMs"].as<int64_t>() &&
        controllerBenchCommand["nodeId"].as<String>() == NODE_CREDENTIALS[index].nodeId &&
        (state == "pulse_finished" || state == "rejected" || state == "unknown")) {
      controllerBenchResult["commandId"] = bench["commandId"];
      controllerBenchResult["nodeId"] = NODE_CREDENTIALS[index].nodeId;
      controllerBenchResult["workstationId"] = NODE_CREDENTIALS[index].workstationId;
      controllerBenchResult["state"] = state;
      Serial.printf("[Bench] %s result: %s; forwarding to cloud.\n", NODE_CREDENTIALS[index].nodeId, state.c_str());
    }
    acknowledgeNode(index, address, port);
    if (!wasRecent) Serial.printf("[Nodes] %s / %s connected. Power: %s.\n", NODE_CREDENTIALS[index].nodeId, NODE_CREDENTIALS[index].workstationId, observation.power.c_str());
  }
}

static size_t addNodeObservations(JsonArray nodes, int64_t& oldestSampleMs) {
  const int64_t currentMs = static_cast<int64_t>(time(nullptr)) * 1000;
  oldestSampleMs = currentMs;
  size_t connected = 0;
  for (int i = 0; i < 5; ++i) {
    const NodeObservation& observation = nodeObservations[i];
    if (!observation.seen) continue; // Never fabricate unseen workstations.
    const bool fresh = nodeBridgeStarted && WiFi.status() == WL_CONNECTED && nodeRecent(observation);
    JsonObject node = nodes.add<JsonObject>();
    node["nodeId"] = NODE_CREDENTIALS[i].nodeId; node["workstationId"] = NODE_CREDENTIALS[i].workstationId;
    node["connectivity"] = fresh ? "connected" : "disconnected";
    node["power"] = fresh ? observation.power : String("unknown"); node["reachability"] = "unknown"; node["input"] = "unknown";
    if (fresh) { ++connected; oldestSampleMs = min(oldestSampleMs, observation.sampledAtMs); }
  }
  return connected;
}
