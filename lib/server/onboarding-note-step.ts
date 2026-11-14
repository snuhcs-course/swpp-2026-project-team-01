import type { Queryable, Transaction } from "./database";
import { activeBindingOfHost } from "./imessage-links";
import { publishJob } from "./jobs";

// The note step of the chat onboarding (calendar-note-review design 8). After the
// place answer, preview_next_week sends the review page link instead of the slot
// image when the scan has unanswered note candidates; the link's outbox row is
// the step's record, one per binding. The step waits while no slot image was
// recorded for that binding since the link. Pressing 확인 on the review then
// publishes one durable job that sends the image, computed with the confirmed
// notes no longer busy; a skip in words sends the image directly, which ends
// the wait the same way.

export const ONBOARDING_SLOT_IMAGE_JOB = "onboarding_slot_image";

export function noteReviewLinkKey(bindingId: string) {
  return `onboarding-notes:${bindingId}`;
}

export type OnboardingNoteStep = {
  // The link's outbox row.
  readonly linkId: string;
  // No slot image was recorded for the binding since the link.
  readonly waiting: boolean;
};

export async function noteStepOf(q: Queryable, bindingId: string): Promise<OnboardingNoteStep | null> {
  const [row] = await q<{ id: string; waiting: boolean }[]>`
    select link.id, not exists (
      select 1 from app.imessage_outbox image
      where image.binding_id = link.binding_id and image.kind = 'image' and image.created_at >= link.created_at
    ) as waiting
    from app.imessage_outbox link
    where link.kind = 'notice' and link.dedupe_key = ${noteReviewLinkKey(bindingId)} and link.binding_id = ${bindingId}
  `;
  return row ? { linkId: row.id, waiting: row.waiting } : null;
}

// Whether the host's linked chat is waiting for the slot image of this review.
export async function slotImageWaits(q: Queryable, hostAccountId: string) {
  const binding = await activeBindingOfHost(q, hostAccountId);
  return binding ? ((await noteStepOf(q, binding.id))?.waiting ?? false) : false;
}

// How long the chat waits for the review before the image goes out anyway,
// with the candidates still busy (user, 2026-11-14). On WhatsApp the image must
// leave inside Meta's 24-hour window, which opened with the host's place answer
// right before the link, so it goes an hour before that window closes.
export const NOTE_REVIEW_WAIT_HOURS = 24;
export const NOTE_REVIEW_WAIT_HOURS_WHATSAPP = 23;

// Called in the transaction that records the review link: publishes the one
// job that sends the image if the host neither confirms nor skips in time. The
// job finds the step no longer waiting, and sends nothing, once 확인 or a skip
// sent the image; they share the image's dedupe key, so one image goes out.
export async function queueSlotImageAfterWait(
  tx: Transaction,
  input: { readonly hostAccountId: string; readonly bindingId: string; readonly channel: string; readonly linkId: string },
) {
  const hours = input.channel === "whatsapp" ? NOTE_REVIEW_WAIT_HOURS_WHATSAPP : NOTE_REVIEW_WAIT_HOURS;
  await publishJob(tx, {
    dedupeKey: `${ONBOARDING_SLOT_IMAGE_JOB}:${input.linkId}:wait`,
    kind: ONBOARDING_SLOT_IMAGE_JOB,
    payload: { bindingId: input.bindingId, hostAccountId: input.hostAccountId, linkId: input.linkId, waited: true },
    runAfter: new Date(Date.now() + hours * 3_600_000),
  });
}

// Called in the transaction of the review's 확인: when the host's linked chat is
// waiting for the slot image, publishes the job that sends it. A replayed or
// repeated 확인 publishes the same job once. Returns whether the image follows.
export async function queueSlotImageAfterReview(tx: Transaction, hostAccountId: string) {
  const binding = await activeBindingOfHost(tx, hostAccountId);
  if (!binding) return false;
  const step = await noteStepOf(tx, binding.id);
  if (!step?.waiting) return false;
  await publishJob(tx, {
    dedupeKey: `${ONBOARDING_SLOT_IMAGE_JOB}:${step.linkId}`,
    kind: ONBOARDING_SLOT_IMAGE_JOB,
    payload: { bindingId: binding.id, hostAccountId, linkId: step.linkId },
  });
  return true;
}
