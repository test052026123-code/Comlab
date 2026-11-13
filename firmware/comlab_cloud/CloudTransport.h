#pragma once
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <new>

// Ownership crosses one-slot queues. The HTTP task touches only its exchange;
// scanner, JSON protocol state, UUIDs and node observations stay on loop().
struct ResponseBuffer { String text; bool tooLarge = false; };
struct CloudExchange {
  String payload;
  ResponseBuffer response;
  esp_err_t error = ESP_FAIL;
  int status = 0;
  int socketError = 0, tlsCode = 0, tlsFlags = 0, rssi = 0;
  esp_err_t tlsError = ESP_OK;
  uint32_t elapsedMs = 0, heapBefore = 0;
  bool clientReused = false;
};
static QueueHandle_t cloudJobs = nullptr, cloudReplies = nullptr;
// Owned exclusively by the HTTP worker. Keep TLS alive across healthy requests.
static esp_http_client_handle_t cloudClient = nullptr;
static esp_err_t receiveResponse(esp_http_client_event_t* event) {
  if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) return ESP_OK;
  if (!event->user_data) return ESP_FAIL;
  auto* buffer = static_cast<ResponseBuffer*>(event->user_data);
  if (buffer->text.length() + event->data_len > 8192) { buffer->tooLarge = true; return ESP_FAIL; }
  if (!buffer->text.concat(static_cast<const char*>(event->data), event->data_len)) {
    buffer->tooLarge = true; return ESP_FAIL;
  }
  return ESP_OK;
}
static void performCloudTransport(CloudExchange& exchange) {
  const uint32_t started = millis();
  exchange.heapBefore = ESP.getFreeHeap();
  exchange.rssi = WiFi.RSSI();
  const String endpoint = String(COMLAB_API_ORIGIN) + "/v1/controller/sync";
  ResponseBuffer& response = exchange.response; response.text.reserve(2048);
  exchange.clientReused = cloudClient != nullptr;
  if (!cloudClient) {
    esp_http_client_config_t config = {};
    config.url = endpoint.c_str();
    config.transport_type = HTTP_TRANSPORT_OVER_SSL;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.disable_auto_redirect = true;
    config.skip_cert_common_name_check = false;
    config.timeout_ms = 15000;
    config.keep_alive_enable = true;
    config.keep_alive_idle = 5;
    config.keep_alive_interval = 5;
    config.keep_alive_count = 3;
    config.event_handler = receiveResponse;
    cloudClient = esp_http_client_init(&config);
  }
  esp_http_client_handle_t client = cloudClient;
  if (!client) return;
  esp_http_client_set_user_data(client, &response);
  const String authorization = String("Bearer ") + COMLAB_DEVICE_KEY;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Authorization", authorization.c_str());
  esp_http_client_set_header(client, "X-ComLab-Controller-Id", COMLAB_CONTROLLER_ID);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_header(client, "Accept-Encoding", "identity");
  esp_http_client_set_header(client, "Connection", "keep-alive");
  esp_http_client_set_post_field(client, exchange.payload.c_str(), exchange.payload.length());
  exchange.error = esp_http_client_perform(client);
  exchange.status = esp_http_client_get_status_code(client);
  exchange.socketError = esp_http_client_get_errno(client);
  exchange.tlsError = esp_http_client_get_and_clear_last_tls_error(client, &exchange.tlsCode, &exchange.tlsFlags);
  exchange.elapsedMs = millis() - started;
  // Detach exchange-owned buffers before the main loop can delete the reply.
  esp_http_client_set_post_field(client, nullptr, 0);
  esp_http_client_set_user_data(client, nullptr);
  if (exchange.error != ESP_OK || response.tooLarge) {
    esp_http_client_cleanup(client);
    cloudClient = nullptr;
  }
}
static void cloudTransportTask(void*) {
  for (;;) {
    CloudExchange* exchange = nullptr;
    if (xQueueReceive(cloudJobs, &exchange, portMAX_DELAY) == pdTRUE && exchange) {
      performCloudTransport(*exchange);
      xQueueSend(cloudReplies, &exchange, portMAX_DELAY);
    }
  }
}
static bool beginCloudTransport() {
  cloudJobs = xQueueCreate(1, sizeof(CloudExchange*));
  cloudReplies = xQueueCreate(1, sizeof(CloudExchange*));
  if (!cloudJobs || !cloudReplies) return false;
  return xTaskCreate(cloudTransportTask, "comlab-https", 12288, nullptr, 1, nullptr) == pdPASS;
}
