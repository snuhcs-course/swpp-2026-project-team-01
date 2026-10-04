import type { Actor, Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import { decryptSecret, encryptSecret, hashToken } from '../../security.ts';
import { createEmailSender, type PreparedEmail, type SendResult } from '../../providers/email.ts';
import type { Job } from '../../../worker/app.ts';
export interface DeliverySnapshot {
  id: string;
  dedupeKey: string;
  actionable?: boolean;
  status: 'pending' | 'sending' | 'sent' | 'uncertain' | 'failed' | 'suppressed';
  recipientEmail: string;
  payload: {
    kind?: string;
    type?: string;
    requestId: string;
    challengeId?: string;
    encryptedSecret?: string;
    eventId?: string;
    eventUrl?: string;
  };
  firstDispatchAt?: string | null;
  encryptedPrepared?: string | null;
  providerInboxId?: string | null;
}
export function createDeliveryHandler(
  env: Environment,
  db: Database,
  sender?: (inboxId: string, key: string, email: PreparedEmail) => Promise<SendResult>,
) {
  return async (job: Job, actor: Actor): Promise<void> => {
    const input = { jobId: job.id, leaseToken: job.leaseToken, outboxId: job.payload.outboxId };
    let snapshot = await db.command<DeliverySnapshot>('delivery_load', actor, input);
    if (
      snapshot.actionable === false || ['sent', 'failed', 'suppressed'].includes(snapshot.status)
    ) return;
    const contact = ['contact_verification', 'contact_recovery'].includes(
      snapshot.payload.kind || '',
    );
    const enabled = contact ? env.transactionalEmails : env.externalSends;
    if (!enabled) {
      await db.command('delivery_record', actor, {
        ...input,
        outcome: snapshot.firstDispatchAt ? 'uncertain' : 'suppressed',
        errorCode: 'external_send_disabled',
      });
      return;
    }
    if (!env.agentmailKey || !env.agentmailInboxId || !env.encryptionKey) {
      throw new DomainError('provider_unavailable', 503);
    }
    // Never cross the documented provider idempotency horizon on an uncertain send.
    if (
      snapshot.firstDispatchAt && Date.now() - Date.parse(snapshot.firstDispatchAt) >= 23 * 3600000
    ) {
      await db.command('delivery_record', actor, {
        ...input,
        outcome: 'uncertain',
        errorCode: 'email_idempotency_window_expired',
      });
      return;
    }
    const wasUncertain = snapshot.status === 'uncertain' ||
      (snapshot.status === 'sending' && !!snapshot.firstDispatchAt);
    if (!snapshot.encryptedPrepared) {
      let email: PreparedEmail;
      if (contact) {
        if (!snapshot.payload.encryptedSecret) throw new DomainError('invalid_input');
        const secret = await decryptSecret<{ code?: string; token?: string }>(
          snapshot.payload.encryptedSecret,
          env.encryptionKey,
        );
        const recovery = snapshot.payload.kind === 'contact_recovery';
        const value = recovery ? secret.token : secret.code;
        if (!value || value.length !== 43) throw new DomainError('invalid_input');
        const link = `${env.appOrigin}/requests/${snapshot.payload.requestId}#${
          recovery ? 'recovery' : 'verify'
        }=${encodeURIComponent(value)}`;
        email = {
          to: [snapshot.recipientEmail],
          subject: recovery
            ? 'Recover your Find Me a Time request'
            : 'Verify your meeting request email',
          text: recovery
            ? `You requested access to your meeting request. Open this one-time link within 15 minutes:\n\n${link}\n\nIf you did not request this, ignore this email.`
            : `Verify the email on your meeting request by entering this code within 15 minutes:\n\n${value}\n\nYou can also open this link in the browser where you made the request:\n${link}\n\nThis verifies your email. Requester agreement and host approval are separate steps.`,
        };
      } else if (snapshot.payload.type === 'booking_confirmed') {
        const url = snapshot.payload.eventUrl;
        const safeUrl = url && /^https:\/\/(?:www\.)?google\.com\/calendar\//.test(url) ? url : '';
        email = {
          to: [snapshot.recipientEmail],
          subject: 'Your meeting is booked',
          text: `The approved meeting has been confirmed on the host calendar.${
            safeUrl ? `\n\n${safeUrl}` : ''
          }\n\nReview the meeting at ${env.appOrigin}/requests/${snapshot.payload.requestId}.`,
        };
      } else throw new DomainError('unsupported_delivery');
      snapshot = await db.command<DeliverySnapshot>('delivery_dispatch', actor, {
        ...input,
        encryptedPrepared: await encryptSecret(email, env.encryptionKey),
        providerInboxId: env.agentmailInboxId,
      });
    } else {
      snapshot = await db.command<DeliverySnapshot>('delivery_dispatch', actor, input);
    }
    if (
      snapshot.actionable === false || ['sent', 'failed', 'suppressed'].includes(snapshot.status)
    ) return;
    if (!snapshot.encryptedPrepared || !snapshot.providerInboxId) {
      throw new DomainError('invalid_state', 409);
    }
    const email = await decryptSecret<PreparedEmail>(snapshot.encryptedPrepared, env.encryptionKey);
    const result = await (sender || createEmailSender(env.agentmailKey))(
      snapshot.providerInboxId,
      `fmat-${await hashToken(snapshot.dedupeKey)}`,
      email,
    );
    if (result.kind === 'sent') {
      await db.command('delivery_record', actor, {
        ...input,
        outcome: 'sent',
        providerReference: result.reference,
      });
    } else {
      await db.command('delivery_record', actor, {
        ...input,
        outcome: result.kind === 'uncertain' || wasUncertain ? 'uncertain' : 'failed',
        errorCode: result.code,
      });
      if (result.kind === 'uncertain') throw new DomainError('provider_unavailable', 503);
    }
  };
}
