import { z } from 'zod'
import { DomainError } from '@/contracts/common'
import { handleAuth } from '@/server/services/auth'
import { commandBody, jsonResult } from '@/server/command-api'
import { assertMutationOrigin, authCookie, USER_COOKIE } from '@/server/session'
import { readServerConfig } from '@/server/config'
import { getDb, one } from '@/server/db/client'
export function POST(req: Request) { return handleAuth(async () => {
 assertMutationOrigin(req)
 if (readServerConfig().mode !== 'demo') throw new DomainError('forbidden', '데모에서만 사용자를 바꿀 수 있어요')
 const {userId} = await commandBody(req, z.strictObject({userId:z.string().min(1)}))
 const actor = await one<{id:string;name:string}>(getDb(), 'SELECT id,name FROM users WHERE id=?', [userId])
 if (!actor) throw new DomainError('not_found', '사용자를 찾을 수 없어요')
 const response = jsonResult({actor:{...actor, mode:'demo'}})
 response.headers.append('Set-Cookie', authCookie(USER_COOKIE, userId, req.url, 604800))
 return response
}) }
