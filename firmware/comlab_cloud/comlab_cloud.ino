/*
 * ComLab ESP32-WROOM DevKit V1 - outbound cloud + signed node discovery.
 * Arduino ESP32 core 3.3.7; ArduinoJson 7.
 * Routes guarded power-on commands and separate signed relay bench tests.
 * HTTPS validates hostname and the SDK's public CA certificate bundle.
 */
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_http_client.h>
#include <esp_crt_bundle.h>
#include <esp_system.h>
#include <time.h>
#include "NodeReceiver.h"
#include "FingerprintReader.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

#include "CloudTransport.h"

static const char* FIRMWARE_VERSION = "comlab-cloud-link-13";
static const uint32_t SYNC_INTERVAL_MS = 1000;
static const uint32_t MAX_BACKOFF_MS = 3000;
static String bootId, pendingPayload;
static uint32_t sequence = 1, nextSyncMs = 0, nextWifiMs = 0, backoffMs = SYNC_INTERVAL_MS;
static bool configured = false;
static JsonDocument resultOutbox;
static size_t reportedNodeCount = 0;

static bool cloudBusy = false;

static String newBootId() {
  uint8_t bytes[16]; esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  char value[37];
  snprintf(value, sizeof(value), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
  return String(value);
}

static String utcAt(time_t epoch) {
  struct tm utc; gmtime_r(&epoch, &utc);
  char value[25]; strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &utc);
  return String(value);
}

static bool containsResult(const String& commandId) {
  for (JsonObjectConst result : resultOutbox.as<JsonArrayConst>()) {
    if (commandId == result["commandId"].as<String>()) return true;
  }
  return false;
}

static void handleCloudPowerCommands(JsonArrayConst commands) {
  for (JsonObjectConst command : commands) {
    String id = command["commandId"] | "";
    if (id.length() != 36 || strcmp(command["action"] | "", "power_on") != 0 || containsResult(id)) continue;
    if (acceptCloudPower(command) || controllerPower.owns(id.c_str())) continue;
    if (resultOutbox.size() >= 10) break;
    JsonObject result = resultOutbox.as<JsonArray>().add<JsonObject>();
    result["commandId"] = id;
    result["workstationId"] = command["workstationId"];
    result["nodeId"] = command["nodeId"];
    result["action"] = "power_on";
    result["state"] = "rejected";
    result["detail"] = "Target node is unmapped or has another unresolved power command";
  }
}

static void buildPayload() {
  JsonDocument body;
  body["protocolVersion"] = 1; body["bootId"] = bootId;
  body["sequence"] = sequence;
  body["uptimeMs"] = millis(); body["firmwareVersion"] = FIRMWARE_VERSION;
  JsonArray capabilities = body["capabilities"].to<JsonArray>();
  if (controllerPowerCapable()) capabilities.add("power_on");
  addFingerprintResult(body);
  addControllerBench(body);
  int64_t oldestSampleMs;
  JsonArray nodes = body["nodes"].to<JsonArray>();
  addNodeObservations(nodes, oldestSampleMs);
  reportedNodeCount = nodes.size();
  // Preserve the oldest live observation, rather than making cached data fresh.
  body["sampledAt"] = utcAt(static_cast<time_t>(oldestSampleMs / 1000));
  JsonArray results = body["results"].to<JsonArray>();
  addPowerResults(results);
  for (JsonObjectConst result : resultOutbox.as<JsonArrayConst>()) {
    if (results.size() >= 5) break;
    results.add(result);
  }
  serializeJson(body, pendingPayload);
}

