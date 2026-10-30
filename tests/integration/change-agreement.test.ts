import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB, noticeKey } from "../../lib/server/imessage-notices";
import {
  agreeCommand,
  changeAgreementCommand,
  chooseCandidateCommand,
  evaluateCommand,
  readCurrentEvaluation,
} from "../../lib/server/request-proposals";
import { agreedRequest, asHost } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";
import { jobFor, runJob, testTokenKey } from "./support/requests";
import { asRequester, evaluationDeps, revisionOf, runEvaluation } from "./support/scheduling";

// Changes until the host approves (guest-flow-completion task 5a.2, design 10):
// Change returns an agreed request to negotiating at a new revision, and a new
// agreement needs a new proposal version; an approval sent for the earlier
// revision is stale, and its awaiting-approval summary is no longer sent; an
// approval that commits first makes the change stale.

const db = testDatabase();
let google: FakeGoogle;
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  google = await startFakeGoogle();
  photon = await startFakePhoton();
});

afterAll(async () => {
  await google.close();
  await photon.close();
  await db.end();
});

async function state(requestId: string) {
  const [row] = await db<{ state: string; revision: number }[]>`select state, revision from app.requests where id = ${requestId}`;
  return row!;
}

describe("changing an agreed request before approval", () => {
  it("reopens the request, and a new agreement needs a new proposal version", async () => {
    const request = await agreedRequest(db, google);
    const before = await state(request.requestId);
    expect(before.state).toBe("awaiting_host_approval");

    const changed = await asRequester(db, request.requestId, changeAgreementCommand, {}, { expectedRevision: before.revision });
    expect(changed).toMatchObject({ ok: true, result: { revision: before.revision + 1, state: "negotiating" } });
    // The earlier agreement stays as history.
    expect(await db`select 1 from app.agreements a join app.proposals p on p.id = a.proposal_id where p.request_id = ${request.requestId}`).toHaveLength(1);

    // The agreed version cannot be agreed again.
    const again = await asRequester(db, request.requestId, agreeCommand, { version: 1 }, { expectedRevision: before.revision + 1 });
    expect(again.ok ? null : again.error.category).toBe("stale_revision");

    // Times found again, a time chosen: version 2, then agreed.
    const evaluated = await asRequester(db, request.requestId, evaluateCommand, {});
    if (!evaluated.ok) throw new Error(`evaluate failed: ${evaluated.error.category}`);
    await runEvaluation(db, evaluationDeps(db, google), evaluated.result.evaluationId);
    const view = await readCurrentEvaluation(db, request.requestId);
    const revision = await revisionOf(db, request.requestId);
    const chosen = await asRequester(
      db,
      request.requestId,
      chooseCandidateCommand,
      { candidateId: view!.candidates[1]!.id, evaluationId: view!.id },
      { expectedRevision: revision },
    );
    expect(chosen).toMatchObject({ ok: true, result: { outcome: "proposed", version: 2 } });
    const agreed = await asRequester(db, request.requestId, agreeCommand, { version: 2 }, { expectedRevision: revision });
    expect(agreed).toMatchObject({ ok: true, result: { state: "awaiting_host_approval", version: 2 } });
  });

  it("makes an approval of the earlier revision stale, and drops its approval summary", async () => {
    // The host's iMessage is linked before agreement, so agreeing records its summary.
    const seeded = await agreedRequest(db, google, { beforeAgree: async (request) => void (await im.link(request.hostAccountId)) });

    const agreedRevision = await revisionOf(db, seeded.requestId);
    const changed = await asRequester(db, seeded.requestId, changeAgreementCommand, {}, { expectedRevision: agreedRevision });
    expect(changed.ok).toBe(true);

    const approved = await asHost(db, seeded.hostAccountId, seeded.requestId, approveCommand, { version: 1 }, { expectedRevision: agreedRevision });
    expect(approved.ok ? null : approved.error.category).toBe("stale_revision");
    expect((await state(seeded.requestId)).state).toBe("negotiating");

    // The awaiting-approval summary recorded at agreement is no longer sent.
    const job = await jobFor(db, IMESSAGE_NOTICE_JOB, noticeKey(seeded.requestId, { kind: "awaiting_approval", version: 1 }));
    expect(job).not.toBeNull();
    expect(await runJob(db, job!.id, createImessageNoticeHandler(() => ({ db, origin: "http://localhost:3000", tokenKey: testTokenKey, tokenKeys: [testTokenKey] })))).toBe("completed");
    expect(await db`select 1 from app.imessage_outbox where request_id = ${seeded.requestId} and kind = 'notice'`).toHaveLength(0);
  });

  it("is stale once the host approved first", async () => {
    const request = await agreedRequest(db, google);
    const revision = await revisionOf(db, request.requestId);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, { expectedRevision: revision });
    expect(approved.ok).toBe(true);

    const changed = await asRequester(db, request.requestId, changeAgreementCommand, {}, { expectedRevision: revision });
    expect(changed.ok ? null : changed.error.category).toBe("stale_revision");
    expect((await state(request.requestId)).state).toBe("booking");
  });
});
