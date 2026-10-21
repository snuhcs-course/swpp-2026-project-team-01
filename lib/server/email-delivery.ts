import { randomUUID } from "node:crypto";
import type { RequestLanguage } from "../contracts/request";
import {
  CLOUDFLARE_API_URL,
  type CloudflareEmailConfig,
  cloudflareEmailConfigFromEnvironment,
  cloudflareEmailConfigured,
  cloudflareEmailTransport,
  type OutgoingEmail,
  type SendOutcome,
  senderHeader,
} from "./cloudflare-email";
import { CommandError } from "./commands";
import { database, type Database, type Transaction } from "./database";
import { type EmailParameters, type EmailSecrets, type EmailTemplate, isEmailTemplate, renderEmail } from "./email-templates";
import { publishJob, type ClaimedJob, type JobHandler } from "./jobs";
import { assertMessagingAdmitted, gateTransport, type MessagingTransport } from "./messaging";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Durable transactional email (design decision 5). The domain transaction that
// needs an email calls enqueueEmail, which freezes the sender, recipients,
// template, language and non-secret parameters, seals the secret parameters (the
// booking link, a confirmation link) under the token key, and publishes the
// email_delivery job, all in that transaction. The job then:
//   1. rechecks that the recipient is still current for the purpose, otherwise
//      the delivery is suppressed;
//   2. moves the delivery to dispatching and commits before any network call;
//   3. renders the template, opening the sealed secrets, and sends once;
//   4. records accepted only when every recipient is delivered or queued,
//      rejected on a bounce or a refusal, and uncertain on a timeout, a lost
//      response or a server error. Every final state deletes the sealed secrets.
// A delivery found in dispatching by a later attempt may have gone out: it
// becomes uncertain and is never sent again.

export const EMAIL_DELIVERY_JOB = "email_delivery";
export const PRODUCT_SENDER = "no-reply@findmeatime.com";

export type EmailKind = EmailTemplate;

export type DeliveryState = "queued" | "dispatching" | "accepted" | "rejected" | "uncertain" | "suppressed";

export type EnqueueEmail = {
  readonly kind: EmailKind;
  readonly requestId: string;
  // One delivery per (kind, dedupeKey): a concurrent or retried publication
  // returns the existing delivery, and changed input cannot replace it.
  readonly dedupeKey: string;
  readonly recipient: string;
  readonly language: RequestLanguage;
  readonly parameters: EmailParameters;
  readonly secrets: EmailSecrets;
  readonly tokenKey: TokenKey;
  // The sending address; CLOUDFLARE_EMAIL_FROM, else the product sender.
  readonly from?: string;
};

export function secretContext(deliveryId: string) {
  return `email_delivery:${deliveryId}`;
}

export function frozenSender(env: Readonly<Record<string, string | undefined>> = process.env) {
  return senderHeader(env.CLOUDFLARE_EMAIL_FROM?.trim() || PRODUCT_SENDER);
}

export async function enqueueEmail(tx: Transaction, email: EnqueueEmail): Promise<{ id: string; created: boolean }> {
  const id = randomUUID();
  const sealed = sealToken(email.tokenKey, JSON.stringify(email.secrets), secretContext(id));
  const [created] = await tx<{ id: string }[]>`
    insert into app.email_deliveries
      (id, kind, request_id, dedupe_key, sender, recipients, template, language, parameters,
       secret_ciphertext, secret_key_id)
    values
      (${id}, ${email.kind}, ${email.requestId}, ${email.dedupeKey}, ${email.from ?? frozenSender()},
       ${[email.recipient]}, ${email.kind}, ${email.language},
       ${tx.json(email.parameters as Parameters<typeof tx.json>[0])}, ${sealed.ciphertext}, ${sealed.keyId})
    on conflict (kind, dedupe_key) do nothing
    returning id
  `;

  if (!created) {
    const [existing] = await tx<{ id: string }[]>`
      select id from app.email_deliveries where kind = ${email.kind} and dedupe_key = ${email.dedupeKey}
    `;
    return { created: false, id: existing!.id };
  }

  await publishJob(tx, { dedupeKey: `email:${id}`, kind: EMAIL_DELIVERY_JOB, payload: { deliveryId: id } });
  return { created: true, id };
}

