import type { Actor, Database } from '../../database.ts';
import type { Environment } from '../../env.ts';
import { DomainError } from '../../errors.ts';
import { base64url, decryptSecret, encryptSecret, hashToken, randomToken } from '../../security.ts';
import {
  createGoogle,
  type GoogleCredential,
  type GoogleProvider,
  GUEST_SCOPES,
  HOST_SCOPES,
} from '../../providers/google.ts';
export interface Connection {
  connectionId: string;
  encryptedCredential: string;
  scopes: string[];
  conflictCalendarIds: string[];
  bookingCalendarId: string | null;
}
export function createOAuth(
  env: Environment,
  db: Database,
  google: GoogleProvider = createGoogle(env),
) {
  const encryptionKey = () => {
    if (!env.encryptionKey) throw new DomainError('provider_unavailable', 503);
    return env.encryptionKey;
  };
  const worker = (): Actor => ({ kind: 'worker', id: crypto.randomUUID() });
  return {
    async start(actor: Actor, idempotencyKey: string): Promise<{ url: string; cookie: string }> {
      if (!env.googleClientId) throw new DomainError('provider_unavailable', 503);
      const proposedState = randomToken();
      const proposedBinding = randomToken();
      const proposedVerifier = randomToken(48);
      const redirectUri = `${env.appOrigin}/api/google/callback`;
      const stored = await db.command<{ encryptedVerifier: string }>('oauth_start', actor, {
        stateHash: await hashToken(proposedState),
        bindingHash: await hashToken(proposedBinding),
        encryptedVerifier: await encryptSecret({
          state: proposedState,
          binding: proposedBinding,
          verifier: proposedVerifier,
        }, encryptionKey()),
        context: { redirectUri, ...(actor.requestId ? { requestId: actor.requestId } : {}) },
        idempotencyKey,
      });
      const { state, binding, verifier } = await decryptSecret<
        { state: string; binding: string; verifier: string }
      >(stored.encryptedVerifier, encryptionKey());
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      const challenge = base64url(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
      );
      url.search = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: (actor.kind === 'host' ? HOST_SCOPES : GUEST_SCOPES).join(' '),
        state,
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      const secure = new URL(env.appOrigin).protocol === 'https:' ? '; Secure' : '';
      return {
        url: url.toString(),
        cookie: `fmat_oauth_${
          state.slice(0, 16)
        }=${binding}; Path=/api/google/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
      };
    },
    async callback(request: Request): Promise<{ redirect: string; cookie: string }> {
      const url = new URL(request.url);
      const state = url.searchParams.get('state') || '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new DomainError('invalid_input');
      const name = `fmat_oauth_${state.slice(0, 16)}`;
      const binding = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((
        part,
      ) => part.startsWith(name + '='))?.slice(name.length + 1);
      if (!binding) throw new DomainError('unauthorized', 401);
      const exchange = await db.command<
        {
          actor: Actor;
          context: { redirectUri: string; requestId?: string };
          encryptedVerifier: string;
          exchangeId: string;
        }
      >('oauth_consume', { kind: 'public' }, {
        stateHash: await hashToken(state),
        bindingHash: await hashToken(binding),
      });
      const target = new URL(
        exchange.actor.kind === 'host' ? '/host/setup' : `/requests/${exchange.context.requestId}`,
        env.appOrigin,
      );
      const cookie = `${name}=; Path=/api/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${
        new URL(env.appOrigin).protocol === 'https:' ? '; Secure' : ''
      }`;
      if (url.searchParams.has('error')) {
        target.searchParams.set('calendar', 'denied');
        return { redirect: target.toString(), cookie };
      }
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new DomainError('invalid_input');
      const { verifier } = await decryptSecret<{ verifier: string }>(
        exchange.encryptedVerifier,
        encryptionKey(),
      );
      const credential = await google.exchange(code, verifier, exchange.context.redirectUri);
      const scopes = credential.scope.split(' ');
      const required = exchange.actor.kind === 'host'
        ? HOST_SCOPES.slice(2)
        : GUEST_SCOPES.slice(2);
      if (!required.every((scope) => scopes.includes(scope))) {
        throw new DomainError('reconnect_required', 409);
      }
      const providerSubject = await google.subject(credential);
      await db.command('credential_save', worker(), {
        exchangeId: exchange.exchangeId,
        encryptedCredential: await encryptSecret(credential, encryptionKey()),
        scopes,
        providerSubject,
      });
      target.searchParams.set('calendar', 'connected');
      return { redirect: target.toString(), cookie };
    },
    async credential(
      target: { hostId: string } | { requestId: string },
    ): Promise<{ connection: Connection; credential: GoogleCredential }> {
      const connection = await db.command<Connection>('connection_read', worker(), target);
      if (!connection?.encryptedCredential) throw new DomainError('reconnect_required', 409);
      let credential = await decryptSecret<GoogleCredential>(
        connection.encryptedCredential,
        encryptionKey(),
      );
      if (new Date(credential.expiresAt).getTime() < Date.now() + 60000) {
        credential = await google.refresh(credential);
        await db.command('token_update', worker(), {
          connectionId: connection.connectionId,
          encryptedCredential: await encryptSecret(credential, encryptionKey()),
        });
      }
      return { connection, credential };
    },
    google,
  };
}
