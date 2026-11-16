#pragma once
// Copy to secrets.h (ignored by git) and fill in for each PC.
#define COMLAB_NODE_WIFI_SSID ""
#define COMLAB_NODE_WIFI_PASSWORD ""
#define COMLAB_NODE_ID "NODE-01"            // must match the workstation's ESP32 node ID in the dashboard
#define COMLAB_WORKSTATION_ID "PC-01"
#define COMLAB_NODE_KEY ""                  // COMLAB_NODE_KEY from /etc/comlab/comlab.env on the Pi
#define COMLAB_SERVER_URL "http://192.168.0.102:8080"

// Optional: EL817 power sense (see PowerSense.h). 1 only when wired.
#define COMLAB_NODE_POWER_SENSE 0
#define COMLAB_NODE_POWER_SENSE_PIN 33
