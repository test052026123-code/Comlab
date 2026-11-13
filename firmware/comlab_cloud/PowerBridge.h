#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Pure command lifecycle; the adapter supplies authenticated cloud/node inputs.
// State is scoped to the controller boot. After restart the server owns recovery
// and never redispatches this boot's possibly delivered work to the new boot.
namespace PowerBridge {
enum State : uint8_t { Empty, Waiting, Accepted, ConfirmedOn, Rejected, Unknown };
enum Feedback : uint8_t { Unavailable, Off, On };
enum Reason : uint8_t { NoReason, WaitingFeedback, InvalidClock, CommandExpired,
  ExecutorUnavailable, NodeRestarted, DeliveryPending, NodeRefused, NodeUncertain,
  FeedbackConfirmed, AlreadyOn, ResultTimeout };
static const char* detail(Reason reason) {
  switch (reason) {
    case WaitingFeedback: return "Waiting for fresh node power feedback; original command expiry retained.";
    case InvalidClock: return "Controller clock does not match the command time window.";
    case CommandExpired: return "Command expired before node delivery; no pulse dispatched.";
    case ExecutorUnavailable: return "Target node power executor or boot identity is unavailable.";
    case NodeRestarted: return "Node restarted while delivery was unresolved; no pulse repeated.";
    case DeliveryPending: return "Node delivery pending; awaiting independent power feedback.";
    case NodeRefused: return "Node rejected before pulse: check power sensing, relay cooldown and timer readiness.";
    case NodeUncertain: return "Node reports uncertain delivery; verify physical state before another operation.";
    case FeedbackConfirmed: return "Node confirmed completion with fresh ON feedback.";
    case AlreadyOn: return "Fresh ON feedback observed; no pulse requested.";
    case ResultTimeout: return "Node result timed out after possible delivery; no pulse repeated.";
    default: return "";
  }
}
struct Slot {
  char id[37] = {}, nodeBoot[33] = {};
  int64_t issued = 0, expires = 0;
  State state = Empty;
  Reason reason = NoReason;
  bool dispatched = false, dirty = false, nodeAccepted = false;
};
static bool terminal(State state) { return state == ConfirmedOn || state == Rejected; }
static const char* name(State state) {
  return state == ConfirmedOn ? "confirmed_on" : state == Rejected ? "rejected" :
    state == Unknown ? "unknown" : "accepted";
}
static bool uuid(const char* value) {
  if (!value) return false;
  for (int i = 0; i < 36; ++i) {
    const char c = value[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return value[36] == 0;
}
static int number(const char* text, int start, int count) {
  int result = 0;
  for (int i = start; i < start + count; ++i) {
    if (text[i] < '0' || text[i] > '9') return -1;
    result = result * 10 + text[i] - '0';
  }
  return result;
}
// The API uses Date.toISOString(): fixed-width UTC with millisecond precision.
static int64_t expiry(const char* text) {
  if (!text || strlen(text) != 24 || text[4] != '-' || text[7] != '-' || text[10] != 'T' ||
      text[13] != ':' || text[16] != ':' || text[19] != '.' || text[23] != 'Z') return 0;
  int year = number(text, 0, 4), month = number(text, 5, 2), day = number(text, 8, 2);
  const int hour = number(text, 11, 2), minute = number(text, 14, 2), second = number(text, 17, 2), ms = number(text, 20, 3);
  const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (year < 2023 || month < 1 || month > 12 || day < 1 || hour < 0 || hour > 23 ||
      minute < 0 || minute > 59 || second < 0 || second > 59 || ms < 0) return 0;
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  if (day > days[month - 1] + (month == 2 && leap ? 1 : 0)) return 0;
  year -= month <= 2;
  const int era = year / 400, yoe = year - era * 400;
  const int doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const int64_t utcDays = static_cast<int64_t>(era) * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
  return ((utcDays * 24 + hour) * 60 * 60 + minute * 60 + second) * 1000 + ms;
}
class Engine {
public:
  Slot slots[5];
  bool owns(const char* id) const {
    for (const Slot& slot : slots) if (slot.state != Empty && strcmp(slot.id, id) == 0) return true;
    return false;
  }
  void update(size_t index, State state, Reason reason = NoReason) {
    Slot& slot = slots[index];
    if (terminal(slot.state) || slot.state == state) return;
    slot.state = state; slot.reason = reason; slot.dirty = true;
  }
  bool assign(size_t index, const char* id, int64_t expires, int64_t now,
      bool ready, Feedback feedback, const char* nodeBoot) {
    if (index >= 5 || !uuid(id) || expires <= 0) return false;
    Slot& slot = slots[index];
    if (slot.state != Empty) return strcmp(slot.id, id) == 0 && slot.expires == expires;
    if (owns(id)) return false;
    slot = {}; memcpy(slot.id, id, 37); slot.expires = expires; slot.issued = expires - 30000;
    if (nodeBoot && strlen(nodeBoot) == 32) memcpy(slot.nodeBoot, nodeBoot, 33);
    slot.state = Waiting;
    if (now < 1700000000000LL || slot.issued > now + 2000) update(index, Rejected, InvalidClock);
    else if (expires <= now) update(index, Rejected, CommandExpired);
    else if (feedback == On) update(index, ConfirmedOn, AlreadyOn); // No pulse.
    else if (!ready || !slot.nodeBoot[0]) update(index, Rejected, ExecutorUnavailable);
    // A blocking HTTPS exchange can age the latest heartbeat. Keep the owned
    // command waiting for fresh feedback instead of rejecting a healthy node.
    // dispatch() still requires fresh OFF; neither expiry nor freshness is relaxed.
    else if (feedback == Unavailable) slot.reason = WaitingFeedback;
    return true;
  }
  bool dispatch(size_t index, int64_t now, bool ready, Feedback feedback, const char* boot) {
    Slot& slot = slots[index];
    if (slot.state != Waiting && slot.state != Accepted) return false;
    if (slot.nodeAccepted) return false;
    if (strcmp(slot.nodeBoot, boot) != 0) { update(index, Unknown, NodeRestarted); return false; }
    if (now >= slot.expires || now < slot.issued - 2000) {
      if (slot.state == Waiting) update(index, slot.dispatched ? Unknown : Rejected,
        now >= slot.expires ? CommandExpired : InvalidClock);
      return false;
    }
    if (feedback == On && !slot.dispatched) { update(index, ConfirmedOn, AlreadyOn); return false; }
    if (!ready || feedback != Off) return false;
    // Every retry has the identical ID, issue time and expiry. Node NVS ensures
    // that an accepted command can never cause a second physical pulse.
    slot.dispatched = true;
    update(index, Accepted, DeliveryPending);
    return true;
  }
  void tick(size_t index, int64_t now, const char* boot) {
    Slot& slot = slots[index];
    if (slot.state != Waiting && slot.state != Accepted) return;
    if (boot && boot[0] && strcmp(slot.nodeBoot, boot) != 0) { update(index, Unknown, NodeRestarted); return; }
    if (slot.state == Waiting && now >= slot.expires) update(index, slot.dispatched ? Unknown : Rejected, CommandExpired);
    else if (slot.state == Accepted && now >= slot.expires + 20000) update(index, Unknown, ResultTimeout);
  }
  void result(size_t index, const char* id, int64_t issued, State state, Feedback feedback) {
    Slot& slot = slots[index];
    if (slot.state == Empty || !slot.dispatched || strcmp(slot.id, id) != 0 || slot.issued != issued) return;
    if (state != Accepted && state != ConfirmedOn && state != Rejected && state != Unknown) return;
    if (slot.state == Unknown && state == Accepted) return;
    if (state == ConfirmedOn && feedback != On) return;
    slot.nodeAccepted = true;
    update(index, state, state == Rejected ? NodeRefused : state == Unknown ? NodeUncertain :
      state == ConfirmedOn ? FeedbackConfirmed : DeliveryPending);
  }
  void acknowledge(size_t index, const char* id, State submitted) {
    Slot& slot = slots[index];
    // A delayed HTTP ack for accepted must not clear a newer node result.
    if (slot.state == Empty || strcmp(slot.id, id) != 0 || slot.state != submitted) return;
    slot.dirty = false;
    if (terminal(slot.state)) slot = {};
  }
};
}
