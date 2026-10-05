import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistinctPair,
  assertFrozenPayload,
  assertInsideIdempotencyWindow,
  assertMarkedFixture,
  assertOriginalConfiguration,
  assertRecipient,
  immutablePayloadHash,
} from "./agentmail-distinct-probe-lib.mjs";

const original = {
  inbox_id: "original",
  email: "original@agentmail.test",
  pod_id: "pod",
  display_name: "Find Me a Time Development",
  client_id: "product-client",
};

const fixtureState = {
  podId: "pod",
  ownershipFingerprint: "owner",
  fixtures: [{ role: "self", inboxId: "fixture", email: "fixture@agentmail.test" }],
};

const fixture = {
  inbox_id: "fixture",
  email: "fixture@agentmail.test",
  pod_id: "pod",
  metadata: {
    fmat_p0_fixture: true,
    fmat_p0_role: "self",
    fmat_p0_owner_sha256: "owner",
  },
};

test("original configuration mismatch fails closed", () => {
  assert.doesNotThrow(() =>
    assertOriginalConfiguration(original, { inboxId: "original", podId: "pod" }),
  );
  assert.throws(
    () => assertOriginalConfiguration({ ...original, client_id: undefined }, { inboxId: "original", podId: "pod" }),
    /ORIGINAL_CONFIGURATION_MISMATCH/,
  );
});

test("unmarked or foreign fixture is refused", () => {
  assert.doesNotThrow(() => assertMarkedFixture(fixture, fixtureState));
  assert.throws(
    () => assertMarkedFixture({ ...fixture, metadata: {} }, fixtureState),
    /UNMARKED_OR_FOREIGN_FIXTURE/,
  );
});

test("pair must be distinct, in one configured pod, and use exact recipients", () => {
  assert.doesNotThrow(() => assertDistinctPair(original, fixture, "pod"));
  assert.throws(
    () => assertDistinctPair(original, { ...fixture, inbox_id: "original" }, "pod"),
    /DISTINCT_IDENTITIES_REQUIRED/,
  );
  assert.doesNotThrow(() => assertRecipient(fixture.email, fixture.email));
  assert.throws(() => assertRecipient("human@example.com", fixture.email), /RECIPIENT_OUTSIDE_OWNED_PAIR/);
});

test("persisted payload cannot be changed and expires at the provider horizon", () => {
  const payload = {
    version: 1,
    namespace: "fmat-p0-distinct-0123456789abcdefabcd",
    subject: "[fmat-p0-distinct-0123456789abcdefabcd] controlled distinct identity",
    initialText: "initial",
    replyText: "reply",
    originalInboxId: "original",
    originalEmail: "original@agentmail.test",
    fixtureInboxId: "fixture",
    fixtureEmail: "fixture@agentmail.test",
    podId: "pod",
    initialIdempotencyKey: `fmat-distinct-initial-${"a".repeat(40)}`,
    replyIdempotencyKey: `fmat-distinct-reply-${"b".repeat(40)}`,
    startedAt: "2026-10-05T00:00:00.000Z",
    policyExpiresAt: "2026-10-06T00:00:00.000Z",
  };
  payload.immutableHash = immutablePayloadHash(payload);
  assert.doesNotThrow(() => assertFrozenPayload(payload));
  assert.throws(() => assertFrozenPayload({ ...payload, replyText: "changed" }), /IMMUTABLE_PAYLOAD_MISMATCH/);
  assert.doesNotThrow(() => assertInsideIdempotencyWindow(payload, Date.parse("2026-10-05T23:59:59Z")));
  assert.throws(
    () => assertInsideIdempotencyWindow(payload, Date.parse(payload.policyExpiresAt)),
    /IDEMPOTENCY_WINDOW_EXPIRED_RECONCILIATION_REQUIRED/,
  );
  for (const invalid of [
    { startedAt: "not-a-date" },
    { policyExpiresAt: "not-a-date" },
    { policyExpiresAt: payload.startedAt },
    { policyExpiresAt: "2026-10-06T00:00:00.001Z" },
  ]) {
    assert.throws(
      () => assertInsideIdempotencyWindow({ ...payload, ...invalid }, Date.parse("2026-10-05T12:00:00Z")),
      /IDEMPOTENCY_WINDOW_INVALID/,
    );
  }
  assert.throws(
    () => assertInsideIdempotencyWindow(payload, Number.NaN),
    /IDEMPOTENCY_WINDOW_INVALID/,
  );
});

test("frozen payload binds its namespace, subject, keys, and distinct run identities", () => {
  const payload = {
    version: 1,
    namespace: "fmat-p0-distinct-0123456789abcdefabcd",
    subject: "[fmat-p0-distinct-0123456789abcdefabcd] controlled distinct identity",
    initialText: "initial",
    replyText: "reply",
    originalInboxId: "original",
    originalEmail: "original@agentmail.test",
    fixtureInboxId: "fixture",
    fixtureEmail: "fixture@agentmail.test",
    podId: "pod",
    initialIdempotencyKey: `fmat-distinct-initial-${"a".repeat(40)}`,
    replyIdempotencyKey: `fmat-distinct-reply-${"b".repeat(40)}`,
    startedAt: "2026-10-05T00:00:00.000Z",
    policyExpiresAt: "2026-10-06T00:00:00.000Z",
  };
  payload.immutableHash = immutablePayloadHash(payload);
  for (const changed of [
    { namespace: "other" },
    { subject: "other" },
    { originalInboxId: payload.fixtureInboxId },
    { fixtureEmail: payload.originalEmail },
    { initialIdempotencyKey: "too-short" },
  ]) {
    const invalid = { ...payload, ...changed };
    invalid.immutableHash = immutablePayloadHash(invalid);
    assert.throws(() => assertFrozenPayload(invalid), /FROZEN_PAYLOAD_SCOPE_INVALID/);
  }
});
