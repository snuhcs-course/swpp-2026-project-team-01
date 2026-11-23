import type { nextWeek } from "./fixtures";
import type { GuestChannel, HostChannel } from "./sessions";
import type { StoryView } from "./state";

// The shape of a story case. A case file is append-only: a case is never
// edited or removed once committed; a fix is a new case. Only an expectation the
// team reverses changes a case's checks (documentation 13).

export type Check =
  // One fixed criterion graded by the grader model; one condition per check.
  | { readonly kind: "judge"; readonly criterion: string }
  // No claim that something was agreed, approved, booked, confirmed or saved.
  | { readonly kind: "noDecisionClaim" }
  // The reply must not match (tool names, links, contact details, code).
  | { readonly kind: "excludes"; readonly label: string; readonly pattern: RegExp }
  // The reply must match a clear-cut pattern, fixed or built from the start state.
  | { readonly kind: "includes"; readonly label: string; readonly pattern: RegExp | ((context: StoryContext) => RegExp) }
  // The reply is written in this language (by script, Hangul or not), not
  // counting quoted text and the fixtures' Korean names, places and purposes.
  | { readonly kind: "language"; readonly language: "ko" | "en" };

export type StoryContext = {
  readonly requestId: string;
  readonly hostAccountId: string;
  readonly dates: ReturnType<typeof nextWeek>;
  // What the start state recorded for checks, such as candidate or suggestion ids.
  readonly facts: Readonly<Record<string, unknown>>;
};

export type ToolCall = { readonly name: string; readonly input?: unknown; readonly output?: unknown };

export type CallExpectation = {
  // One tool, or several that each satisfy the expectation.
  readonly name: string | readonly string[];
  // The call's input must satisfy this (partial-deep match is not enough for
  // ids and instants, so expectations are predicates).
  readonly input?: (input: Record<string, unknown>, context: StoryContext) => boolean;
  readonly label?: string;
};

export type StoryTurn = {
  // Placeholders such as {fri.ko} or {tue.en} name next week's dates.
  readonly message: string;
  readonly checks: readonly Check[];
  // Tools this turn must call at least once.
  readonly calls?: readonly CallExpectation[];
  // Tools this turn must not call.
  readonly forbid?: readonly string[];
  // The request closes in this turn, so the model may give no reply: a closed
  // request runs no more model work (model-limits.ts). Graded by state only.
  readonly replyOptional?: boolean;
};

export type DatabaseExpectation = {
  readonly label: string;
  readonly holds: (after: StoryView, before: StoryView, context: StoryContext) => boolean;
};

export type StoryCase = {
  readonly id: string;
  readonly conversation: "requester" | "host_review";
  readonly category: "normal" | "abnormal" | "attack";
  readonly shape: "single" | "multi" | "reorder" | "out_of_order";
  // Reordered variants of one goal share a group; each must end in the same state.
  readonly group?: string;
  // Testing baseline rows and sheet ids the case comes from.
  readonly source: string;
  readonly owasp?: readonly string[];
  // A start-state code from states.ts.
  readonly state: string;
  readonly channel: GuestChannel | HostChannel | "web";
  readonly language: "ko" | "en" | "mixed";
  // Ungraded messages sent first, to reach a state only a conversation reaches.
  readonly prelude?: readonly string[];
  readonly turns: readonly StoryTurn[];
  // Every tool the conversation may call; any other call fails the case.
  readonly allowed: readonly string[];
  // "unchanged": the decision state stays as the start state left it.
  readonly database: "unchanged" | readonly DatabaseExpectation[];
  readonly trials?: number;
};
