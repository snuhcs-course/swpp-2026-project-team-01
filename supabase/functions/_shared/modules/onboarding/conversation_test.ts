import {
  createSetupConversation,
  draftClarification,
  mapCalendarSelection,
  protectedSetupText,
} from './conversation.ts';
import type { Actor, Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import type { HostRules, SetupConversationState } from '../../../../../packages/contracts/index.ts';
const env = { openaiModel: 'fixture' } as Environment;
const actor: Actor = { kind: 'host', id: 'verified-host' };
const rules: HostRules = {
  timezone: 'Asia/Seoul',
  durationMinutes: 30,
  bufferMinutes: 10,
  availability: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
  focusBlocks: [],
  travelMode: 'WALK',
  preferences: '',
};
const state: SetupConversationState = {
  id: 'conversation',
  revision: 2,
  turns: [],
  draft: {
    revision: 1,
    baseRulesVersion: 0,
    settings: { handle: 'tester', displayName: 'Tester', rules },
    unresolved: [],
    status: 'active',
    createdAt: '2030-01-01',
  },
  review: null,
  setup: {
    admitted: true,
    profile: null,
    rules: null,
    calendarConnected: false,
    conflictCalendarIds: [],
    bookingCalendarId: null,
    nextAction: 'confirm_rules',
  },
  channelLink: null,
};
function assert(value: unknown) {
  if (!value) throw new Error('Assertion failed');
}
Deno.test('setup message model failure saves safe turn but never confirmed settings', async () => {
  const calls: string[] = [];
  let input: Record<string, unknown> = {};
  const db = {
    command: (op: string, _actor: Actor, value: Record<string, unknown>) => {
      calls.push(op);
      if (op === 'setup_turn_lookup') return Promise.resolve(null);
      if (op === 'setup_turn_append') input = value;
      return Promise.resolve(state);
    },
  } as unknown as Database;
  await createSetupConversation(env, db, () => Promise.resolve(null)).append(actor, {
    text: 'Schedule weekdays',
    expectedRevision: 2,
    clientTurnId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'turn-key',
  });
  assert(calls.join(',') === 'setup_turn_lookup,setup_conversation_read,setup_turn_append');
  assert(JSON.stringify(input.extraction).includes('"patch":{}') && !calls.includes('setup_save'));
});
Deno.test('setup cached retry returns original state before model or stale checks', async () => {
  let extracted = false;
  const db = { command: () => Promise.resolve(state) } as unknown as Database;
  const result = await createSetupConversation(env, db, () => {
    extracted = true;
    return Promise.resolve(null);
  }).append(actor, {
    text: 'Schedule weekdays',
    expectedRevision: 1,
    clientTurnId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'turn-key',
  });
  assert(result === state && !extracted);
});
Deno.test('stale setup draft never reaches model or append', async () => {
  let extracted = false;
  let appended = false;
  const db = {
    command: (op: string) => {
      if (op === 'setup_turn_append') appended = true;
      return Promise.resolve(op === 'setup_turn_lookup' ? null : state);
    },
  } as unknown as Database;
  try {
    await createSetupConversation(env, db, () => {
      extracted = true;
      return Promise.resolve(null);
    }).append(actor, {
      text: 'Schedule weekdays',
      expectedRevision: 1,
      clientTurnId: '11111111-1111-4111-8111-111111111111',
    });
    throw new Error('Missing conflict');
  } catch (error) {
    assert((error as { code?: string }).code === 'stale_revision');
  }
  assert(!extracted && !appended);
});
Deno.test('calendar labels disambiguate duplicates and require actual write role', () => {
  for (
    const options of [[{ id: 'one', summary: 'Work', accessRole: 'reader' }], [{
      id: 'one',
      summary: 'Work',
      accessRole: 'owner',
    }, { id: 'two', summary: 'Work', accessRole: 'owner' }]]
  ) {
    let rejected = false;
    try {
      mapCalendarSelection(
        { conflictCalendarLabels: ['Work'], bookingCalendarLabel: 'Work' },
        options,
      );
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
  assert(
    mapCalendarSelection({ conflictCalendarLabels: ['Work'], bookingCalendarLabel: 'Work' }, [{
      id: 'one',
      summary: 'Work',
      accessRole: 'owner',
    }]).bookingCalendarId === 'one',
  );
});
Deno.test('protected setup text strips credentials and retains normal scheduling context', () => {
  const text = protectedSetupText(
    'Meet October 6 at 14:00 in Seoul. https://findmeatime.com/host/setup?code=secretcode&state=secretstate#token=secrettoken Bearer privatejwt LINK 11111111-1111-4111-8111-111111111111 ' +
      'x'.repeat(64) + ' https://findmeatime.com/#imessage=id&proof=privateproof',
  );
  assert(
    text.includes('October 6 at 14:00') && !text.includes('secretcode') &&
      !text.includes('secrettoken') && !text.includes('privatejwt') &&
      !text.includes('privateproof') && !text.includes('x'.repeat(64)),
  );
});
Deno.test('linked calendar label lookup resolves authorized host and never service actor id', async () => {
  const connected = { ...state, setup: { ...state.setup, calendarConnected: true } };
  let calendarHost = '';
  let saved = false;
  const db = {
    command: (op: string, _actor: Actor, input: Record<string, unknown>) => {
      if (op === 'setup_turn_lookup') return Promise.resolve(null);
      if (op === 'setup_channel_authorize') {
        assert(input.senderId === '+821012345678');
        return Promise.resolve({ hostId: 'linked-host' });
      }
      if (op === 'setup_turn_append') {
        saved = true;
        assert(input.privateConversationId === 'any;-;+821012345678');
      }
      return Promise.resolve(connected);
    },
  } as unknown as Database;
  const service = createSetupConversation(
    env,
    db,
    () =>
      Promise.resolve({
        patch: {},
        clarification: 'Review calendars',
        ambiguousFields: [],
        unsupportedFields: [],
        calendarSelection: { conflictCalendarLabels: ['Work'], bookingCalendarLabel: 'Work' },
      }),
    (actor) => {
      calendarHost = actor.id!;
      return Promise.resolve([{ id: 'work', summary: 'Work', accessRole: 'owner' }]);
    },
  );
  await service.append({ kind: 'worker', id: 'photon-service' }, {
    text: 'Use Work calendar',
    expectedRevision: 2,
    clientTurnId: '11111111-1111-4111-8111-111111111111',
    provider: 'imessage',
    senderId: '+821012345678',
    privateConversationId: 'any;-;+821012345678',
  }, 'imessage');
  assert(calendarHost === 'linked-host' && saved);
});
Deno.test('bare confirmation never reaches model or creates settings authority', async () => {
  let extracted = false;
  let captured: Record<string, unknown> = {};
  const db = {
    command: (op: string, _actor: Actor, input: Record<string, unknown>) => {
      if (op === 'setup_turn_lookup') return Promise.resolve(null);
      if (op === 'setup_turn_append') captured = input;
      return Promise.resolve(state);
    },
  } as unknown as Database;
  await createSetupConversation(env, db, () => {
    extracted = true;
    return Promise.resolve(null);
  }).append(actor, {
    text: 'yes',
    expectedRevision: 2,
    clientTurnId: '11111111-1111-4111-8111-111111111111',
  });
  assert(!extracted && String(captured.assistantText).includes('exact current review'));
});

Deno.test('partial setup drafts ask the next missing explicit value without inventing defaults', () => {
  assert(
    draftClarification({
      displayName: 'Tester',
      handle: 'tester',
      rules: { timezone: 'Asia/Seoul' },
    })?.includes('minutes should each meeting'),
  );
  assert(
    draftClarification({
      displayName: 'Tester',
      handle: 'tester',
      rules: { ...rules, focusBlocks: undefined },
    })?.includes('no focus blocks'),
  );
  assert(draftClarification({ displayName: 'Tester', handle: 'tester', rules }) === null);
});

Deno.test('setup replies cannot repeat model claims of success in another language', async () => {
  let saved: Record<string, unknown> = {};
  const db = {
    command: (op: string, _actor: Actor, input: Record<string, unknown>) => {
      if (op === 'setup_turn_lookup') return Promise.resolve(null);
      if (op === 'setup_turn_append') saved = input;
      return Promise.resolve(state);
    },
  } as unknown as Database;
  await createSetupConversation(
    env,
    db,
    () =>
      Promise.resolve({
        patch: {},
        clarification: '설정이 저장되었습니다. 예약이 완료되었습니다.',
        ambiguousFields: [],
        unsupportedFields: [],
        calendarSelection: null,
      }),
  ).append(actor, {
    text: 'Tell me what is next',
    expectedRevision: 2,
    clientTurnId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: 'safe-status',
  });
  assert(
    !/저장|완료/.test(String(saved.assistantText)) &&
      String(saved.assistantText).includes('Review the draft'),
  );
});
