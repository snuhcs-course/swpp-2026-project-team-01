// AI-generated with Codex (gpt-6-astra), 2026-10-05
import { authStartSchema } from '@/contracts/auth'
import { commandBody, jsonResult } from '@/server/command-api'
import { authContext, startGoogleAuth, handleAuth } from '@/server/services/auth'
import { assertMutationOrigin, authCookie, readCookie, randomToken, OAUTH_COOKIE, SESSION_COOKIE } from '@/server/session'
export function POST(req: Request) { return handleAuth(async () => {
 assertMutationOrigin(req)
 const browserToken = randomToken()
 const input = await commandBody(req, authStartSchema)
 const data = await startGoogleAuth(authContext(), {browserToken, sessionToken: await readCookie(SESSION_COOKIE, req)}, input)
 const response = jsonResult(data)
 response.headers.append('Set-Cookie', authCookie(OAUTH_COOKIE, browserToken, req.url, 600))
 return response
}) }
