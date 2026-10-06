import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requiredEnv } from '../config.ts';
import { ApplicationError } from '../errors.ts';
import { supabaseOrigin, type Fetch } from '../database/client.ts';

type HostCredential = Readonly<{ kind: 'host'; subject: string; sessionId: string; expiresAt: string }>;
type GuestCredential = Readonly<{ kind: 'guest'; requestId: string; tokenHash: string }>;
export type Credential = HostCredential | GuestCredential;
// Prevent JSON-supplied actor/credential objects from crossing this boundary.
const issued = new WeakSet<object>();
function issue<T extends Credential>(credential: T): T {
  Object.freeze(credential); issued.add(credential); return credential;
}
export function requireCredential(value: Credential): void {
  if (!issued.has(value)) throw new ApplicationError('UNAUTHORIZED', 401);
}

const claimsSchema = z.object({
  sub: z.uuid(), session_id: z.uuid(), iss: z.string(),
  aud: z.literal('authenticated'), role: z.literal('authenticated'),
  exp: z.number().int().positive(), is_anonymous: z.boolean().optional(),
});
const userSchema = z.object({ id: z.uuid(), email: z.email(), email_confirmed_at: z.string().min(1) });

export async function verifyHostToken(token: string, options: { env?: NodeJS.ProcessEnv; fetcher?: Fetch; now?: number } = {}): Promise<Credential> {
  const env = options.env ?? process.env;
  const origin = supabaseOrigin(env);
  const now = options.now ?? Date.now();
  let claims: z.infer<typeof claimsSchema>;
  try {
    if (token.length > 16_384 || !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token)) throw new Error();
    claims = claimsSchema.parse(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')));
    if (claims.iss !== `${origin}/auth/v1` || claims.exp * 1000 <= now || claims.is_anonymous === true) throw new Error();
  } catch { throw new ApplicationError('UNAUTHORIZED', 401); }
  // Parsing above is only a rejection filter. Auth verifies the ORIGINAL token;
  // no principal is issued from decoded JWT claims or user_metadata alone.
  const key = requiredEnv('SUPABASE_PUBLISHABLE_KEY', env);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${origin}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new ApplicationError('PROVIDER_UNAVAILABLE', 503); }
  if (response.status === 401 || response.status === 403) throw new ApplicationError('UNAUTHORIZED', 401);
  if (!response.ok) throw new ApplicationError('PROVIDER_UNAVAILABLE', 503);
  let user: z.infer<typeof userSchema>;
  try { user = userSchema.parse(await response.json()); }
  catch { throw new ApplicationError('UNAUTHORIZED', 401); }
  if (user.id !== claims.sub) throw new ApplicationError('UNAUTHORIZED', 401);
  return issue({ kind: 'host', subject: user.id, sessionId: claims.session_id, expiresAt: new Date(claims.exp * 1000).toISOString() });
}

// Opaque guest tokens are validated against the current request in Postgres,
// not against a self-asserted email or a decoded client principal.
export function guestCredential(requestId: string, token: string): Credential {
  if (!z.uuid().safeParse(requestId).success || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new ApplicationError('UNAUTHORIZED', 401);
  }
  return issue({ kind: 'guest', requestId, tokenHash: createHash('sha256').update(token).digest('hex') });
}
