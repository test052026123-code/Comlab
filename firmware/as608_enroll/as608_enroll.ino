/* Local, supervised enrollment on the central AS608.
 * TX -> GPIO16, RX -> GPIO17. Monitor: 115200 baud, Newline.
 * Send ENROLL <slot>. Does not connect to Wi-Fi or Firebase.
 * Upload comlab_cloud again after enrollment; templates stay in the sensor.
 */
#include <Adafruit_Fingerprint.h>
static HardwareSerial sensorSerial(2);
static Adafruit_Fingerprint sensor(&sensorSerial);
static bool ready = false;
static String command;

static bool capture(uint8_t buffer) {
  Serial.println("Place your finger on the scanner (30 seconds).");
  const uint32_t started = millis();
  while (millis() - started < 30000) {
    const uint8_t status = sensor.getImage();
    if (status == FINGERPRINT_OK) {
      if (sensor.image2Tz(buffer) == FINGERPRINT_OK) return true;
      Serial.println("Image was not usable. Enrollment canceled; try again.");
      return false;
    }
    if (status != FINGERPRINT_NOFINGER) { Serial.println("Sensor read failed. Enrollment canceled."); return false; }
    delay(100);
  }
  Serial.println("Enrollment timed out. Nothing stored.");
  return false;
}

static void enroll(int slot) {
  if (!ready || slot < 0 || slot >= sensor.capacity || slot > 999) {
    Serial.println("Invalid slot or sensor unavailable. Use a slot below the reported capacity.");
    return;
  }
  const uint8_t loaded = sensor.loadModel(slot);
  if (loaded == FINGERPRINT_OK) {
    Serial.println("Slot already contains a fingerprint. Choose an empty slot; overwriting is disabled.");
    return;
  }
  if (loaded != FINGERPRINT_DBRANGEFAIL) {
    Serial.printf("Cannot confirm slot is empty (0x%02X). Nothing stored.\n", loaded);
    return;
  }
  if (!capture(1)) return;
  Serial.println("Remove your finger.");
  const uint32_t started = millis();
  while (true) {
    const uint8_t status = sensor.getImage();
    if (status == FINGERPRINT_NOFINGER) break;
    if (status != FINGERPRINT_OK || millis() - started > 15000) {
      Serial.println("Finger removal not confirmed. Nothing stored."); return;
    }
    delay(100);
  }
  Serial.println("Use the SAME finger again.");
  if (!capture(2)) return;
  if (sensor.createModel() != FINGERPRINT_OK) { Serial.println("Fingerprints did not combine. Nothing stored."); return; }
  const uint8_t status = sensor.storeModel(slot);
  if (status == FINGERPRINT_OK) Serial.printf("ENROLLED slot %d. Link this slot to the student in the app, then restore comlab_cloud.\n", slot);
  else Serial.printf("Store failed (0x%02X). Verify the slot before retrying.\n", status);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  sensor.begin(57600);
  sensorSerial.begin(57600, SERIAL_8N1, 16, 17);
  delay(200);
  ready = sensor.verifyPassword() && sensor.getParameters() == FINGERPRINT_OK;
  if (!ready) Serial.println("AS608 unavailable. Check wiring and restart.");
  else Serial.printf("AS608 ready. Capacity: %u. Send ENROLL <empty slot>, for example ENROLL 1.\n", sensor.capacity);
}

void loop() {
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      int slot = -1;
      bool valid = command.startsWith("ENROLL ") && command.length() > 7;
      for (size_t i = 7; i < command.length(); ++i) valid &= command[i] >= '0' && command[i] <= '9';
      if (valid) slot = command.substring(7).toInt();
      if (valid) enroll(slot);
      else Serial.println("Use ENROLL <empty slot>. No delete or overwrite command is provided.");
      command.clear();
    } else if (command.length() < 32) command += c;
    else command = "INVALID";
  }
  delay(10);
}
