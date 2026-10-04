import type { Environment } from '../env.ts';
import { DomainError } from '../errors.ts';
import { type Fetcher, providerJson } from './transport.ts';
import type { CalendarOption } from '../../../../packages/contracts/index.ts';
export const HOST_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
export const GUEST_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
export interface GoogleCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
}
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}
export function createGoogle(env: Environment, fetcher: Fetcher = fetch) {
  const config = () => {
    if (!env.googleClientId || !env.googleClientSecret) {
      throw new DomainError('provider_unavailable', 503);
    }
    return { client_id: env.googleClientId, client_secret: env.googleClientSecret };
  };
  const token = async (
    body: Record<string, string>,
    previous?: GoogleCredential,
  ): Promise<GoogleCredential> => {
    const { data } = await providerJson<TokenResponse>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...config(), ...body }),
    }, fetcher).catch((error) => {
      if (error instanceof DomainError && error.code === 'provider_rejected') {
        throw new DomainError('reconnect_required', 409);
      }
      throw error;
    });
    if (
      !data.access_token || !Number.isFinite(data.expires_in) ||
      (!data.refresh_token && !previous?.refreshToken)
    ) throw new DomainError('reconnect_required', 409);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || previous!.refreshToken,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      scope: data.scope || previous?.scope || '',
    };
  };
  const get = <T>(url: string, credential: GoogleCredential) =>
    providerJson<T>(
      url,
      { headers: { Authorization: `Bearer ${credential.accessToken}` } },
      fetcher,
    );
  return {
    async exchange(code: string, verifier: string, redirectUri: string) {
      return await token({
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
    },
    async refresh(credential: GoogleCredential) {
      return await token(
        { refresh_token: credential.refreshToken, grant_type: 'refresh_token' },
        credential,
      );
    },
    async subject(credential: GoogleCredential): Promise<string> {
      const { data } = await get<{ sub: string }>(
        'https://openidconnect.googleapis.com/v1/userinfo',
        credential,
      );
      if (!data.sub) throw new DomainError('provider_rejected', 409);
      return data.sub;
    },
    async calendars(credential: GoogleCredential): Promise<CalendarOption[]> {
      const calendars: CalendarOption[] = [];
      let next: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
        url.searchParams.set('maxResults', '250');
        if (next) url.searchParams.set('pageToken', next);
        const { data } = await get<{ items?: CalendarOption[]; nextPageToken?: string }>(
          url.toString(),
          credential,
        );
        calendars.push(
          ...(data.items || []).map(({ id, summary, accessRole, primary }) => ({
            id,
            summary,
            accessRole,
            primary,
          })),
        );
        next = data.nextPageToken;
        if (!next) return calendars;
      }
      throw new DomainError('provider_unavailable', 503);
    },
    async revoke(credential: GoogleCredential): Promise<void> {
      try {
        const response = await fetcher('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: credential.refreshToken }),
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok && response.status !== 400) throw new Error();
      } catch {
        throw new DomainError('provider_unavailable', 503);
      }
    },
  };
}
export type GoogleProvider = ReturnType<typeof createGoogle>;
