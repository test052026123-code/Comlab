#pragma once
// PC power sensing through a 1-channel EL817/PC817 module.
// Input side: SATA +5V (red) -> IN+, SATA GND (black) -> IN-.
// Output side: collector -> GPIO27, emitter -> ESP32 GND.
// SATA +5V is live only while the PC is running, so LOW on GPIO27 = PC on.
// Disabled unless secrets.h defines COMLAB_NODE_POWER_SENSE 1: an unwired
// pull-up input reads HIGH and would otherwise falsely report "off".
#include <Arduino.h>

#ifndef COMLAB_NODE_POWER_SENSE
#define COMLAB_NODE_POWER_SENSE 0
#endif

namespace PowerSense {
constexpr uint8_t PIN = 27;
constexpr uint32_t STABLE_MS = 300;
static int stableLevel = -1, lastLevel = -1;
static uint32_t changedMs = 0;

static void begin() {
  if (!COMLAB_NODE_POWER_SENSE) return;
  pinMode(PIN, INPUT_PULLUP);
  lastLevel = digitalRead(PIN); changedMs = millis();
}

static void poll() {
  if (!COMLAB_NODE_POWER_SENSE) return;
  const int level = digitalRead(PIN);
  if (level != lastLevel) { lastLevel = level; changedMs = millis(); return; }
  if (level != stableLevel && millis() - changedMs >= STABLE_MS) {
    stableLevel = level;
    Serial.printf("[Power] PC is %s (GPIO27 %s).\n", level == LOW ? "ON" : "OFF", level == LOW ? "LOW" : "HIGH");
  }
}

static const char* state() {
  if (!COMLAB_NODE_POWER_SENSE || stableLevel < 0) return "unknown";
  return stableLevel == LOW ? "on" : "off";
}
}  // namespace PowerSense
