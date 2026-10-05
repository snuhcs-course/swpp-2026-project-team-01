import type { Actor, Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import {
  createHostIntentExtractor,
  type HostDraft,
  type HostIntent,
  validHostPatch,
} from '../../providers/host-intent.ts';
import type {
  CalendarOption,
  SetupConversationState,
  SetupState,
} from '../../../../../packages/contracts/index.ts';
export type ConversationState = SetupConversationState;
export function protectedSetupText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) {
    throw new DomainError('invalid_input');
  }
  return text.trim()
    .replace(/https?:\/\/[^\s<>]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        for (const name of [...url.searchParams.keys()]) {
          if (/token|code|state|secret|proof|recovery|invitation|credential/i.test(name)) {
            url.searchParams.delete(name);
          }
        }
        if (
          /token|code|state|secret|proof|recovery|invitation|imessage|credential/i.test(url.hash)
        ) url.hash = '';
        return url.toString();
      } catch {
        return '[protected link removed]';
      }
    })
    .replace(/\bLINK\s+[a-f\d-]{36}\s+[A-Za-z\d_-]{32,128}/gi, '[link proof removed]')
    .replace(
      /(?:[?#&]|\b)(?:token|code|state|secret|proof|recovery|invitation)=([^\s&#]+)/gi,
      '[credential removed]',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, '[credential removed]')
    .replace(/\b(?:sk-|sb_secret_|ya29\.)[A-Za-z0-9._-]+/g, '[credential removed]')
    .replace(
      /\b(?:invitation|invite|access|refresh|auth)[ _-]*token\s*[:=]\s*\S+/gi,
      '[credential removed]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credential removed]');
}
export function currentSetupAction(setup: SetupState): string {
  if (!setup.admitted) {
    return 'Sign in with your invited email and redeem your invitation in the protected website control.';
  }
  if (setup.nextAction === 'ready' && setup.profile?.ready) {
    return 'Your setup is ready. You can share your booking link.';
  }
  if (setup.nextAction === 'connect_calendar') {
    return 'Connect Google Calendar in this authenticated browser. Google consent must be completed on Google’s page.';
  }
  if (setup.nextAction === 'select_calendars') {
    return 'Choose your conflict calendars and a writable booking calendar in the website.';
  }
  return 'Describe your display name, booking handle, timezone, meeting duration, weekly meeting hours, buffer, travel mode and preferences. I will prepare a draft for your review.';
}
function clarification(intent: HostIntent): string {
  if (intent.unsupportedFields.length) {
    return 'That request includes settings I cannot change in setup. Use the supported settings controls or clarify your preferences.';
  }
  if (intent.ambiguousFields.length) {
    return 'Please clarify the requested preferences, including explicit dates, times and timezone where needed. Saved settings have not changed.';
  }
  return 'Review the draft below before any settings are saved.';
}
export function mapCalendarSelection(
  selection: NonNullable<HostIntent['calendarSelection']>,
  calendars: CalendarOption[],
) {
  const resolve = (name: string) => {
    const matches = calendars.filter((calendar) =>
      calendar.summary.toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    );
    if (matches.length !== 1) throw new DomainError('calendar_access_invalid');
    return matches[0];
  };
  const booking = resolve(selection.bookingCalendarLabel);
  if (!['owner', 'writer'].includes(booking.accessRole)) {
    throw new DomainError('calendar_permission');
  }
  return {
    conflictCalendarIds: [
      ...new Set(selection.conflictCalendarLabels.map((name) => resolve(name).id)),
    ],
    bookingCalendarId: booking.id,
  };
}
export function draftClarification(draft: HostDraft): string | null {
  if (!draft.displayName) return 'What name should people see on your booking page?';
  if (!draft.handle) {
    return 'What booking handle would you like? Use 3–40 lowercase letters, digits or hyphens, beginning with a letter.';
  }
  const rules = draft.rules || {};
  if (!rules.timezone) {
    return 'What timezone should your weekly meeting hours use? For example, Asia/Seoul.';
  }
  if (rules.durationMinutes === undefined) return 'How many minutes should each meeting last?';
  if (!rules.availability?.length) {
    return 'Which weekdays and exact start and end times should be available for meetings?';
  }
  if (rules.bufferMinutes === undefined) {
    return 'How many minutes of buffer do you want between meetings? Zero is allowed.';
  }
  if (rules.travelMode === undefined) {
    return 'For in-person travel, do you walk, cycle, drive or use public transit?';
  }
  if (rules.focusBlocks === undefined) {
    return 'Do you have specific focus periods to protect? Provide dates and times with timezone, or say no focus blocks.';
  }
  if (rules.preferences === undefined) {
    return 'Do you have any other scheduling preferences? You can say no additional preferences.';
  }
  return null;
}
export function createSetupConversation(
  env: Environment,
  db: Database,
  extract = createHostIntentExtractor(env),
  calendars?: (actor: Actor) => Promise<CalendarOption[]>,
) {
  const read = (actor: Actor, binding: Record<string, unknown> = {}) =>
    db.command<ConversationState>('setup_conversation_read', actor, binding);
  return {
    read,
    async append(
      actor: Actor,
      input: Record<string, unknown>,
      channel: 'web' | 'imessage' = 'web',
    ) {
      const text = protectedSetupText(input.text);
      if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) {
        throw new DomainError('invalid_input');
      }
      if (typeof input.clientTurnId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.clientTurnId)) {
        throw new DomainError('invalid_input');
      }
      const binding = actor.kind === 'worker'
        ? {
          provider: input.provider,
          senderId: input.senderId,
          privateConversationId: input.privateConversationId,
          isGroup: false,
        }
        : {};
      const replay = await db.command<ConversationState | null>('setup_turn_lookup', actor, {
        ...binding,
        clientTurnId: input.clientTurnId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        providerMessageId: input.providerMessageId,
        text,
        channel,
      });
      if (replay) return replay;
      const state = await read(actor, binding);
      if (state.revision !== input.expectedRevision) throw new DomainError('stale_revision', 409);

      if (!state.setup.admitted) throw new DomainError('not_admitted', 403);
      const settings = state.draft?.settings;
      const confirmationText = /^(yes|confirm|approve|book|CONFIRM \d+)$/i.test(text);
      const modelDraft: HostDraft = {
        handle: settings?.handle || undefined,
        displayName: settings?.displayName || undefined,
        rules: settings?.rules
          ? {
            ...settings.rules,
            preferences: settings.rules.preferences
              ? protectedSetupText(settings.rules.preferences.slice(0, 4000))
              : settings.rules.preferences,
            homeLocation: settings.rules.homeLocation
              ? protectedSetupText(settings.rules.homeLocation)
              : settings.rules.homeLocation,
          }
          : undefined,
      };
      const intent = confirmationText ? null : await extract(
        text,
        modelDraft,
        state.turns.slice(-8).map(({ role, text }) => ({
          role,
          text: protectedSetupText(text.slice(0, 4000)),
        })),
      );
      let assistantText = intent
        ? clarification(intent)
        : 'I could not interpret that safely. Your saved settings have not changed. Try again or use the structured setup controls.';
      if (confirmationText) {
        assistantText =
          'Settings are saved only after confirming the exact current review. Use the review button in the website, or reply CONFIRM followed by the current review number in iMessage.';
      }
      let calendarSelection: Record<string, unknown> | undefined;
      if (intent?.calendarSelection) {
        if (!state.setup.calendarConnected || !calendars) {
          assistantText = currentSetupAction({ ...state.setup, nextAction: 'connect_calendar' });
        } else {
          try {
            calendarSelection = mapCalendarSelection(
              intent.calendarSelection,
              await calendars(
                actor.kind === 'worker'
                  ? {
                    kind: 'host',
                    id: (await db.command<{ hostId: string }>(
                      'setup_channel_authorize',
                      actor,
                      binding,
                    )).hostId,
                  }
                  : actor,
              ),
            );
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            assistantText =
              'Please choose calendars in the website. Duplicate names or missing write permission need explicit selection.';
          }
        }
      }
      if (calendarSelection) {
        assistantText =
          'Please confirm your calendar choices using the protected calendar controls in the website. Chat preference confirmation saves scheduling rules only.';
      }
      const patch = intent?.patch || {};
      if (!validHostPatch(patch)) throw new DomainError('invalid_input');
      if (intent && !intent.ambiguousFields.length && !intent.unsupportedFields.length) {
        const question = draftClarification({
          handle: patch.handle || settings?.handle || undefined,
          displayName: patch.displayName || settings?.displayName || undefined,
          rules: { ...settings?.rules, ...patch.rules },
        });
        if (question) assistantText = question;
      }
      return await db.command<ConversationState>('setup_turn_append', actor, {
        ...binding,
        providerMessageId: input.providerMessageId,
        text,
        assistantText,
        extraction: {
          patch,
          clarification: intent?.clarification || '',
          ambiguousFields: intent?.ambiguousFields || [],
          unsupportedFields: intent?.unsupportedFields || [],
        },
        clientTurnId: input.clientTurnId,
        channel,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      });
    },
    async confirm(actor: Actor, input: Record<string, unknown>) {
      for (
        const key of [
          'expectedRevision',
          'reviewRevision',
          'expectedDraftRevision',
          'expectedRulesVersion',
        ]
      ) {
        if (
          !Number.isInteger(input[key]) ||
          Number(input[key]) < (key === 'expectedRulesVersion' ? 0 : 1)
        ) throw new DomainError('invalid_input');
      }
      return await db.command<ConversationState>('setup_review_confirm', actor, {
        providerMessageId: input.providerMessageId,
        ...(actor.kind === 'worker'
          ? {
            provider: input.provider,
            senderId: input.senderId,
            privateConversationId: input.privateConversationId,
            isGroup: false,
          }
          : {}),
        reviewRevision: input.reviewRevision,
        expectedRevision: input.expectedRevision,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedRulesVersion: input.expectedRulesVersion,
        idempotencyKey: input.idempotencyKey,
      });
    },
  };
}
