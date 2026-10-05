import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotonBridge, normalizeInbound } from '../src/bridge.mjs';

const messageEvent = (overrides = {}) => ({
  type: 'message.received',
  sequence: 7,
  chatGuid: 'any;-;+821012345678',
  message: {
    guid: 'provider-message-1',
    chatGuids: ['any;-;+821012345678'],
    sender: { address: '+821012345678', service: 'iMessage' },
    content: { text: 'Set me up on weekday afternoons' },
    dateCreated: new Date('2026-10-05T04:00:00.000Z'),
    isFromMe: false,
    itemType: 'normal',
    isForward: false,
    ...overrides,
  },
});

const directChat = (overrides = {}) => ({
  guid: 'any;-;+821012345678',
  isGroup: false,
  service: 'iMessage',
  participants: [{ address: '+821012345678', service: 'iMessage' }],
  ...overrides,
});

async function* events(values) {
  for (const value of values) yield value;
}

test('normalizes the actual private iMessage event shape', () => {
  assert.deepEqual(normalizeInbound(messageEvent(), directChat()), {
    accepted: true,
    value: {
      sequence: 7,
      providerMessageId: 'provider-message-1',
      conversationId: 'any;-;+821012345678',
      sender: '+821012345678',
      service: 'iMessage',
      body: 'Set me up on weekday afternoons',
      createdAt: '2026-10-05T04:00:00.000Z',
    },
  });
});

test('rejects groups, forged sender/service, forwarded content and chat mismatch', () => {
  const cases = [
    [messageEvent(), directChat({ isGroup: true, participants: [
      { address: '+821012345678', service: 'iMessage' },
      { address: '+821011111111', service: 'iMessage' },
    ] })],
    [messageEvent({ sender: { address: '+821099999999', service: 'iMessage' } }), directChat()],
    [messageEvent({ sender: { address: '+821012345678', service: 'SMS' } }), directChat()],
    [messageEvent({ isForward: true }), directChat()],
    [messageEvent({ chatGuids: ['other-chat'] }), directChat()],
  ];
  for (const [event, chat] of cases) assert.equal(normalizeInbound(event, chat).accepted, false);
});

test('serializes inbound events and lets the backend reuse replayed provider IDs after restart', async () => {
  const saved = new Set();
  const mutations = [];
  let active = 0;
  let maximumActive = 0;
  const backend = {
    resume: async () => ({ lastSequence: 0 }),
    checkpoint: async () => {},
    inbound: async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      if (!saved.has(input.providerMessageId)) {
        saved.add(input.providerMessageId);
        mutations.push(input.providerMessageId);
      }
      active -= 1;
      return { duplicate: mutations.length !== saved.size };
    },
    claimOutbound: async () => ({ action: 'none' }),
  };
  const replay = messageEvent();
  const second = messageEvent({ guid: 'provider-message-2', content: { text: 'Add a buffer' } });
  second.sequence = 8;
  const makeProvider = () => ({
    catchUp: () => events([replay, second]),
    subscribe: () => events([]),
    getChat: async () => directChat(),
    close: async () => {},
  });
  for (let restart = 0; restart < 2; restart += 1) {
    const bridge = new PhotonBridge({ backend, providerFactory: async () => makeProvider() });
    await bridge.start();
    await bridge.stop();
  }
  assert.deepEqual(mutations, ['provider-message-1', 'provider-message-2']);
  assert.equal(maximumActive, 1);
});

test('checkpoints a group without exposing its body to the backend', async () => {
  const checkpoints = [];
  let inboundCalls = 0;
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      checkpoint: async (...args) => checkpoints.push(args),
      inbound: async () => { inboundCalls += 1; },
    },
    providerFactory: async () => ({
      catchUp: () => events([messageEvent()]),
      subscribe: () => events([]),
      getChat: async () => directChat({ isGroup: true }),
      close: async () => {},
    }),
  });
  await bridge.start();
  assert.equal(inboundCalls, 0);
  assert.deepEqual(checkpoints, [[7, 'group_or_identity_mismatch']]);
});

const claim = {
  action: 'dispatch',
  intentId: 'intent-1',
  conversationId: 'any;-;+821012345678',
  clientMessageId: 'stable-client-message-1',
  body: 'Please confirm these settings',
  createdAt: '2026-10-05T04:00:00.000Z',
};

