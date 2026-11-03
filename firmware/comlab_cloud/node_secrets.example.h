#pragma once
// Generate ignored node_secrets.h with server/scripts/configure-node.js.
struct NodeCredential { const char* nodeId; const char* workstationId; const char* key; };
static const NodeCredential NODE_CREDENTIALS[5] = {
  {"NODE-01", "PC-01", ""}, {"NODE-02", "PC-02", ""},
  {"NODE-03", "PC-03", ""}, {"NODE-04", "PC-04", ""},
  {"NODE-05", "PC-05", ""}
};
