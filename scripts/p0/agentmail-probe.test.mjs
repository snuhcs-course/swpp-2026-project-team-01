import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ProbeError,
  assertControlledRecipient,
  assertImmutableSendWindow,
  assertOwnedFixture,
  assertProvisionCapacity,
  deliveryEvidence,
  fixtureMetadata,
  newFixtureState,
  readDotEnv,
  writePrivateJson,
} from "./agentmail-probe-lib.mjs";

function state() {
  return {
    podId: "pod-owned",
    ownershipFingerprint: "owner-fingerprint",
    fixtures: [
      { role: "sender", inboxId: "inbox-a", email: "a@agentmail.to" },
      { role: "recipient", inboxId: "inbox-b", email: "b@agentmail.to" },
    ],
  };
}

test("capacity guard permits at most one existing inbox", () => {
  assert.doesNotThrow(() => assertProvisionCapacity(0));
  assert.doesNotThrow(() => assertProvisionCapacity(1));
  assert.throws(
    () => assertProvisionCapacity(2),
    /FREE_PLAN_FIXTURE_CAPACITY_BLOCKED/,
  );
});

test("single-self fallback permits at most two existing inboxes", () => {
  assert.doesNotThrow(() => assertProvisionCapacity(2, 1));
  assert.throws(
    () => assertProvisionCapacity(3, 1),
    /FREE_PLAN_FIXTURE_CAPACITY_BLOCKED/,
  );
});

test("new fixtures persist client IDs before provider IDs exist", () => {
  for (const mode of ["pair", "single-self"]) {
    const fixtureState = newFixtureState("pod-owned", mode);
    assert.ok(fixtureState.fixtures.every((fixture) => fixture.clientId));
    assert.ok(
      fixtureState.fixtures.every((fixture) => fixture.inboxId === undefined),
    );
    assert.equal(
      new Set(fixtureState.fixtures.map((fixture) => fixture.clientId)).size,
      fixtureState.fixtures.length,
    );
  }
});

test("recipient guard accepts only the paired owned fixture", () => {
  assert.doesNotThrow(() =>
    assertControlledRecipient(state(), "b@agentmail.to"),
  );
  assert.throws(
    () => assertControlledRecipient(state(), "human@example.com"),
    /EXTERNAL_RECIPIENT_REFUSED/,
  );
});

test("single-self guard resolves both roles to its one owned fixture", () => {
  const fixtureState = {
    mode: "single-self",
    fixtures: [
      { role: "self", inboxId: "inbox-self", email: "self@agentmail.to" },
    ],
  };
  assert.doesNotThrow(() =>
    assertControlledRecipient(fixtureState, "self@agentmail.to"),
  );
  assert.throws(
    () => assertControlledRecipient(fixtureState, "other@agentmail.to"),
    /EXTERNAL_RECIPIENT_REFUSED/,
  );
});

test("ownership guard binds id, pod, address, role, and owner fingerprint", () => {
  const fixtureState = state();
  const local = fixtureState.fixtures[0];
  const provider = {
    inbox_id: local.inboxId,
    pod_id: fixtureState.podId,
    email: local.email,
    metadata: fixtureMetadata(fixtureState, local.role),
  };
  assert.doesNotThrow(() => assertOwnedFixture(provider, local, fixtureState));
  assert.throws(
    () =>
      assertOwnedFixture(
        {
          ...provider,
          metadata: { ...provider.metadata, fmat_p0_owner_sha256: "other" },
        },
        local,
        fixtureState,
      ),
    /FIXTURE_OWNERSHIP_MISMATCH/,
  );
});

test("ownership guard checks a deterministic client id when present", () => {
  const fixtureState = state();
  const local = { ...fixtureState.fixtures[0], clientId: "fixture-client" };
  const provider = {
    inbox_id: local.inboxId,
    pod_id: fixtureState.podId,
    email: local.email,
    client_id: "different-client",
    metadata: fixtureMetadata(fixtureState, local.role),
  };
  assert.throws(
    () => assertOwnedFixture(provider, local, fixtureState),
    /FIXTURE_OWNERSHIP_MISMATCH/,
  );
});

test("dotenv reader rejects group-readable credential files", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fmat-agentmail-test-"),
  );
  const envPath = path.join(directory, ".env");
  fs.writeFileSync(
    envPath,
    "AGENTMAIL_POD_ID=pod\nAGENTMAIL_API_KEY=secret\n",
    { mode: 0o640 },
  );
  assert.throws(() => readDotEnv(envPath), /ENV_PERMISSIONS_MUST_BE_0600/);
});

test("private JSON writer enforces mode 0600", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fmat-agentmail-test-"),
  );
  const filePath = path.join(directory, "fixture.json");
  writePrivateJson(filePath, { probe: true });
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

test("unknown initial write is possibly sent but not confirmed accepted", () => {
  assert.deepEqual(
    deliveryEvidence({ initialDispatchAttemptedAt: "2026-10-05T00:00:00Z" }),
    {
      actualEmailCount: undefined,
      confirmedAcceptedEmailCount: 0,
      possiblySentEmailCount: 1,
      sendOutcomeUncertain: true,
    },
  );
});

test("unknown reply preserves one confirmed initial and one uncertain write", () => {
  assert.deepEqual(
    deliveryEvidence({
      initialRetryMessageId: "initial",
      sentParentReplyAttemptedAt: "2026-10-05T00:01:00Z",
    }),
    {
      actualEmailCount: undefined,
      confirmedAcceptedEmailCount: 1,
      possiblySentEmailCount: 2,
      sendOutcomeUncertain: true,
    },
  );
});

test("send window rejects altered payload, malformed times and extended or expired retry windows", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const expected = {
    initialIdempotencyKey: "immutable",
    recipientEmail: "self@example.invalid",
  };
  const payload = {
    ...expected,
    startedAt: "2026-10-04T12:00:00Z",
    policyExpiryAt: "2026-10-05T12:00:00Z",
  };
  assert.equal(
    assertImmutableSendWindow(payload, expected, now),
    new Date(payload.policyExpiryAt).toISOString(),
  );
  assert.throws(
    () =>
      assertImmutableSendWindow(
        { ...payload, recipientEmail: "other@example.invalid" },
        expected,
        now,
      ),
    /IMMUTABLE_PAYLOAD/,
  );
  assert.throws(
    () =>
      assertImmutableSendWindow(
        { ...payload, startedAt: "invalid" },
        expected,
        now,
      ),
    /INVALID_ORIGINAL/,
  );
  assert.throws(
    () =>
      assertImmutableSendWindow(
        { ...payload, startedAt: "2026-10-06T00:00:00Z" },
        expected,
        now,
      ),
    /INVALID_ORIGINAL/,
  );
  assert.throws(
    () =>
      assertImmutableSendWindow(
        { ...payload, policyExpiryAt: "2026-10-07T00:00:00Z" },
        expected,
        now,
      ),
    /IMMUTABLE_EXPIRY/,
  );
  assert.throws(
    () =>
      assertImmutableSendWindow(
        payload,
        expected,
        Date.parse(payload.policyExpiryAt),
      ),
    /EXPIRED_RECONCILIATION/,
  );
});