test('rechecks authority after claim and suppresses an outbound send after unlink', async () => {
  const outcomes = [];
  let sends = 0;
  const provider = {
    catchUp: () => events([]),
    subscribe: () => events([]),
    close: async () => {},
    sendText: async () => { sends += 1; },
  };
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      claimOutbound: async () => claim,
      authorizeOutbound: async () => ({ authorized: false }),
      recordOutcome: async (value) => outcomes.push(value),
    },
    providerFactory: async () => provider,
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  assert.equal(sends, 0);
  assert.deepEqual(outcomes, [{ intentId: 'intent-1', status: 'revoked' }]);
});

test('records a lost send response as uncertain and reconciles a persisted provider identity without resending', async () => {
  const outcomes = [];
  let sends = 0;
  let currentClaim = claim;
  const provider = {
    catchUp: () => events([]),
    subscribe: () => events([]),
    getChat: async () => directChat(),
    close: async () => {},
    sendText: async () => {
      sends += 1;
      const error = new Error('deadline');
      error.code = 'timeout';
      error.retryable = true;
      throw error;
    },
    listOutbound: async () => ({ messages: [{
      guid: 'provider-outbound-1',
      isFromMe: true,
      isDelivered: true,
      content: { text: claim.body },
      chatGuids: [claim.conversationId],
      dateCreated: new Date('2026-10-05T04:00:01.000Z'),
    }] }),
  };
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      claimOutbound: async () => currentClaim,
      authorizeOutbound: async () => ({
        authorized: true,
        conversationId: claim.conversationId,
        clientMessageId: claim.clientMessageId,
      }),
      recordOutcome: async (value) => outcomes.push(value),
    },
    providerFactory: async () => provider,
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  currentClaim = { ...claim, action: 'reconcile', providerMessageId: 'provider-outbound-1' };
  await bridge.pollOutboundOnce();
  assert.equal(sends, 1);
  assert.equal(outcomes[0].status, 'uncertain');
  assert.deepEqual(outcomes[1], {
    intentId: 'intent-1',
    status: 'delivered',
    providerMessageId: 'provider-outbound-1',
    acceptedAt: '2026-10-05T04:00:01.000Z',
  });
});

test('preserves uncertainty when targeted history is empty or ambiguous', async () => {
  for (const messages of [[], [
    { guid: 'one', isFromMe: true, content: { text: claim.body }, chatGuids: [claim.conversationId] },
    { guid: 'two', isFromMe: true, content: { text: claim.body }, chatGuids: [claim.conversationId] },
  ]]) {
    const outcomes = [];
    let sends = 0;
    const provider = {
      catchUp: () => events([]),
      subscribe: () => events([]),
      getChat: async () => directChat(),
      close: async () => {},
      sendText: async () => { sends += 1; },
      listOutbound: async () => ({ messages }),
    };
    const bridge = new PhotonBridge({
      backend: {
        resume: async () => ({ lastSequence: 0 }),
        claimOutbound: async () => ({ ...claim, action: 'reconcile' }),
        authorizeOutbound: async () => ({
          authorized: true,
          conversationId: claim.conversationId,
          clientMessageId: claim.clientMessageId,
        }),
        recordOutcome: async (value) => outcomes.push(value),
      },
      providerFactory: async () => provider,
    });
    await bridge.start();
    await bridge.pollOutboundOnce();
    assert.equal(sends, 0);
    assert.equal(outcomes[0].status, 'uncertain');
  }
});

test('does not checkpoint transient chat lookup failures and replays on reconnect', async () => {
  const checkpoints = [];
  const inbound = [];
  let fail = true;
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      checkpoint: async (...args) => checkpoints.push(args),
      inbound: async (value) => inbound.push(value.providerMessageId),
    },
    providerFactory: async () => ({
      catchUp: () => events([messageEvent()]),
      subscribe: () => events([]),
      getChat: async () => { if (fail) throw new Error('temporary'); return directChat(); },
      close: async () => {},
    }),
  });
  await assert.rejects(bridge.start(), /chat_lookup_failed/);
  fail = false;
  await bridge.start();
  assert.deepEqual(checkpoints, [[7, 'processed']]);
  assert.deepEqual(inbound, ['provider-message-1']);
  assert.equal(bridge.health.ready, false);
  await bridge.stop();
});

test('keeps same-text history uncertain without an authoritative provider identity', async () => {
  const outcomes = [];
  let sends = 0;
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      claimOutbound: async () => ({ ...claim, action: 'reconcile' }),
      authorizeOutbound: async () => ({ authorized: true,
        conversationId: claim.conversationId, clientMessageId: claim.clientMessageId }),
      recordOutcome: async (value) => outcomes.push(value),
    },
    providerFactory: async () => ({
      catchUp: () => events([]), subscribe: () => events([]), close: async () => {},
      sendText: async () => { sends += 1; },
      listOutbound: async () => ({ messages: [{ guid: 'unbound-other-send',
        isFromMe: true, content: { text: claim.body }, chatGuids: [claim.conversationId],
        dateCreated: new Date(claim.createdAt) }] }),
    }),
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  assert.equal(sends, 0);
  assert.equal(outcomes[0].status, 'uncertain');
  assert.equal(outcomes[0].error.code, 'unbound_provider_identity');
  await bridge.stop();
});

