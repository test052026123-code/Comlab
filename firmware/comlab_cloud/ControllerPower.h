#pragma once
#include <sys/time.h>
#include "PowerBridge.h"

static PowerBridge::Engine controllerPower;
static PowerBridge::State powerSubmitted[5] = {};
static PowerBridge::Slot lastCompletedPower[5];
static int64_t controllerNowMs() {
  struct timeval now; gettimeofday(&now, nullptr);
  return static_cast<int64_t>(now.tv_sec) * 1000 + now.tv_usec / 1000;
}
static PowerBridge::Feedback powerFeedback(size_t index) {
  const NodeObservation& node = nodeObservations[index];
  if (!nodeBridgeStarted || WiFi.status() != WL_CONNECTED || !nodeRecent(node)) return PowerBridge::Unavailable;
  return node.power == "on" ? PowerBridge::On : node.power == "off" ? PowerBridge::Off : PowerBridge::Unavailable;
}
static bool powerBusy(size_t index) {
  const auto state = controllerPower.slots[index].state;
  return state == PowerBridge::Waiting || state == PowerBridge::Accepted || state == PowerBridge::Unknown;
}
static void stopBenchForPower(size_t index) {
  if (controllerBenchCommand.isNull() || !controllerBenchResult.isNull() ||
      controllerBenchCommand["nodeId"] != NODE_CREDENTIALS[index].nodeId) return;
  // A diagnostic could already have reached the node; never claim cancellation
  // proves no pulse. Stop further dispatch and report its uncertainty separately.
  controllerBenchResult["commandId"] = controllerBenchCommand["commandId"];
  controllerBenchResult["nodeId"] = NODE_CREDENTIALS[index].nodeId;
  controllerBenchResult["workstationId"] = NODE_CREDENTIALS[index].workstationId;
  controllerBenchResult["state"] = "unknown";
}
static void pollControllerPower() {
  for (size_t i = 0; i < 5; ++i) controllerPower.tick(i, controllerNowMs(), nodeObservations[i].bootId.c_str());
}
static void addPowerAcknowledgement(size_t index, JsonDocument& body) {
  body["powerSupported"] = true;
  const NodeObservation& node = nodeObservations[index];
  controllerPower.tick(index, controllerNowMs(), node.bootId.c_str());
  if (!controllerPower.dispatch(index, controllerNowMs(), node.powerReady,
      powerFeedback(index), node.bootId.c_str())) return;
  const auto& slot = controllerPower.slots[index];
  JsonObject command = body["powerCommand"].to<JsonObject>();
  command["commandId"] = slot.id; command["nodeId"] = NODE_CREDENTIALS[index].nodeId;
  command["workstationId"] = NODE_CREDENTIALS[index].workstationId; command["action"] = "power_on";
  command["issuedAtMs"] = slot.issued; command["expiresAtMs"] = slot.expires;
}
static void handlePowerNodeResult(size_t index, JsonObjectConst result) {
  if (result.isNull() || result.size() != 3 || !result["commandId"].is<const char*>() ||
      !result["issuedAtMs"].is<int64_t>()) return;
  const char* state = result["state"] | "";
  const auto parsed = strcmp(state, "accepted") == 0 ? PowerBridge::Accepted :
    strcmp(state, "confirmed_on") == 0 ? PowerBridge::ConfirmedOn :
    strcmp(state, "rejected") == 0 ? PowerBridge::Rejected :
    strcmp(state, "unknown") == 0 ? PowerBridge::Unknown : PowerBridge::Empty;
  controllerPower.result(index, result["commandId"].as<const char*>(),
    result["issuedAtMs"].as<int64_t>(), parsed, powerFeedback(index));
}
static bool controllerPowerCapable() {
  for (size_t i = 0; i < 5; ++i) {
    if (nodeObservations[i].powerReady && powerFeedback(i) != PowerBridge::Unavailable) return true;
  }
  return false;
}
static void addPowerResults(JsonArray results) {
  pollControllerPower();
  for (size_t i = 0; i < 5; ++i) {
    powerSubmitted[i] = PowerBridge::Empty;
    const auto& slot = controllerPower.slots[i];
    if (!slot.dirty || results.size() >= 5 ||
        (slot.state == PowerBridge::ConfirmedOn && powerFeedback(i) != PowerBridge::On)) continue;
    JsonObject result = results.add<JsonObject>();
    result["commandId"] = slot.id; result["nodeId"] = NODE_CREDENTIALS[i].nodeId;
    result["workstationId"] = NODE_CREDENTIALS[i].workstationId;
    result["action"] = "power_on"; result["state"] = PowerBridge::name(slot.state);
    result["detail"] = PowerBridge::detail(slot.reason);
    powerSubmitted[i] = slot.state;
  }
}
static void acknowledgePowerResults(JsonArrayConst acknowledgements) {
  for (const char* id : acknowledgements) {
    if (!id) continue;
    for (size_t i = 0; i < 5; ++i) {
      const auto& slot = controllerPower.slots[i];
      if (PowerBridge::terminal(slot.state) && slot.state == powerSubmitted[i] && strcmp(slot.id, id) == 0) {
        lastCompletedPower[i] = slot;
      }
      controllerPower.acknowledge(i, id, powerSubmitted[i]);
    }
  }
}
static bool acceptCloudPower(JsonObjectConst command) {
  if (command.size() != 5 || !command["commandId"].is<const char*>() ||
      command["action"] != "power_on" || !command["expiresAt"].is<const char*>()) return false;
  const char* id = command["commandId"].as<const char*>();
  if (!PowerBridge::uuid(id)) return false;
  const int64_t expires = PowerBridge::expiry(command["expiresAt"].as<const char*>());
  if (!expires) return false;
  for (size_t i = 0; i < 5; ++i) {
    if (command["nodeId"] == NODE_CREDENTIALS[i].nodeId && command["workstationId"] == NODE_CREDENTIALS[i].workstationId) {
      const bool accepted = controllerPower.assign(i, id, expires, controllerNowMs(), nodeObservations[i].powerReady,
        powerFeedback(i), nodeObservations[i].bootId.c_str());
      if (accepted) stopBenchForPower(i);
      return accepted;
    }
  }
  return false;
}
static void printControllerPowerStatus() {
  Serial.println("[Power bridge] Guarded power-on bridge v1; reset unsupported.");
  for (size_t i = 0; i < 5; ++i) {
    const bool active = controllerPower.slots[i].state != PowerBridge::Empty;
    const auto& slot = active ? controllerPower.slots[i] : lastCompletedPower[i];
    Serial.printf("[Power bridge] %s: connected=%s, executor=%s, power=%s, command=%s, state=%s, record=%s.\n",
      NODE_CREDENTIALS[i].nodeId, nodeBridgeStarted && WiFi.status() == WL_CONNECTED && nodeRecent(nodeObservations[i]) ? "yes" : "no",
      nodeObservations[i].powerReady ? "ready" : "unavailable", nodeObservations[i].power.c_str(),
      slot.state == PowerBridge::Empty ? "none" : slot.id,
      slot.state == PowerBridge::Empty ? "none" : PowerBridge::name(slot.state), active ? "active" : "last completed");
    if (slot.state != PowerBridge::Empty) Serial.printf("[Power bridge] Reason: %s\n", PowerBridge::detail(slot.reason));
  }
}
