#pragma once
#include "FingerprintCapture.h"

static void addFingerprintResult(JsonDocument& body) {
  if (fingerprintReady && fingerprintSensor.capacity > 0 && fingerprintSensor.capacity <= 1000) {
    body["fingerprintCapacity"] = fingerprintSensor.capacity;
  }
  if (fingerprintEnroll && !fingerprintRequestId.isEmpty()) {
    JsonObject progress = body["fingerprintProgress"].to<JsonObject>();
    progress["requestId"] = fingerprintRequestId;
    progress["step"] = FINGERPRINT_STEPS[fingerprintStep];
  }
  if (fingerprintResultId.isEmpty()) return;
  JsonObject result = body["fingerprintResult"].to<JsonObject>();
  result["requestId"] = fingerprintResultId;
  result["state"] = fingerprintState;
  if (fingerprintSlot < 0) result["slot"] = nullptr;
  else result["slot"] = fingerprintSlot;
}

static void handleFingerprintResponse(JsonDocument& body) {
  if (!fingerprintResultId.isEmpty() && body["acknowledgedFingerprint"].as<String>() == fingerprintResultId) {
    fingerprintResultId.clear();
  }
  JsonObjectConst request = body["fingerprintRequest"].as<JsonObjectConst>();
  if (request.isNull()) { fingerprintRequestId.clear(); return; }
  const String id = request["requestId"] | "";
  const String expiry = request["expiresAt"] | "";
  if (id.length() != 36 || expiry.length() != 24 || !fingerprintResultId.isEmpty()) return;
  const bool enroll = request["mode"] == "enroll";
  const int slot = request["slot"] | -1;
  if (enroll && (slot < 0 || slot > 999 || (fingerprintReady && slot >= fingerprintSensor.capacity))) return;
  struct tm utc = {};
  if (!strptime(expiry.c_str(), "%Y-%m-%dT%H:%M:%S", &utc)) return;
  // configTime uses UTC, so mktime interprets the parsed UTC fields correctly.
  const time_t deadline = mktime(&utc);
  if (deadline <= time(nullptr) || deadline > time(nullptr) + 95) return;
  if (id != fingerprintRequestId) {
    startFingerprintCapture(id, deadline, enroll, slot);
    if (!fingerprintReady) finishFingerprint("error");
    else if (enroll) Serial.printf("[Fingerprint] Enrollment requested for slot %d. Place your finger on the sensor.\n", slot);
    else Serial.println("[Fingerprint] Scan requested. Place your finger on the sensor.");
  }
}