static bool finishCloudSync(const CloudExchange& exchange) {
  const esp_err_t error = exchange.error;
  const int status = exchange.status;
  const ResponseBuffer& response = exchange.response;
  if (error != ESP_OK || status != 200 || response.tooLarge) {
    Serial.printf("[Cloud diagnostic] error=%s; socket=%d; tls=%ld; tlsCode=%d; tlsFlags=%d; durationMs=%lu; rssi=%d; heapBefore=%lu.\n",
      esp_err_to_name(error), exchange.socketError, static_cast<long>(exchange.tlsError),
      exchange.tlsCode, exchange.tlsFlags, static_cast<unsigned long>(exchange.elapsedMs),
      exchange.rssi, static_cast<unsigned long>(exchange.heapBefore));
    // The original request may have been uncommitted or committed with a lost
    // response. A higher sequence with fresh telemetry is safe in either case;
    // it preserves command IDs/results and never refreshes a command's expiry.
    if (error == ESP_OK && status == 409 && !response.tooLarge) {
      JsonDocument failure;
      if (!deserializeJson(failure, response.text) &&
          failure["error"] == "Startup confirmation requires fresh matching power feedback.") {
        ++sequence; pendingPayload.clear();
        Serial.println("[Cloud] Startup feedback aged during transport; refreshing telemetry without repeating a pulse.");
        return false;
      }
    }
    // The API accepts monotonic (not necessarily consecutive) sequence numbers.
    // If the response was lost, a replay would return its cached response without
    // refreshing receivedAt or node samples. Build a new telemetry envelope using
    // genuinely recent authenticated observations, retaining every command UUID,
    // original expiry and unacknowledged result. Node journals prevent re-pulsing.
    ++sequence; pendingPayload.clear();
    Serial.printf("[Cloud] Sync unavailable (HTTP %d); refreshing telemetry sequence, preserving command identities and expiry.\n", status);
    return false;
  }
  JsonDocument body;
  if (deserializeJson(body, response.text) || body["protocolVersion"] != 1 ||
      body["controllerId"].as<String>() != COMLAB_CONTROLLER_ID || body["bootId"].as<String>() != bootId ||
      body["ackSequence"].as<uint32_t>() != sequence || !body["commands"].is<JsonArray>() || !body["acknowledgedResults"].is<JsonArray>()) {
    ++sequence; pendingPayload.clear();
    Serial.println("[Cloud] Invalid acknowledgement; retaining command results and refreshing telemetry.");
    return false;
  }
  JsonArray outbox = resultOutbox.as<JsonArray>();
  acknowledgePowerResults(body["acknowledgedResults"].as<JsonArrayConst>());
  for (const char* id : body["acknowledgedResults"].as<JsonArrayConst>()) {
    for (int i = static_cast<int>(outbox.size()) - 1; i >= 0; --i) {
      if (String(id) == outbox[i]["commandId"].as<String>()) outbox.remove(i);
    }
  }
  // Drain heartbeats accumulated during the blocking HTTPS exchange before
  // evaluating a newly delivered command. Each packet retains its real timestamp.
  for (int drain = 0; drain < 3; ++drain) pollNodeHeartbeats();
  handleCloudPowerCommands(body["commands"].as<JsonArrayConst>());
  handleFingerprintResponse(body);
  handleControllerBench(body);
  ++sequence; pendingPayload.clear();
  Serial.printf("[Cloud] Authenticated HTTPS sync acknowledged; %u nodes; HTTP %lu ms; client=%s. Guarded power-on bridge v1.\n",
    static_cast<unsigned>(reportedNodeCount), static_cast<unsigned long>(exchange.elapsedMs), exchange.clientReused ? "reused" : "new");
  return true;
}

static void pollCloudSync() {
  CloudExchange* reply = nullptr;
  if (xQueueReceive(cloudReplies, &reply, 0) == pdTRUE && reply) {
    cloudBusy = false;
    const bool ok = finishCloudSync(*reply);
    delete reply;
    backoffMs = ok ? SYNC_INTERVAL_MS : min(backoffMs * 2, MAX_BACKOFF_MS);
    if (!fingerprintRequestId.isEmpty() || !fingerprintResultId.isEmpty()) backoffMs = min(backoffMs, static_cast<uint32_t>(2000));
    nextSyncMs = millis() + backoffMs + (esp_random() % 250);
  }
  if (cloudBusy || WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000) return;
  if (fingerprintSyncNow) nextSyncMs = millis();
  if (static_cast<int32_t>(millis() - nextSyncMs) < 0) return;
  if (pendingPayload.isEmpty()) buildPayload();
  CloudExchange* exchange = new (std::nothrow) CloudExchange;
  if (!exchange) { nextSyncMs = millis() + 1000; return; }
  exchange->payload = pendingPayload;
  if (exchange->payload.length() != pendingPayload.length() ||
      xQueueSend(cloudJobs, &exchange, 0) != pdTRUE) {
    delete exchange; nextSyncMs = millis() + 1000; return;
  }
  cloudBusy = true;
  fingerprintSyncNow = false;
}

