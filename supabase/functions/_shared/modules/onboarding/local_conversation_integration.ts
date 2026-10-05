// Real local Auth/RPC/HTTP journey with fixture model and Google transports; no external sends.
// Run: deno run --allow-read=/tmp/fmat-local-status.json --allow-env \
//   --allow-net=127.0.0.1:54321 supabase/functions/_shared/modules/onboarding/local_conversation_integration.ts
// deno-lint-ignore no-import-prefix
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createDatabase } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { errorResponse } from '../../errors.ts';
import { hashToken, randomToken } from '../../security.ts';
import { createGoogle, HOST_SCOPES } from '../../providers/google.ts';
import type { HostDraft, HostIntent } from '../../providers/host-intent.ts';
import { onboardingRoutes } from '../../../api/routes/onboarding.ts';
import { createOAuth } from './oauth.ts';
import { mapCalendarSelection } from './conversation.ts';
import type {
  CalendarOption,
  HostProfile,
  HostRules,
  SetupConversationState,
  SetupState,
} from '../../../../../packages/contracts/index.ts';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const status = JSON.parse(await Deno.readTextFile('/tmp/fmat-local-status.json'));
check(status.API_URL === 'http://127.0.0.1:54321', 'Disposable loopback stack required');
const env: Environment = {
  supabaseUrl: status.API_URL,
  serviceKey: status.SECRET_KEY || status.SERVICE_ROLE_KEY,
  appOrigin: 'http://localhost:5173',
  workerSecret: randomToken(),
  encryptionKey: btoa('c'.repeat(32)),
  googleClientId: 'fixture-google-client',
  googleClientSecret: 'fixture-google-secret',
  openaiKey: 'fixture-model-key',
  openaiModel: 'gpt-4o-mini-2024-07-18',
  photonBridgeEnabled: true,
  photonBridgeSecret: randomToken(),
  externalSends: false,
};
const suffix = crypto.randomUUID().slice(0, 8);
const handle = `chat-${suffix}`;
const email = `conversation-${crypto.randomUUID()}@example.invalid`;
const rules: HostRules = {
  timezone: 'Asia/Seoul',
  durationMinutes: 30,
  availability: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
  focusBlocks: [],
  bufferMinutes: 15,
  travelMode: 'TRANSIT',
  preferences: '',
};
const calendarOptions: CalendarOption[] = [
  { id: 'fixture-work', summary: 'Work', accessRole: 'owner' },
  { id: 'fixture-holidays', summary: 'Holidays', accessRole: 'reader' },
];
const intents: Record<string, { patch: HostDraft; selection?: HostIntent['calendarSelection'] }> = {
  'Call me Conversation Host': { patch: { displayName: 'Conversation Host' } },
  'Use my explicit weekday settings': { patch: { handle, rules } },
  'Change buffer to twenty minutes': { patch: { rules: { bufferMinutes: 20 } } },
  'Use Work and Holidays, booking into Work': {
    patch: {},
    selection: { conflictCalendarLabels: ['Work', 'Holidays'], bookingCalendarLabel: 'Work' },
  },
};
let modelCalls = 0;
let googleCalls = 0;
const nativeFetch = globalThis.fetch;
// The route uses its normal model adapter. Only its transport is replaced; database/Auth stay real.
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === 'https://api.openai.com/v1/chat/completions') {
    const body = JSON.parse(String(init?.body));
    const prompt = JSON.parse(body.messages[1].content);
    const fixture = intents[prompt.message];
    check(fixture, 'Unexpected model fixture request');
    check(
      !JSON.stringify(prompt).includes(env.photonBridgeSecret!),
      'Bridge credential reached model',
    );
    modelCalls++;
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            clarification: 'Review the exact settings before saving.',
            handle: fixture.patch.handle ?? null,
            displayName: fixture.patch.displayName ?? null,
            rules: {
              timezone: null,
              durationMinutes: null,
              bufferMinutes: null,
              travelMode: null,
              homeLocation: null,
              preferences: null,
              availability: null,
              focusBlocks: null,
              ...fixture.patch.rules,
            },
            calendarSelection: fixture.selection ?? null,
            ambiguousFields: [],
            unsupportedFields: [],
          }),
        },
      }],
    });
  }
  check(url.origin === status.API_URL, 'External network request prohibited');
  return await nativeFetch(input, init);
};
const google = createGoogle(env, (input, init) => {
  const url = new URL(String(input));
  googleCalls++;
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(init?.body));
    check(body.get('code') === 'fixture-google-code', 'Unexpected OAuth code');
    check(!!body.get('code_verifier'), 'OAuth PKCE verifier missing');
    return Promise.resolve(Response.json({
      access_token: 'fixture-google-access',
      refresh_token: 'fixture-google-refresh',
      expires_in: 3600,
      scope: HOST_SCOPES.join(' '),
    }));
  }
  if (url.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
    return Promise.resolve(Response.json({ sub: `fixture-subject-${suffix}` }));
  }
  check(
    url.pathname === '/calendar/v3/users/me/calendarList',
    'Unexpected Google fixture operation',
  );
  return Promise.resolve(Response.json({ items: calendarOptions }));
});

