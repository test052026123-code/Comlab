#pragma once
// Generate ignored secrets.h with: node server/scripts/configure-node.js 1
#define COMLAB_NODE_WIFI_SSID ""
#define COMLAB_NODE_WIFI_PASSWORD ""
#define COMLAB_NODE_ID "NODE-01"
#define COMLAB_WORKSTATION_ID "PC-01"
#define COMLAB_NODE_KEY ""
#define COMLAB_CONTROLLER_HOST "comlab-controller"

// Optional: EL817 power sense on GPIO27 (see PowerSense.h). 1 only when wired.
#define COMLAB_NODE_POWER_SENSE 0
