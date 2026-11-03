#pragma once
#include <Arduino.h>
#include <esp_timer.h>
#include <driver/gpio.h>

// GPIO23 -> 1k -> 2N2222A base; emitter -> GND; collector -> IN1.
// Add a 10k base/emitter pull-down. Confirmed module supply: 5V.
// HIGH activates the transistor and the module's active-LOW input.
// This USB bench test does not accept cloud power commands.
namespace RelayBench {
static const uint8_t PIN = 23;
static const uint32_t PULSE_MS = 300, COOLDOWN_MS = 3000, ARM_WINDOW_MS = 60000;
static esp_timer_handle_t timer = nullptr;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool active = false, ended = false, armed = false, expired = false;
static bool pending = false, ready = false, tested = false, inputOverflow = false;
static int64_t pulseDeadlineUs = 0, armDeadlineUs = 0;
static uint32_t lastTestAt = 0;
static char input[32];
static size_t inputLength = 0;

static void timerTick(void*) {
  // This task owns every HIGH transition. It also ends pulses while the main
  // loop is waiting on Wi-Fi/mDNS. OFF and this callback share the same lock.
  const int64_t now = esp_timer_get_time();
  portENTER_CRITICAL(&mux);
  if (armed && now >= armDeadlineUs) {
    armed = false; pending = false; expired = true;
  }
  if (!armed || (active && now >= pulseDeadlineUs)) {
    if (active) { gpio_set_level(static_cast<gpio_num_t>(PIN), 0); active = false; ended = true; }
    pending = false;
  } else if (pending && !active) {
    pending = false; active = true;
    pulseDeadlineUs = now + static_cast<int64_t>(PULSE_MS) * 1000;
    gpio_set_level(static_cast<gpio_num_t>(PIN), 1);
  }
  portEXIT_CRITICAL(&mux);
}

static void off() {
  portENTER_CRITICAL(&mux);
  armed = false; pending = false; active = false; ended = false; expired = false;
  gpio_set_level(static_cast<gpio_num_t>(PIN), 0);
  portEXIT_CRITICAL(&mux);
}

static void help() {
  Serial.println("[Relay] ComLab node relay bench test v1. GPIO23 via 2N2222A; HIGH = relay active.");
  Serial.println("[Relay] Keep relay COM/NO disconnected from the PC for this bench test.");
  Serial.println("[Relay] Commands: ARM (60-second window), TEST (one 300ms pulse), OFF (stop/disarm), STATUS, HELP.");
  Serial.println("[Relay] Select Newline or Both NL & CR in Serial Monitor. PC power remains unknown.");
}

static void begin() {
  digitalWrite(PIN, LOW);
  pinMode(PIN, OUTPUT);
  esp_timer_create_args_t config = {};
  config.callback = timerTick; config.dispatch_method = ESP_TIMER_TASK; config.name = "comlab-relay-test";
  if (esp_timer_create(&config, &timer) == ESP_OK && esp_timer_start_periodic(timer, 5000) == ESP_OK) ready = true;
  else Serial.println("[Relay] Automatic OFF timer unavailable. Relay testing disabled.");
  help();
}

static void command(String value) {
  value.trim(); value.toUpperCase();
  const uint32_t now = millis();
  if (value == "HELP") { help(); return; }
  if (value == "OFF") { off(); Serial.println("[Relay] OFF and disarmed."); return; }
  if (value == "STATUS") {
    Serial.printf("[Relay] GPIO23: %s; test: %s. PC power: unknown.\n", active ? "HIGH (pulse active)" : "LOW (off)", armed ? "armed" : "disarmed");
    return;
  }
  if (value == "ARM") {
    if (!ready) { Serial.println("[Relay] Cannot arm: automatic OFF timer unavailable."); return; }
    if (armed) { Serial.println("[Relay] Already armed. TEST for one pulse, or OFF to disarm."); return; }
    portENTER_CRITICAL(&mux);
    armDeadlineUs = esp_timer_get_time() + static_cast<int64_t>(ARM_WINDOW_MS) * 1000;
    expired = false; armed = true;
    portEXIT_CRITICAL(&mux);
    Serial.println("[Relay] Armed for 60 seconds. Send TEST for one 300ms pulse. PC must be disconnected from relay contacts.");
    return;
  }
  if (value == "TEST") {
    bool accepted = false;
    portENTER_CRITICAL(&mux);
    if (ready && armed && esp_timer_get_time() < armDeadlineUs && !active && !pending &&
        (!tested || now - lastTestAt >= COOLDOWN_MS)) {
      pending = true; tested = true; lastTestAt = now; accepted = true;
    }
    portEXIT_CRITICAL(&mux);
    if (accepted) Serial.println("[Relay] TEST: one 300ms pulse queued.");
    else Serial.println("[Relay] No pulse sent. Send ARM first and wait at least 3 seconds between tests.");
    return;
  }
  Serial.println("[Relay] Unknown command. Send HELP.");
}

static void poll() {
  bool completed, timedOut;
  portENTER_CRITICAL(&mux);
  completed = ended; ended = false; timedOut = expired; expired = false;
  portEXIT_CRITICAL(&mux);
  if (completed) Serial.println("[Relay] Pulse finished. GPIO23 LOW; relay OFF.");
  if (timedOut) Serial.println("[Relay] Test window expired. OFF and disarmed.");
  for (int count = 0; count < 64 && Serial.available(); ++count) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r' || c == '\n') {
      if (inputOverflow) Serial.println("[Relay] Command too long; ignored.");
      else if (inputLength) { input[inputLength] = 0; command(String(input)); }
      inputLength = 0; inputOverflow = false;
    } else if (c >= 32 && c <= 126) {
      if (!inputOverflow && inputLength < sizeof(input) - 1) input[inputLength++] = c;
      else inputOverflow = true;
    }
  }
}
}