type DeliveryRow = {
  readonly id: string;
  readonly kind: EmailKind;
  readonly request_id: string | null;
  readonly sender: string;
  readonly recipients: string[];
  readonly template: string;
  readonly language: RequestLanguage;
  readonly parameters: EmailParameters;
  readonly secret_ciphertext: string | null;
  readonly secret_key_id: string | null;
  readonly dispatch_id: string;
  readonly state: DeliveryState;
};

// Whether the recipient is still current for the delivery's purpose: the request
// is open and unexpired with an unexpired booking link, and the address is still
// its contact (for a creation email, whose confirmation link must not be
// superseded) or still its confirmed contact (for a link resend).
async function recipientCurrent(tx: Transaction, delivery: DeliveryRow) {
  if (!delivery.request_id || delivery.recipients.length !== 1) return false;

  const recipient = delivery.recipients[0]!.toLowerCase();
  const [row] = await tx<{ current: boolean }[]>`
    select (
      r.closed_at is null
      and r.expires_at > now()
      and l.expires_at > now()
      and case ${delivery.kind}
        when 'request_creation' then lower(r.contact_email) = ${recipient}
          and not exists (
            select 1 from app.contact_confirmations c
            where c.delivery_id = ${delivery.id} and c.superseded_at is not null
          )
        when 'link_resend' then lower(coalesce(r.contact_confirmed_email, '')) = ${recipient}
        else false
      end
    ) as current
    from app.requests r
    join app.booking_links l on l.request_id = r.id
    where r.id = ${delivery.request_id}
  `;
  return row?.current ?? false;
}

// Records a final state and deletes the sealed secrets in the same write.
async function finish(
  tx: Transaction | Database,
  deliveryId: string,
  from: DeliveryState,
  to: Exclude<DeliveryState, "queued" | "dispatching">,
  evidence: Record<string, unknown>,
  messageId: string | null = null,
) {
  const rows = await tx`
    update app.email_deliveries
    set state = ${to}, evidence = ${tx.json(evidence as Parameters<typeof tx.json>[0])},
        provider_message_id = ${messageId}, secret_ciphertext = null, secret_key_id = null,
        completed_at = now(), updated_at = now()
    where id = ${deliveryId} and state = ${from}
  `;
  return rows.count > 0;
}

function evidenceOf(outcome: SendOutcome, dispatchId: string): Record<string, unknown> {
  switch (outcome.status) {
    case "accepted":
      return { delivered: outcome.delivered, dispatchId, queued: outcome.queued };
    case "rejected":
      return { bounced: outcome.bounced, dispatchId, httpStatus: outcome.httpStatus, reason: outcome.reason };
    case "uncertain":
      return { dispatchId, httpStatus: outcome.httpStatus, reason: outcome.reason };
  }
}

