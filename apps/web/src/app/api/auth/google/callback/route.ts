import { completeGoogleAuth, authContext, handleAuth } from '@/server/services/auth'
import { readCookie, authCookie, OAUTH_COOKIE, SESSION_COOKIE } from '@/server/session'
export function GET(req: Request) { return handleAuth(async () => {
 const url = new URL(req.url)
 const result = await completeGoogleAuth(authContext(), {browserToken: await readCookie(OAUTH_COOKIE, req) ?? '', sessionToken: await readCookie(SESSION_COOKIE, req)}, {code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? ''})
 const response = new Response(null, {status: 303, headers: {Location: new URL(result.returnPath, req.url).href, 'Cache-Control':'no-store'}})
 if(result.sessionToken) response.headers.append('Set-Cookie', authCookie(SESSION_COOKIE, result.sessionToken, req.url, 604800))
 response.headers.append('Set-Cookie', authCookie(OAUTH_COOKIE, '', req.url, 0))
 return response
}) }