test('shutdown closes a provider that finishes initialization after stopping', async () => {
  let release;
  let closed = 0;
  let resumed = 0;
  const bridge = new PhotonBridge({
    backend: { resume: async () => { resumed += 1; } },
    providerFactory: () => new Promise((resolve) => { release = resolve; }),
  });
  const starting = bridge.start();
  await Promise.resolve();
  await bridge.stop();
  release({ close: async () => { closed += 1; } });
  await starting;
  assert.equal(closed, 1);
  assert.equal(resumed, 0);
  assert.equal(bridge.health.live, false);
});

test('dispatches the persisted client identity once and records the bound provider response', async () => {
  const sends = [];
  const outcomes = [];
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      claimOutbound: async () => claim,
      authorizeOutbound: async () => ({ authorized: true,
        conversationId: claim.conversationId, clientMessageId: claim.clientMessageId }),
      recordOutcome: async (value) => outcomes.push(value),
    },
    providerFactory: async () => ({
      catchUp: () => events([]), subscribe: () => events([]), close: async () => {},
      sendText: async (...args) => { sends.push(args); return {
        guid: 'bound-provider-guid', isFromMe: true, isDelivered: false,
        chatGuids: [claim.conversationId], content: { text: claim.body },
      }; },
    }),
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  assert.deepEqual(sends, [[claim.conversationId, claim.body, claim.clientMessageId]]);
  assert.equal(outcomes[0].status, 'accepted');
  assert.equal(outcomes[0].providerMessageId, 'bound-provider-guid');
  await bridge.stop();
});

test('persists a validated provider identity after backend acknowledgement failure and reconciles without another send', async () => {
  let currentClaim = claim;
  let sends = 0;
  let rejectedAcknowledgement = false;
  const outcomes = [];
  const message = {
    guid: 'validated-known-provider-id', isFromMe: true, isDelivered: true,
    chatGuids: [claim.conversationId], content: { text: claim.body },
    dateCreated: new Date('2026-10-05T04:00:01.000Z'),
  };
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }),
      claimOutbound: async () => currentClaim,
      authorizeOutbound: async () => ({ authorized: true,
        conversationId: claim.conversationId, clientMessageId: claim.clientMessageId }),
      recordOutcome: async (value) => {
        if (value.status === 'delivered' && !rejectedAcknowledgement) {
          rejectedAcknowledgement = true;
          throw Object.assign(new Error('backend deadline'), { code: 'timeout' });
        }
        outcomes.push(value);
        if (value.status === 'uncertain') currentClaim = {
          ...claim, action: 'reconcile', providerMessageId: value.providerMessageId,
        };
      },
    },
    providerFactory: async () => ({
      catchUp: () => events([]), subscribe: () => events([]), close: async () => {},
      sendText: async () => { sends += 1; return message; },
      listOutbound: async () => ({ messages: [message] }),
    }),
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  assert.equal(outcomes[0].status, 'uncertain');
  assert.equal(outcomes[0].providerMessageId, message.guid);
  await bridge.pollOutboundOnce();
  assert.equal(sends, 1);
  assert.equal(outcomes[1].status, 'delivered');
  assert.equal(outcomes[1].providerMessageId, message.guid);
  await bridge.stop();
});

test('never persists a provider identity from a mismatched send response', async () => {
  const outcomes = [];
  const bridge = new PhotonBridge({
    backend: {
      resume: async () => ({ lastSequence: 0 }), claimOutbound: async () => claim,
      authorizeOutbound: async () => ({ authorized: true,
        conversationId: claim.conversationId, clientMessageId: claim.clientMessageId }),
      recordOutcome: async (value) => outcomes.push(value),
    },
    providerFactory: async () => ({
      catchUp: () => events([]), subscribe: () => events([]), close: async () => {},
      sendText: async () => ({ guid: 'untrusted-provider-id', isFromMe: true,
        chatGuids: ['different-chat'], content: { text: claim.body } }),
    }),
  });
  await bridge.start();
  await bridge.pollOutboundOnce();
  assert.equal(outcomes[0].status, 'uncertain');
  assert.equal('providerMessageId' in outcomes[0], false);
  await bridge.stop();
});
