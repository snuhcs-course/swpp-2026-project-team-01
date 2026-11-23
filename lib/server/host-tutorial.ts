import { z } from "zod";
import { TUTORIAL_FEEDBACK, TUTORIAL_TEXT, tutorialAction, tutorialFinishResult } from "../contracts/host-tutorial";
import { DEFAULT_MEETING_MINUTES } from "../contracts/setup";
import { isValidTimeZone } from "../contracts/timezone";
import type { ChannelLanguage } from "./channel-language";
import { lockActiveHost } from "./analysis";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import type { Queryable } from "./database";
import { enqueueButtonRetirement, enqueueHostNotice } from "./imessage-notices";

export { TUTORIAL_TEXT };

export function tutorialCompletionText(language: ChannelLanguage, result: unknown) {
  const feedback = TUTORIAL_FEEDBACK[language];
  const parsed = tutorialFinishResult.safeParse(result);
  return `${feedback[parsed.data?.action ?? "complete"]} ${feedback.practice}`;
}

export async function tutorialOffered(db: Queryable, hostAccountId: string) {
  const [settings] = await db<{ tutorial_offered: boolean }[]>`
    select tutorial_offered from app.host_settings where host_account_id = ${hostAccountId}
  `;
  return settings?.tutorial_offered ?? false;
}

export const tutorialChoiceInput = z.object({ start: z.boolean() }).strict();

export function chooseTutorialCommand(
  language: ChannelLanguage,
  bindingId?: string,
): CommandDefinition<z.infer<typeof tutorialChoiceInput>, { requestId: string | null; sampleNotice: boolean }> {
  return {
    input: tutorialChoiceInput,
    operation: "setup.request_tutorial",
    async run(tx, { actor, input }) {
      if (actor.kind !== "host_account") throw new CommandError("forbidden");
      await lockActiveHost(tx, actor.id);
      const [settings] = await tx<{ revision: number; timezone: string | null }[]>`
        update app.host_settings s set tutorial_offered = false, tutorial_binding_id = ${input.start ? bindingId ?? null : null}
        where s.host_account_id = ${actor.id} and s.tutorial_offered
        returning s.revision, s.settings ->> 'timezone' as timezone
      `;

      if (!settings) {
        const [sample] = await tx<{ id: string }[]>`
          select id from app.requests where host_account_id = ${actor.id} and is_sample and closed_at is null and expires_at > now()
        `;
        const requestId = input.start ? sample?.id ?? null : null;
        const sampleNotice = requestId && bindingId ? await enqueueHostNotice(tx, requestId, { kind: "sample_request", bindingId }) : false;
        if (sampleNotice && bindingId) {
          await tx`update app.host_settings set tutorial_binding_id = ${bindingId} where host_account_id = ${actor.id}`;
        }
        return { requestId, sampleNotice };
      }
      if (!input.start) return { requestId: null, sampleNotice: false };

      const timezone = settings.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : "UTC";
      const start = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 86_400_000);
      const end = new Date(start.getTime() + DEFAULT_MEETING_MINUTES * 60_000);
      const later = new Date(start.getTime() + 86_400_000);
      const laterEnd = new Date(end.getTime() + 86_400_000);
      const terms = { durationMinutes: DEFAULT_MEETING_MINUTES, linkPlan: { kind: "google_meet" }, location: null, mode: "online" };
      const details = {
        ...terms,
        language,
        purpose: language === "ko" ? "프로젝트 소개 미팅" : "Project introduction",
        timezone,
        windows: [{ start: start.toISOString(), end: end.toISOString() }, { start: later.toISOString(), end: laterEnd.toISOString() }],
      };
      const name = language === "ko" ? "김하늘 (샘플)" : "Alex Kim (sample)";
      const [request] = await tx<{ id: string }[]>`
        insert into app.requests (host_account_id, state, is_sample, details, requester_name, expires_at)
        values (${actor.id}, 'awaiting_host_approval', true, ${tx.json(details)}, ${name}, now() + interval '3 days')
        returning id
      `;
      const requestId = request!.id;

      // The proposal needs an evaluation record. The sample has fixed terms, so
      // it never queues an evaluation or reads a real calendar.
      const [evaluation] = await tx<{ id: string }[]>`
        insert into app.evaluations (request_id, request_revision, settings_revision, state, completed_at)
        values (${requestId}, 1, ${settings.revision}, 'completed', now())
        returning id
      `;
      const [proposal] = await tx<{ id: string }[]>`
        insert into app.proposals (request_id, version, evaluation_id, candidate_id, start_at, end_at, details)
        values (${requestId}, 1, ${evaluation!.id}, 'sample', ${start}, ${end}, ${tx.json(terms)})
        returning id
      `;
      await tx`
        insert into app.agreements (proposal_id, request_revision, retry_key)
        values (${proposal!.id}, 1, 'tutorial')
      `;

      const sampleNotice = bindingId ? await enqueueHostNotice(tx, requestId, { kind: "sample_request", bindingId }) : false;
      return { requestId, sampleNotice };
    },
  };
}

const finishInput = z.object({ action: tutorialAction.optional(), version: z.number().int().positive().optional() }).strict();

export const finishSampleCommand: CommandDefinition<z.infer<typeof finishInput>, z.infer<typeof tutorialFinishResult>> = {
  input: finishInput,
  operation: "tutorial.finish",
  async run(tx, { actor, resourceId, expectedRevision, input }) {
    if (actor.kind !== "host_account") throw new CommandError("forbidden");
    const [sample] = await tx<{ revision: number; closed: boolean; version: number }[]>`
      select r.revision, (r.closed_at is not null or r.expires_at <= now()) as closed, p.version
      from app.requests r
      join app.host_accounts a on a.id = r.host_account_id
      join app.proposals p on p.request_id = r.id
      where r.id = ${resourceId} and r.host_account_id = ${actor.id} and a.status = 'active' and r.is_sample
      order by p.version desc limit 1 for update of r
    `;
    if (!sample) throw new CommandError("forbidden");
    if (sample.closed) return { sample: true, action: null };
    if (expectedRevision !== null) assertRevision(sample.revision, expectedRevision);
    if (input.version !== undefined && input.version !== sample.version) throw new CommandError("stale_revision");

    await tx`
      update app.requests set state = 'withdrawn', closed_at = now(), revision = revision + 1, updated_at = now()
      where id = ${resourceId}
    `;
    await enqueueButtonRetirement(tx, resourceId);
    return { sample: true, action: input.action ?? null };
  },
};