export type EmailDeliveryDependencies = {
  // Its own connection: dispatching commits before the send, outside the job's
  // transaction.
  readonly db: Database;
  readonly config: CloudflareEmailConfig;
  readonly tokenKeys: readonly TokenKey[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport?: MessagingTransport<OutgoingEmail, SendOutcome>;
};

function deliveryDependenciesFromEnvironment(): EmailDeliveryDependencies {
  return { config: cloudflareEmailConfigFromEnvironment(), db: database(), tokenKeys: [tokenKeyFromEnvironment()] };
}

export type DeliveryJobOutcome = { readonly deliveryId: string | null; readonly state: DeliveryState | "missing" };

export function createEmailDeliveryHandler(
  load: () => EmailDeliveryDependencies = deliveryDependenciesFromEnvironment,
): JobHandler {
  const handler: JobHandler = async (tx: Transaction, job: ClaimedJob): Promise<DeliveryJobOutcome> => {
    const deliveryId = typeof job.payload.deliveryId === "string" ? job.payload.deliveryId : null;

    if (!deliveryId) return { deliveryId, state: "missing" };

    const deps = load();
    const transport = gateTransport(deps.transport ?? cloudflareEmailTransport(deps.config), deps.env);

    // Phase 1, committed before any network call.
    const claim = await deps.db.begin(async (claimTx) => {
      const [delivery] = await claimTx<DeliveryRow[]>`
        select id, kind, request_id, sender, recipients, template, language, parameters,
               secret_ciphertext, secret_key_id, dispatch_id, state
        from app.email_deliveries where id = ${deliveryId}
        for update
      `;

      if (!delivery) return { state: "missing" as const };

      if (delivery.state === "dispatching") {
        // An earlier attempt may have sent it: never again.
        await finish(claimTx, delivery.id, "dispatching", "uncertain", {
          dispatchId: delivery.dispatch_id,
          reason: "interrupted",
        });
        return { state: "uncertain" as const };
      }

      if (delivery.state !== "queued") return { state: delivery.state };

      if (!(await recipientCurrent(claimTx, delivery))) {
        await finish(claimTx, delivery.id, "queued", "suppressed", { reason: "recipient_not_current" });
        return { state: "suppressed" as const };
      }

      // Denied environments and missing configuration fail the attempt before
      // dispatching, leaving the delivery queued; nothing falls back.
      assertMessagingAdmitted(transport.endpoint, deps.env);

      if (!deps.transport && !cloudflareEmailConfigured(deps.config)) {
        throw new CommandError("unavailable_configuration");
      }

      if (!isEmailTemplate(delivery.template) || !delivery.secret_ciphertext || !delivery.secret_key_id) {
        await finish(claimTx, delivery.id, "queued", "rejected", { reason: "unrenderable" });
        return { state: "rejected" as const };
      }

      const secrets = JSON.parse(
        openToken(
          deps.tokenKeys,
          { ciphertext: delivery.secret_ciphertext, keyId: delivery.secret_key_id },
          secretContext(delivery.id),
        ),
      ) as EmailSecrets;

      await claimTx`
        update app.email_deliveries
        set state = 'dispatching', dispatched_at = now(), updated_at = now()
        where id = ${delivery.id} and state = 'queued'
      `;

      return { delivery, secrets, state: "dispatching" as const };
    });

    if (claim.state !== "dispatching") return { deliveryId, state: claim.state };

    const { delivery, secrets } = claim;
    const rendered = renderEmail(delivery.template as EmailTemplate, delivery.language, delivery.parameters, secrets);
    let outcome: SendOutcome;

    try {
      outcome = await transport.send({
        dispatchId: delivery.dispatch_id,
        from: delivery.sender,
        html: rendered.html,
        subject: rendered.subject,
        text: rendered.text,
        to: delivery.recipients,
      });
    } catch {
      // The adapter classifies every provider answer; anything thrown past it
      // happened after dispatching was committed, so the send may have run.
      outcome = { httpStatus: null, reason: "lost_response", status: "uncertain" };
    }

    const messageId = outcome.status === "accepted" ? outcome.messageId : null;
    await finish(tx, delivery.id, "dispatching", outcome.status, evidenceOf(outcome, delivery.dispatch_id), messageId);
    return { deliveryId, state: outcome.status };
  };

  // Attempts spent before anything was dispatched (missing configuration, a
  // denied environment): the delivery was never sent and is recorded so.
  handler.onExhausted = async (tx, job) => {
    const deliveryId = typeof job.payload.deliveryId === "string" ? job.payload.deliveryId : null;
    if (deliveryId) await finish(tx, deliveryId, "queued", "rejected", { reason: "not_dispatched" });
  };

  handler.messagingEndpoint = () => {
    try {
      const deps = load();
      return (deps.transport ?? cloudflareEmailTransport(deps.config)).endpoint;
    } catch {
      // Unloadable configuration (no token key): the real endpoint, which only
      // production admits, where the attempt then fails as unconfigured.
      return CLOUDFLARE_API_URL;
    }
  };

  return handler;
}
