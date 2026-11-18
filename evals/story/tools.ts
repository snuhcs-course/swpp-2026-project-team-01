// Tool names as agent/tools/request.ts registers them for each conversation,
// grouped for allow-lists: a case names what it may call, so a decision tool
// added later fails every case that does not allow it.

// Guest tools that read, look up or draft, and decide nothing.
export const GUEST_LOOKUP = ["read_request", "read_booking_status", "evaluate_candidates", "draft_request_review"] as const;
// Guest tools that act on the request.
export const GUEST_DECISIONS = [
  "apply_request_review",
  "choose_time",
  "agree_to_proposal",
  "change_agreement",
  "withdraw_request",
  "cancel_booking",
  "change_booking",
] as const;

// Host review tools that read, look up or draft, and decide nothing.
export const HOST_LOOKUP = ["read_request", "list_host_requests", "evaluate_candidates", "propose_shared_changes", "read_booking_status"] as const;
// Host review tools that decide or move the conversation.
export const HOST_DECISIONS = [
  "approve_proposal",
  "decline_request",
  "share_changes",
  "dismiss_changes",
  "cancel_booking",
  "change_booking",
  "switch_conversation",
] as const;

// Tool names and internal words that must never appear in a reply.
export const TOOL_NAME = new RegExp(`\\b(${[...GUEST_LOOKUP, ...GUEST_DECISIONS, ...HOST_LOOKUP, ...HOST_DECISIONS, "read_setup_state", "draft_settings", "confirm_settings", "preview_next_week"].join("|")})\\b`, "i");
export const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.]+/;
export const PHONE_NUMBER = /(\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/;
