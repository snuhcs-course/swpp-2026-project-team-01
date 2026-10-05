import type { Actor, Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import { decryptSecret, encryptSecret, hashToken } from '../../security.ts';
import {
  createAgentMailEmailSender,
  createCloudflareEmailSender,
  type PreparedEmail,
  type SendResult,
} from '../../providers/email.ts';
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

const CLOUDFLARE_IDENTITY_PREFIX = 'cloudflare:';

function validCloudflareIdentityParts(accountId: string, from: string): boolean {
  return /^[0-9a-f]{32}$/.test(accountId) && /^[^\s@:]+@[^\s@:]+$/.test(from);
}

function cloudflareIdentity(accountId: string, from: string): string {
  if (!validCloudflareIdentityParts(accountId, from)) {
    throw new DomainError('provider_unavailable', 503);
  }
  const identity = `${CLOUDFLARE_IDENTITY_PREFIX}${accountId}:${from}`;
  if (identity.length > 300) throw new DomainError('provider_unavailable', 503);
  return identity;
}

function parseCloudflareIdentity(
  identity: string,
): { accountId: string; from: string } | undefined {
  if (!identity.startsWith(CLOUDFLARE_IDENTITY_PREFIX)) return undefined;
  const separator = identity.indexOf(':', CLOUDFLARE_IDENTITY_PREFIX.length);
  if (separator < 0) throw new DomainError('invalid_state', 409);
  const accountId = identity.slice(CLOUDFLARE_IDENTITY_PREFIX.length, separator);
  const from = identity.slice(separator + 1);
  if (!validCloudflareIdentityParts(accountId, from) || identity.length > 300) {
    throw new DomainError('invalid_state', 409);
  }
  return { accountId, from };
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
    if (!env.encryptionKey) throw new DomainError('provider_unavailable', 503);
    if (
      (!!snapshot.encryptedPrepared !== !!snapshot.providerInboxId) ||
      (snapshot.firstDispatchAt && (!snapshot.encryptedPrepared || !snapshot.providerInboxId))
    ) throw new DomainError('invalid_state', 409);
    const frozenCloudflare = snapshot.providerInboxId
      ? parseCloudflareIdentity(snapshot.providerInboxId)
      : undefined;
    if (snapshot.providerInboxId?.includes(':') && !frozenCloudflare) {
      throw new DomainError('invalid_state', 409);
    }
    if (frozenCloudflare && snapshot.firstDispatchAt) {
      await db.command('delivery_record', actor, {
        ...input,
        outcome: 'uncertain',
        errorCode: 'email_replay_unsafe',
      });
      return;
    }
    if (
      !frozenCloudflare && snapshot.providerInboxId && snapshot.firstDispatchAt &&
      Date.now() - Date.parse(snapshot.firstDispatchAt) >= 23 * 3600000
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
      if (
        !env.cloudflareAccountId || !env.cloudflareEmailToken || !env.cloudflareEmailFrom
      ) throw new DomainError('provider_unavailable', 503);
      snapshot = await db.command<DeliverySnapshot>('delivery_dispatch', actor, {
        ...input,
        encryptedPrepared: await encryptSecret(email, env.encryptionKey),
        providerInboxId: cloudflareIdentity(env.cloudflareAccountId, env.cloudflareEmailFrom),
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
    const identity = parseCloudflareIdentity(snapshot.providerInboxId);
    let result: SendResult;
    if (identity) {
      if (
        !env.cloudflareAccountId || !env.cloudflareEmailToken || !env.cloudflareEmailFrom ||
        identity.accountId !== env.cloudflareAccountId || identity.from !== env.cloudflareEmailFrom
      ) throw new DomainError('provider_unavailable', 503);
      result = sender
        ? await sender(snapshot.providerInboxId, '', email)
        : await createCloudflareEmailSender(
          identity.accountId,
          env.cloudflareEmailToken,
          identity.from,
        )(email);
    } else {
      if (!env.agentmailKey) throw new DomainError('provider_unavailable', 503);
      result = await (sender || createAgentMailEmailSender(env.agentmailKey))(
        snapshot.providerInboxId,
        `fmat-${await hashToken(snapshot.dedupeKey)}`,
        email,
      );
    }
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