try {
  const auth = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = randomToken();
  const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
  check(!created.error && created.data.user, 'Local confirmed fixture account creation failed');
  const signedIn = await auth.auth.signInWithPassword({ email, password });
  check(!signedIn.error && signedIn.data.session, 'Local fixture sign-in failed');
  const bearer = signedIn.data.session.access_token;
  const db = createDatabase(env);
  const host = await db.host(bearer);
  check(
    host.id === created.data.user.id && host.email === email,
    'Verified host identity mismatch',
  );
  const app = onboardingRoutes(env, db, createOAuth(env, db, google));
  app.onError((error) => errorResponse(error, 'local-conversation-integration'));
  const call = async <T>(path: string, body?: unknown, expectedStatus = 200, bridge = false) => {
    const response = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomToken(),
        Authorization: `Bearer ${bridge ? env.photonBridgeSecret : bearer}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    check(
      response.status === expectedStatus,
      `HTTP ${response.status} instead of ${expectedStatus}: ${result.error?.code || path}`,
    );
    return result as T;
  };
  const webRead = () => call<SetupConversationState>('/host/setup/conversation');
  const webTurn = (state: SetupConversationState, text: string) =>
    call<SetupConversationState>('/host/setup/conversation/messages', {
      text,
      expectedRevision: state.revision,
      clientTurnId: crypto.randomUUID(),
    });
  const confirmation = (state: SetupConversationState) => {
    check(state.review?.status === 'pending' && state.draft, 'Current review required');
    return {
      expectedRevision: state.revision,
      reviewRevision: state.review.revision,
      expectedDraftRevision: state.draft.revision,
      expectedRulesVersion: state.draft.baseRulesVersion,
    };
  };
  const unadmitted = await call<SetupState>('/host/setup');
  check(!unadmitted.admitted, 'Sign-in bypassed invitation admission');
  await call('/host/setup/conversation', undefined, 403);
  const invitation = randomToken();
  await db.command('invite_issue', { kind: 'operator', id: 'local-conversation-fixture' }, {
    email,
    tokenHash: await hashToken(invitation),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    idempotencyKey: randomToken(),
  });
  const admitted = await call<SetupState>('/host/invitations/redeem', { token: invitation });
  check(admitted.admitted && !admitted.profile?.ready, 'Admission unexpectedly completed setup');
  let state = await webRead();
  const conversationId = state.id;
  check(state.revision === 0 && !state.turns.length, 'Fresh conversation mismatch');
  state = await webTurn(state, 'Call me Conversation Host');
  check(!state.review && !state.setup.rules, 'Partial profile silently saved');
  check(state.turns.at(-1)?.text.includes('booking handle'), 'Next missing-field prompt absent');
  state = await webTurn(state, 'Use my explicit weekday settings');
  check(state.review?.status === 'pending' && !state.setup.rules, 'Draft bypassed explicit review');
  const obsoleteConfirmation = confirmation(state);

  const link = await call<{ challengeId: string; browserProof: string; challengeText: string }>(
    '/host/imessage/link/start',
    {},
  );
  await call('/host/imessage/link/confirm', {
    challengeId: link.challengeId,
    browserProof: link.browserProof,
  }, 400);
  const sender = `+1555${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(10, '0')}`;
  let sequence = 1;
  const inbound = (body: string) =>
    call(
      '/internal/setup/imessage/inbound',
      {
        sequence: sequence++,
        providerMessageId: `fixture-message-${crypto.randomUUID()}`,
        conversationId: `any;-;${sender}`,
        sender,
        service: 'iMessage',
        body,
        createdAt: new Date().toISOString(),
      },
      200,
      true,
    );
  await inbound(link.challengeText);
  const observed = await call<{ challenge: { claimed: boolean; senderLabel: string } }>(
    '/host/imessage/link',
  );
  check(observed.challenge.claimed && observed.challenge.senderLabel, 'Private proof not visible');
  state = await call<SetupConversationState>('/host/imessage/link/confirm', {
    challengeId: link.challengeId,
    browserProof: link.browserProof,
  });
  check(state.id === conversationId && state.channelLink, 'Link replaced website conversation');
  await inbound('Change buffer to twenty minutes');
  state = await webRead();
  check(
    state.id === conversationId && state.draft?.settings.rules?.bufferMinutes === 20 &&
      !state.setup.rules && state.turns.some((turn) => turn.channel === 'imessage'),
    'Website did not resume unsaved private-channel draft',
  );
  const rejected = await call<{ error: { code: string } }>(
    '/host/setup/conversation/confirm',
    obsoleteConfirmation,
    409,
  );
  check(rejected.error.code === 'conversation_stale', 'Stale review rejection mismatch');
  check(!(await webRead()).setup.rules, 'Stale confirmation mutated persisted rules');
  const beforeConfirmModelCalls = modelCalls;
  await inbound(`CONFIRM ${confirmation(state).reviewRevision}`);
  state = await webRead();
  check(
    state.review?.status === 'confirmed' && state.setup.rules?.bufferMinutes === 20 &&
      !state.setup.profile?.ready && state.setup.nextAction === 'connect_calendar',
    'Private explicit confirmation did not preserve remaining Google action',
  );
  check(modelCalls === beforeConfirmModelCalls, 'Explicit confirmation incorrectly invoked model');

  const connection = await app.request('/host/google/connect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Idempotency-Key': randomToken() },
  });
  check(connection.ok, 'Protected browser OAuth initiation failed');
  const { url } = await connection.json();
  const googleUrl = new URL(url);
  check(googleUrl.origin === 'https://accounts.google.com', 'Google consent authority mismatch');
  const oauthState = googleUrl.searchParams.get('state');
  const cookie = connection.headers.get('set-cookie')?.split(';')[0];
  check(oauthState && cookie, 'Browser OAuth binding missing');
  const callback = await app.request(
    `/google/callback?state=${oauthState}&code=fixture-google-code`,
    {
      headers: { Cookie: cookie },
    },
  );
  check(callback.status === 303, 'Fixture browser callback failed');
  state = await webRead();
  check(
    state.setup.calendarConnected && !state.setup.profile?.ready &&
      state.setup.nextAction === 'select_calendars',
    'Calendar grant skipped protected calendar selection',
  );
  await inbound('Use Work and Holidays, booking into Work');
  state = await webRead();
  check(
    !state.setup.bookingCalendarId && state.turns.at(-1)?.text.includes('protected calendar'),
    'Calendar labels granted mutation authority through chat',
  );
  const available = await call<{ calendars: CalendarOption[] }>('/host/calendars');
  const selection = mapCalendarSelection(
    intents['Use Work and Holidays, booking into Work'].selection!,
    available.calendars,
  );
  const ready = await call<SetupState>('/host/calendar-settings', selection);
  check(
    ready.profile?.ready && ready.nextAction === 'ready',
    'Protected calendar selection not ready',
  );
  state = await webRead();
  const calendarStale = await call<{ error: { code: string } }>(
    '/host/setup/conversation/confirm',
    confirmation(state),
    409,
  );
  check(
    calendarStale.error.code === 'rules_stale',
    'Calendar change did not invalidate old review',
  );
  state = await webTurn(state, 'Change buffer to twenty minutes');
  state = await call<SetupConversationState>(
    '/host/setup/conversation/confirm',
    confirmation(state),
  );
  check(
    state.id === conversationId && state.setup.profile?.ready &&
      state.review?.status === 'confirmed' && state.setup.rules?.bufferMinutes === 20,
    'Final website resume lost confirmed rules/readiness',
  );
  const publicHost = await call<HostProfile>(`/hosts/${handle}`);
  check(
    publicHost.ready && publicHost.id === host.id && publicHost.handle === handle &&
      !('rules' in publicHost) && !('turns' in publicHost) &&
      !JSON.stringify(publicHost).includes('fixture-google'),
    'Public ready profile mismatch or private data leak',
  );
  await call('/host/imessage/unlink', { linkId: state.channelLink!.id });
  const resumed = await webRead();
  check(
    resumed.id === conversationId && !resumed.channelLink,
    'Unlink lost durable website transcript',
  );
  check(modelCalls === 5 && googleCalls >= 4, 'Expected fixture provider path not exercised');
  await auth.auth.signOut();
  console.log(
    'PASS: local verified Auth + real RPC/HTTP invitation admission, partial draft prompt, exact review, website→private proof/browser opt-in→iMessage edit/confirm→website resume, stale confirmation rejection, bound fixture Google consent/credential/calendar labels/protected selection/readiness, unlink; no external provider calls or messages',
  );
} finally {
  globalThis.fetch = nativeFetch;
}
