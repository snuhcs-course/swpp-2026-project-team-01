import { createHash } from "node:crypto";

export class DistinctProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = "DistinctProbeError";
    this.code = code;
  }
}

export function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertOriginalConfiguration(actual, expected) {
  if (
    actual.inbox_id !== expected.inboxId ||
    actual.pod_id !== expected.podId ||
    actual.display_name !== "Find Me a Time Development" ||
    !actual.client_id
  ) {
    throw new DistinctProbeError("ORIGINAL_CONFIGURATION_MISMATCH");
  }
}

export function assertMarkedFixture(actual, fixtureState) {
  const local = fixtureState.fixtures?.find((fixture) => fixture.role === "self");
  if (
    !local ||
    actual.inbox_id !== local.inboxId ||
    actual.email !== local.email ||
    actual.pod_id !== fixtureState.podId ||
    actual.metadata?.fmat_p0_fixture !== true ||
    actual.metadata?.fmat_p0_role !== "self" ||
    actual.metadata?.fmat_p0_owner_sha256 !== fixtureState.ownershipFingerprint
  ) {
    throw new DistinctProbeError("UNMARKED_OR_FOREIGN_FIXTURE");
  }
  return local;
}

export function assertDistinctPair(original, fixture, configuredPodId) {
  if (original.inbox_id === fixture.inbox_id || original.email === fixture.email) {
    throw new DistinctProbeError("DISTINCT_IDENTITIES_REQUIRED");
  }
  if (original.pod_id !== configuredPodId || fixture.pod_id !== configuredPodId) {
    throw new DistinctProbeError("PAIR_POD_MISMATCH");
  }
}

export function assertRecipient(actual, expected) {
  if (actual !== expected) throw new DistinctProbeError("RECIPIENT_OUTSIDE_OWNED_PAIR");
}

export function immutablePayloadHash(payload) {
  return hash(
    JSON.stringify({
      version: payload.version,
      namespace: payload.namespace,
      subject: payload.subject,
      initialText: payload.initialText,
      replyText: payload.replyText,
      originalInboxId: payload.originalInboxId,
      originalEmail: payload.originalEmail,
      fixtureInboxId: payload.fixtureInboxId,
      fixtureEmail: payload.fixtureEmail,
      podId: payload.podId,
      initialIdempotencyKey: payload.initialIdempotencyKey,
      replyIdempotencyKey: payload.replyIdempotencyKey,
      startedAt: payload.startedAt,
      policyExpiresAt: payload.policyExpiresAt,
    }),
  );
}

export function assertFrozenPayload(payload) {
  if (!payload.immutableHash || payload.immutableHash !== immutablePayloadHash(payload)) {
    throw new DistinctProbeError("IMMUTABLE_PAYLOAD_MISMATCH");
  }
  if (
    payload.version !== 1 ||
    !/^fmat-p0-distinct-[a-f0-9]{20}$/.test(payload.namespace ?? "") ||
    payload.subject !== `[${payload.namespace}] controlled distinct identity` ||
    !/^fmat-distinct-initial-[a-f0-9]{40}$/.test(payload.initialIdempotencyKey ?? "") ||
    !/^fmat-distinct-reply-[a-f0-9]{40}$/.test(payload.replyIdempotencyKey ?? "") ||
    ![payload.originalInboxId, payload.originalEmail, payload.fixtureInboxId,
      payload.fixtureEmail, payload.podId].every(
      (value) => typeof value === "string" && value.length > 0,
    ) ||
    payload.originalInboxId === payload.fixtureInboxId ||
    payload.originalEmail === payload.fixtureEmail
  ) throw new DistinctProbeError("FROZEN_PAYLOAD_SCOPE_INVALID");
}

export function assertInsideIdempotencyWindow(payload, now = Date.now()) {
  const startedAt = Date.parse(payload.startedAt);
  const deadline = Date.parse(payload.policyExpiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(deadline) ||
    deadline <= startedAt ||
    deadline > startedAt + 86_400_000
  ) {
    throw new DistinctProbeError("IDEMPOTENCY_WINDOW_INVALID");
  }
  if (now >= deadline) {
    throw new DistinctProbeError("IDEMPOTENCY_WINDOW_EXPIRED_RECONCILIATION_REQUIRED");
  }
}

export function deliveryEvidence(payload = {}) {
  const initialConfirmed = Boolean(payload.initialAcceptedMessageId || payload.initialRetryMessageId);
  const replyConfirmed = Boolean(payload.replyAcceptedMessageId || payload.replyRetryMessageId);
  const confirmedAcceptedEmailCount = Number(initialConfirmed) + Number(replyConfirmed);
  const initialUncertain = Boolean(payload.initialAttemptedAt) && !initialConfirmed;
  const replyUncertain = Boolean(payload.replyAttemptedAt) && !replyConfirmed;
  const possiblySentEmailCount =
    confirmedAcceptedEmailCount + Number(initialUncertain) + Number(replyUncertain);
  const sendOutcomeUncertain = confirmedAcceptedEmailCount !== possiblySentEmailCount;
  return {
    actualEmailCount: sendOutcomeUncertain ? undefined : confirmedAcceptedEmailCount,
    confirmedAcceptedEmailCount,
    possiblySentEmailCount,
    sendOutcomeUncertain,
  };
}

export function recipientAddresses(message) {
  return (Array.isArray(message.to) ? message.to : [message.to])
    .filter(Boolean)
    .map((value) => canonicalAddress(typeof value === "string" ? value : value.email ?? value.address));
}

export function senderAddress(message) {
  const value = Array.isArray(message.from) ? message.from[0] : message.from;
  return canonicalAddress(typeof value === "string" ? value : value?.email ?? value?.address);
}

function canonicalAddress(value) {
  if (typeof value !== "string") return value;
  return value.match(/<([^>]+)>/)?.[1] ?? value;
}
