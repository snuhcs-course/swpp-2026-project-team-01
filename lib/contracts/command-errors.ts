// Stable, audience-safe error categories every interface shows for a failed
// command. Messages are fixed per category, so no error detail, secret, private
// calendar content or foreign resource existence can reach a caller.
export const COMMAND_ERROR_MESSAGES = {
  unauthenticated: "Sign in to continue.",
  forbidden: "You do not have access to this.",
  invalid_input: "The request is not valid.",
  stale_revision: "This changed since you last saw it. Refresh and try again.",
  retry_conflict: "This retry key was already used for a different request.",
  unavailable_configuration: "This is not available yet because the service is not fully configured.",
  internal: "Something went wrong. Try again later.",
} as const;

export type CommandErrorCategory = keyof typeof COMMAND_ERROR_MESSAGES;

// A fixed, audience-safe refinement of a category, for a failure the caller can
// act on differently: the booking destination can no longer take events, so the
// host must choose a writable one.
export const COMMAND_ERROR_REASONS = ["destination_not_writable"] as const;
export type CommandErrorReason = (typeof COMMAND_ERROR_REASONS)[number];

export type CommandFailure = {
  readonly category: CommandErrorCategory;
  readonly correlationId: string;
  readonly message: string;
  readonly reason?: CommandErrorReason;
};