static void printNetworkStatus() {
  Serial.printf("[Network] Firmware=%s; wifi=%d; ssid=%s; ip=%s; gateway=%s; dns=%s; rssi=%d; heap=%lu; minHeap=%lu; busy=%s; sequence=%lu; epoch=%lld.\n",
    FIRMWARE_VERSION, static_cast<int>(WiFi.status()), WiFi.SSID().c_str(),
    WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str(),
    WiFi.RSSI(), static_cast<unsigned long>(ESP.getFreeHeap()), static_cast<unsigned long>(ESP.getMinFreeHeap()),
    cloudBusy ? "yes" : "no", static_cast<unsigned long>(sequence), static_cast<long long>(time(nullptr)));
}

void setup() {
  Serial.begin(115200);
  delay(200);
  resultOutbox.to<JsonArray>();
  const String origin = COMLAB_API_ORIGIN;
  const String key = COMLAB_DEVICE_KEY;
  configured = strlen(COMLAB_WIFI_SSID) > 0 && key.length() == 64 && origin.startsWith("https://") &&
    origin.length() > 8 && origin.indexOf('/', 8) < 0 && origin.indexOf('?') < 0 && origin.indexOf('#') < 0 && origin.indexOf('@') < 0;
  if (!configured) {
    Serial.println("Configure the ignored secrets.h with the real Render HTTPS origin, Wi-Fi, controller ID and device key. No connection attempted.");
    return;
  }
  if (!beginCloudTransport()) {
    configured = false;
    Serial.println("[Cloud] HTTPS worker unavailable; controller disabled.");
    return;
  }
  bootId = newBootId();
  beginFingerprintReader();
  WiFi.mode(WIFI_STA); WiFi.setHostname("comlab-controller"); WiFi.setAutoReconnect(true);
  WiFi.begin(COMLAB_WIFI_SSID, COMLAB_WIFI_PASSWORD);
  WiFi.setSleep(false);
  nextWifiMs = millis() + 10000;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("[Cloud] Async HTTPS worker v1; scanner polling continues during transport.");
  Serial.println("[Cloud] Fresh telemetry retry v1; failed exchanges cannot pin workstation status to an old sample.");
  Serial.println("[Cloud] Network diagnostics v1: NETSTATUS and detailed transport errors; no credentials printed.");
  Serial.println("[Cloud] Persistent HTTPS v1; healthy connections reused, fresh status every second after completion.");
  Serial.println("ComLab outbound HTTPS + authenticated node discovery. Waiting for Wi-Fi and synchronized time.");
  Serial.println("[Power bridge] Guarded power-on bridge v1. Updated node and real power sensing required; reset unsupported.");
  Serial.printf("[Power bridge] Firmware: %s; freshness-aware dispatch enabled.\n", FIRMWARE_VERSION);
}

void loop() {
  if (!configured) { delay(100); return; }
  pollBenchDiagnostics();
  pollNodeHeartbeats();
  pollControllerPower();
  pollFingerprintReader();
  pollCloudSync();
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (static_cast<int32_t>(now - nextWifiMs) >= 0) { WiFi.reconnect(); nextWifiMs = now + 10000; }
    delay(10); return;
  }
  // Certificate verification is never bypassed, including before the clock syncs.
  if (time(nullptr) < 1700000000) { delay(20); return; }
  delay(2);
}
