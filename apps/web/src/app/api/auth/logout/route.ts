import { handleAuth } from '@/server/services/auth'
import { assertMutationOrigin, revokeSession, sessionContext, readCookie, authCookie, SESSION_COOKIE } from '@/server/session'
import { jsonResult } from '@/server/command-api'
export function POST(req: Request) { return handleAuth(async () => {
 assertMutationOrigin(req)
 await revokeSession(sessionContext(), await readCookie(SESSION_COOKIE, req))
 const response = jsonResult({loggedOut: true})
 response.headers.append('Set-Cookie', authCookie(SESSION_COOKIE, '', req.url, 0))
 return response
}) }
