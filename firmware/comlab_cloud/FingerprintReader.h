#pragma once
#include <Adafruit_Fingerprint.h>

// AS608 TX -> ESP32 GPIO16 (RX), AS608 RX -> GPIO17 (TX).
// One request at a time from the cloud: a check-in scan, or an admin
// enrollment into the slot the server chose (two presses of the same finger).
static HardwareSerial fingerprintSerial(2);
static Adafruit_Fingerprint fingerprintSensor(&fingerprintSerial);
static bool fingerprintReady = false, fingerprintNeedsLift = true, fingerprintEnroll = false;
static bool fingerprintSyncNow = false;  // Ask the main loop to sync immediately.
static String fingerprintRequestId, fingerprintResultId, fingerprintState;
static int fingerprintSlot = -1, fingerprintTargetSlot = -1, fingerprintStep = 0;
static time_t fingerprintDeadline = 0;
static uint32_t nextFingerprintMs = 0;
static const char* const FINGERPRINT_STEPS[] = {"place_first", "lift", "place_second"};

static void beginFingerprintReader() {
  fingerprintSensor.begin(57600);
  fingerprintSerial.begin(57600, SERIAL_8N1, 16, 17);
}

static void finishFingerprint(const char* state, int slot = -1) {
  fingerprintResultId = fingerprintRequestId;
  fingerprintState = state;
  fingerprintSlot = slot;
  fingerprintRequestId.clear();
  fingerprintSyncNow = true;
  Serial.printf("[Fingerprint] %s completed: %s.\n", fingerprintEnroll ? "Enrollment" : "Scan", state);
}

static void setEnrollStep(int step) {
  fingerprintStep = step;
  fingerprintSyncNow = true;
  Serial.println(step == 1 ? "[Fingerprint] Remove your finger." : "[Fingerprint] Place the SAME finger again.");
}

static void pollEnrollment() {
  const uint8_t status = fingerprintSensor.getImage();
  if (fingerprintStep == 1) {  // Waiting for the finger to be lifted.
    if (status == FINGERPRINT_NOFINGER) setEnrollStep(2);
    else if (status != FINGERPRINT_OK) finishFingerprint("error");
    return;
  }
  if (status == FINGERPRINT_NOFINGER) { fingerprintNeedsLift = false; return; }
  if (status != FINGERPRINT_OK) { finishFingerprint("error"); return; }
  if (fingerprintNeedsLift) return;
  if (fingerprintStep == 0) {
    if (fingerprintSensor.image2Tz(1) != FINGERPRINT_OK) { finishFingerprint("error"); return; }
    // Refuse a finger that is already stored in another slot.
    const uint8_t match = fingerprintSensor.fingerSearch(1);
    if (match == FINGERPRINT_OK && fingerprintSensor.fingerID != fingerprintTargetSlot) {
      finishFingerprint("duplicate", fingerprintSensor.fingerID);
      return;
    }
    if (match != FINGERPRINT_OK && match != FINGERPRINT_NOTFOUND) { finishFingerprint("error"); return; }
    setEnrollStep(1);
    return;
  }
  if (fingerprintSensor.image2Tz(2) != FINGERPRINT_OK) { finishFingerprint("error"); return; }
  if (fingerprintSensor.createModel() != FINGERPRINT_OK) { finishFingerprint("mismatch"); return; }
  if (fingerprintSensor.storeModel(fingerprintTargetSlot) != FINGERPRINT_OK) { finishFingerprint("error"); return; }
  finishFingerprint("enrolled", fingerprintTargetSlot);
}

static void pollFingerprintReader() {
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextFingerprintMs) < 0) return;
  nextFingerprintMs = now + 100;
  if (!fingerprintReady) {
    fingerprintReady = fingerprintSensor.verifyPassword() && fingerprintSensor.getParameters() == FINGERPRINT_OK;
    nextFingerprintMs = millis() + 5000;
    if (fingerprintReady) Serial.printf("[Fingerprint] AS608 ready on GPIO16/GPIO17. Capacity %u. Remote enrollment supported.\n", fingerprintSensor.capacity);
    return;
  }
  if (fingerprintRequestId.isEmpty()) return;
  if (time(nullptr) >= fingerprintDeadline) { fingerprintRequestId.clear(); return; }
  if (fingerprintEnroll) { pollEnrollment(); return; }
  const uint8_t status = fingerprintSensor.getImage();
  if (status == FINGERPRINT_NOFINGER) { fingerprintNeedsLift = false; return; }
  if (status != FINGERPRINT_OK) { finishFingerprint("error"); return; }
  if (fingerprintNeedsLift) return;
  if (fingerprintSensor.image2Tz() != FINGERPRINT_OK) { finishFingerprint("error"); return; }
  const uint8_t match = fingerprintSensor.fingerSearch();
  if (match == FINGERPRINT_OK) finishFingerprint("matched", fingerprintSensor.fingerID);
  else if (match == FINGERPRINT_NOTFOUND) finishFingerprint("no_match");
  else finishFingerprint("error");
}

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
    fingerprintRequestId = id;
    fingerprintDeadline = deadline;
    fingerprintNeedsLift = true;
    fingerprintEnroll = enroll;
    fingerprintTargetSlot = enroll ? slot : -1;
    fingerprintStep = 0;
    if (!fingerprintReady) finishFingerprint("error");
    else if (enroll) Serial.printf("[Fingerprint] Enrollment requested for slot %d. Lift your finger, then place it on the sensor.\n", slot);
    else Serial.println("[Fingerprint] Scan requested. Lift your finger, then place it on the sensor.");
  }
}
