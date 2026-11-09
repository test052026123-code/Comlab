/*
 * ComLab ESP32-WROOM DevKit V1 - outbound cloud + signed node discovery.
 * Arduino ESP32 core 3.3.7; ArduinoJson 7.
 * Routes signed relay bench tests; no PC power commands or fabricated nodes.
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

static const char* FIRMWARE_VERSION = "comlab-cloud-enroll-5";
static const uint32_t SYNC_INTERVAL_MS = 5000;
static const uint32_t MAX_BACKOFF_MS = 30000;
static String bootId, pendingPayload;
static uint32_t sequence = 1, nextSyncMs = 0, nextWifiMs = 0, backoffMs = SYNC_INTERVAL_MS;
static bool configured = false;
static JsonDocument resultOutbox;
static size_t reportedNodeCount = 0;

struct ResponseBuffer { String text; bool tooLarge = false; };

static esp_err_t receiveResponse(esp_http_client_event_t* event) {
  if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) return ESP_OK;
  auto* buffer = static_cast<ResponseBuffer*>(event->user_data);
  if (buffer->text.length() + event->data_len > 8192) { buffer->tooLarge = true; return ESP_FAIL; }
  buffer->text.concat(static_cast<const char*>(event->data), event->data_len);
  return ESP_OK;
}

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

static void rejectCommands(JsonArrayConst commands) {
  for (JsonObjectConst command : commands) {
    String id = command["commandId"] | "";
    if (id.length() != 36 || strcmp(command["action"] | "", "power_on") != 0 || containsResult(id)) continue;
    if (resultOutbox.size() >= 10) break;
    JsonObject result = resultOutbox.as<JsonArray>().add<JsonObject>();
    result["commandId"] = id;
    result["workstationId"] = command["workstationId"];
    result["nodeId"] = command["nodeId"];
    result["action"] = "power_on";
    result["state"] = "rejected";
    result["detail"] = "Connection-test firmware: power control is not enabled";
  }
}

static void buildPayload() {
  JsonDocument body;
  body["protocolVersion"] = 1; body["bootId"] = bootId;
  body["sequence"] = sequence;
  body["uptimeMs"] = millis(); body["firmwareVersion"] = FIRMWARE_VERSION;
  body["capabilities"].to<JsonArray>();
  addFingerprintResult(body);
  addControllerBench(body);
  int64_t oldestSampleMs;
  JsonArray nodes = body["nodes"].to<JsonArray>();
  addNodeObservations(nodes, oldestSampleMs);
  reportedNodeCount = nodes.size();
  // Preserve the oldest live observation, rather than making cached data fresh.
  body["sampledAt"] = utcAt(static_cast<time_t>(oldestSampleMs / 1000));
  JsonArray results = body["results"].to<JsonArray>();
  for (JsonObjectConst result : resultOutbox.as<JsonArrayConst>()) {
    if (results.size() >= 5) break;
    results.add(result);
  }
  serializeJson(body, pendingPayload);
}

static bool syncWithCloud() {
  if (pendingPayload.isEmpty()) buildPayload();
  const String endpoint = String(COMLAB_API_ORIGIN) + "/v1/controller/sync";
  ResponseBuffer response; response.text.reserve(2048);
  esp_http_client_config_t config = {};
  config.url = endpoint.c_str();
  config.transport_type = HTTP_TRANSPORT_OVER_SSL;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.disable_auto_redirect = true;
  config.skip_cert_common_name_check = false;
  config.timeout_ms = 8000;
  config.event_handler = receiveResponse;
  config.user_data = &response;
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (!client) return false;
  const String authorization = String("Bearer ") + COMLAB_DEVICE_KEY;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Authorization", authorization.c_str());
  esp_http_client_set_header(client, "X-ComLab-Controller-Id", COMLAB_CONTROLLER_ID);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "Accept-Encoding", "identity");
  esp_http_client_set_post_field(client, pendingPayload.c_str(), pendingPayload.length());
  const esp_err_t error = esp_http_client_perform(client);
  const int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (error != ESP_OK || status != 200 || response.tooLarge) {
    Serial.printf("[Cloud] Sync unavailable (HTTP %d); retrying without changing the request ID.\n", status);
    return false;
  }
  JsonDocument body;
  if (deserializeJson(body, response.text) || body["protocolVersion"] != 1 ||
      body["controllerId"].as<String>() != COMLAB_CONTROLLER_ID || body["bootId"].as<String>() != bootId ||
      body["ackSequence"].as<uint32_t>() != sequence || !body["commands"].is<JsonArray>() || !body["acknowledgedResults"].is<JsonArray>()) {
    Serial.println("[Cloud] Invalid acknowledgement; preserving the pending request.");
    return false;
  }
  JsonArray outbox = resultOutbox.as<JsonArray>();
  for (const char* id : body["acknowledgedResults"].as<JsonArrayConst>()) {
    for (int i = static_cast<int>(outbox.size()) - 1; i >= 0; --i) {
      if (String(id) == outbox[i]["commandId"].as<String>()) outbox.remove(i);
    }
  }
  rejectCommands(body["commands"].as<JsonArrayConst>());
  handleFingerprintResponse(body);
  handleControllerBench(body);
  ++sequence; pendingPayload.clear();
  Serial.printf("[Cloud] Authenticated HTTPS sync acknowledged; %u observed workstation nodes reported. Power control disabled.\n", static_cast<unsigned>(reportedNodeCount));
  return true;
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
  bootId = newBootId();
  beginFingerprintReader();
  WiFi.mode(WIFI_STA); WiFi.setHostname("comlab-controller"); WiFi.setAutoReconnect(true);
  WiFi.begin(COMLAB_WIFI_SSID, COMLAB_WIFI_PASSWORD);
  nextWifiMs = millis() + 10000;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("ComLab outbound HTTPS + authenticated node discovery. Waiting for Wi-Fi and synchronized time.");
}

void loop() {
  if (!configured) { delay(100); return; }
  pollBenchDiagnostics();
  pollNodeHeartbeats();
  pollFingerprintReader();
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (static_cast<int32_t>(now - nextWifiMs) >= 0) { WiFi.reconnect(); nextWifiMs = now + 10000; }
    delay(10); return;
  }
  // Certificate verification is never bypassed, including before the clock syncs.
  if (time(nullptr) < 1700000000) { delay(20); return; }
  // Enrollment steps and results sync immediately so the admin screen keeps up.
  if (fingerprintSyncNow) { fingerprintSyncNow = false; nextSyncMs = now; }
  if (static_cast<int32_t>(now - nextSyncMs) >= 0) {
    pollNodeHeartbeats();
    if (syncWithCloud()) backoffMs = SYNC_INTERVAL_MS;
    else backoffMs = min(backoffMs * 2, MAX_BACKOFF_MS);
    nextSyncMs = millis() + backoffMs + (esp_random() % 250);
  }
  delay(2);
}
