#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>

static const uint16_t NODE_CONTROLLER_PORT = 9090;
static const uint16_t NODE_CLIENT_PORT = 9091;
static const size_t NODE_PACKET_LIMIT = 1024;
static const uint32_t NODE_FRESH_MS = 6000;
static const char* NODE_REPORT_DOMAIN = "comlab-node-report-v1\n";
static const char* NODE_REPLY_DOMAIN = "comlab-node-reply-v1\n";

static bool nodeHex(const String& value, size_t length) {
  if (value.length() != length) return false;
  for (size_t i = 0; i < length; ++i) {
    const char c = value[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

static String nodeSignature(const char* key, const char* domain, const String& body) {
  if (!nodeHex(String(key), 64)) return String();
  const String message = String(domain) + body;
  unsigned char digest[32];
  if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
      reinterpret_cast<const unsigned char*>(key), strlen(key),
      reinterpret_cast<const unsigned char*>(message.c_str()), message.length(), digest) != 0) return String();
  char hex[65];
  for (size_t i = 0; i < 32; ++i) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return String(hex);
}

static bool nodeVerify(const char* key, const char* domain, const String& body, const String& signature) {
  if (!nodeHex(signature, 64)) return false;
  const String expected = nodeSignature(key, domain, body);
  if (expected.length() != 64) return false;
  volatile uint8_t different = 0;
  for (size_t i = 0; i < 64; ++i) different = different | (expected[i] ^ signature[i]);
  return different == 0;
}

static String nodePacket(const char* key, const char* domain, const String& body) {
  const String signature = nodeSignature(key, domain, body);
  if (signature.isEmpty()) return String();
  JsonDocument envelope;
  envelope["body"] = body; envelope["signature"] = signature;
  String packet; serializeJson(envelope, packet);
  return packet.length() <= NODE_PACKET_LIMIT ? packet : String();
}
