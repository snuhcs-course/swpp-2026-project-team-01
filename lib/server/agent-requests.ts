import { randomUUID } from "node:crypto";
import { z } from "zod";
import { REQUEST_LANGUAGES } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { type CommandFailure } from "../contracts/command-errors";
import type { GrantAccess } from "./agent-grants";
import { CommandError, commandFailure } from "./commands";
import type { Database } from "./database";
import { lockOpenRequest, hostAcceptsRequests } from "./request-guard";
import { localPatchSchema, updateDetailsCommand } from "./request-reviews";
import { admitCreation, CREATION_LIMITS, type CreationLimits, identifyDraft, insertDraftRequest } from "./request-start";
import type { TokenKey } from "./token-encryption";

// The one-future-request grant (agent-access D12, the agent-client-authorization
// delta "One future request grant"). create_request runs in one transaction
// under the grant's row lock:
//   - a bound grant returns its request when the retry key is the one that
//     created it, and refuses any other creation (already_created);
//   - otherwise it rechecks the displayed host, counts the creation against the
//     consenting browser's source bounds, inserts the request exactly as a
//     guest start does, identifies it with the requester's name, email and
//     timezone (which sends the creation email with the booking link to that
//     address), applies the meeting details with the details card's
//     validation, and binds the grant to the request for good.
// Any failure rolls all of it back. The booking link never reaches the agent,
// and creation records no agreement, approval, confirmation or Calendar grant.

export const CREATE_REQUEST_OPERATION = "request.create_for_agent";

export const createRequestInput = z
  .object({
    retryKey: z
      .string()
      .min(8)
      .max(200)
      .describe("A unique key for this creation. Repeat it after a lost response to get the same request; never create twice."),
    name: z.string().trim().min(1).max(200).describe("The requester's name, as they gave it."),
    email: z.email().max(320).describe("The requester's own email address. Their private booking link is sent there."),
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Not an IANA timezone.").describe("The requester's IANA timezone, such as Asia/Seoul."),
    language: z.enum(REQUEST_LANGUAGES).optional().describe("The language for emails: en or ko."),
    details: localPatchSchema
      .omit({ contactEmail: true, contactName: true })
      .optional()
      .describe("The meeting details the requester already gave: purpose, durationMinutes, mode, location or meetingLink, windows in the requester's local time, travelMode. Leave out anything they did not say."),
  })
  .strict();

export type CreateRequestInput = z.infer<typeof createRequestInput>;

export type CreateRequestOutcome =
  | { readonly ok: true; readonly requestId: string; readonly created: boolean }
  | { readonly ok: false; readonly error: CommandFailure | { readonly category: "already_created"; readonly requestId: string } };

export async function createRequestForGrant(
  deps: { readonly db: Database; readonly origin: string; readonly tokenKey: TokenKey; readonly limits?: Partial<CreationLimits> },
  access: GrantAccess,
  input: CreateRequestInput,
): Promise<CreateRequestOutcome> {
  const correlationId = randomUUID();
  const limits = { ...CREATION_LIMITS, ...deps.limits };

  try {
    return (await deps.db.begin(async (tx) => {
      const [grant] = await tx<{ request_id: string | null; creation_retry_key: string | null; host_account_id: string; source_hash: string; live: boolean }[]>`
        select request_id, creation_retry_key, host_account_id, source_hash,
               revoked_at is null and (expires_at is null or expires_at > now()) as live
        from app.agent_grants
        where id = ${access.grantId} and role = 'requester' and bootstrap
        for update
      `;
      if (!grant?.live) throw new CommandError("forbidden");

      if (grant.request_id) {
        if (grant.creation_retry_key === input.retryKey) return { created: false, ok: true, requestId: grant.request_id };
        return { error: { category: "already_created", requestId: grant.request_id }, ok: false };
      }

      if (!(await hostAcceptsRequests(tx, grant.host_account_id))) throw new CommandError("forbidden");
      await admitCreation(tx, grant.source_hash, limits);

      const language = input.language ?? "en";
      const requestId = await insertDraftRequest(tx, {
        hostAccountId: grant.host_account_id,
        language,
        sourceHash: grant.source_hash,
        timezone: input.timezone,
        tokenKey: deps.tokenKey,
      });
      const identified = await identifyDraft(
        tx,
        await lockOpenRequest(tx, requestId),
        { email: input.email, language, name: input.name, timezone: input.timezone },
        { origin: deps.origin, tokenKey: deps.tokenKey },
      );

      if (input.details && Object.keys(input.details).length > 0) {
        await updateDetailsCommand({ origin: deps.origin, tokenKey: deps.tokenKey }).run(tx, {
          actor: { id: requestId, kind: "requester_request" },
          correlationId,
          expectedRevision: identified.revision,
          input: { details: input.details, timezone: input.timezone },
          resourceId: requestId,
          retryKey: `mcp:${access.grantId}:${input.retryKey}`,
        });
      }

      await tx`
        update app.agent_grants
        set request_id = ${requestId}, bound_at = now(), creation_retry_key = ${input.retryKey}, expires_at = null
        where id = ${access.grantId}
      `;
      return { created: true, ok: true, requestId };
    })) as CreateRequestOutcome;
  } catch (error) {
    return { error: commandFailure(error, correlationId, CREATE_REQUEST_OPERATION), ok: false };
  }
}
