/* Standalone AS608 bench test for ESP32-WROOM DevKit V1.
 * Sensor TX -> GPIO16, RX -> GPIO17, GND -> GND.
 * Power the sensor according to its verified module specification.
 * Library: Adafruit Fingerprint Sensor Library.
 * No Wi-Fi, enrollment, deletion, or sensor configuration writes.
 * Uploading this sketch replaces the running controller firmware.
 */
#include <Adafruit_Fingerprint.h>

static constexpr int SENSOR_RX = 16;
static constexpr int SENSOR_TX = 17;
static constexpr uint32_t SENSOR_BAUD = 57600;
static HardwareSerial sensorSerial(2);
static Adafruit_Fingerprint sensor(&sensorSerial);
static bool ready = false;
static bool waitingForRemoval = false;
static uint32_t nextProbeMs = 0;

static void showError(const char* operation, uint8_t code) {
  Serial.printf("[AS608] %s failed (0x%02X).\n", operation, code);
}

static void probeSensor() {
  if (!sensor.verifyPassword()) {
    Serial.println("[AS608] No valid password acknowledgement at 57600 baud.");
    Serial.println("Check TX->GPIO16, RX->GPIO17, common GND and sensor power.");
    Serial.println("A changed sensor password or baud rate can also cause this. Retrying in 5 seconds.");
    return;
  }
  Serial.println("[AS608] PASS: sensor communication verified.");
  uint8_t status = sensor.getParameters();
  if (status != FINGERPRINT_OK) {
    showError("Read parameters", status);
    return;
  }
  Serial.printf("[AS608] Capacity: %u fingerprint slots.\n", sensor.capacity);
  status = sensor.getTemplateCount();
  if (status != FINGERPRINT_OK) {
    showError("Read template count", status);
    return;
  }
  Serial.printf("[AS608] Stored fingerprints: %u.\n", sensor.templateCount);
  Serial.println("Place a finger on the scanner. No fingerprints will be saved or deleted.");
  ready = true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nAS608 standalone test: sensor TX->16, RX->17; monitor 115200 baud.");
  sensor.begin(SENSOR_BAUD);
  // Explicitly set ESP32 UART pins after the library initializes the port.
  sensorSerial.begin(SENSOR_BAUD, SERIAL_8N1, SENSOR_RX, SENSOR_TX);
  delay(200);
}

void loop() {
  if (!ready) {
    if (static_cast<int32_t>(millis() - nextProbeMs) >= 0) {
      probeSensor();
      nextProbeMs = millis() + 5000;
    }
    delay(20);
    return;
  }
  const uint8_t imageStatus = sensor.getImage();
  if (imageStatus == FINGERPRINT_NOFINGER) {
    waitingForRemoval = false;
    delay(100);
    return;
  }
  if (imageStatus != FINGERPRINT_OK) {
    showError("Capture image", imageStatus);
    delay(1000);
    return;
  }
  if (waitingForRemoval) { delay(100); return; }
  waitingForRemoval = true;
  Serial.println("[AS608] PASS: fingerprint image captured.");
  uint8_t status = sensor.image2Tz();
  if (status != FINGERPRINT_OK) {
    showError("Extract features; lift and reposition finger", status);
    return;
  }
  Serial.println("[AS608] PASS: fingerprint features extracted.");
  if (sensor.templateCount == 0) {
    Serial.println("No enrolled fingerprints: capture test passed; matching requires enrollment later.");
  } else {
    status = sensor.fingerSearch();
    if (status == FINGERPRINT_OK) {
      Serial.printf("[AS608] MATCH: slot %u, confidence %u.\n", sensor.fingerID, sensor.confidence);
    } else if (status == FINGERPRINT_NOTFOUND) {
      Serial.println("[AS608] No stored fingerprint matched this finger.");
    } else {
      showError("Search", status);
    }
  }
  Serial.println("Lift your finger before the next scan.");
}
