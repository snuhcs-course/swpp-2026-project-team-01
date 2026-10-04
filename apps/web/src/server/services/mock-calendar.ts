import { DomainError, type OperationMeta } from '@/contracts/common'
import type { CalendarConnectionView } from '@/contracts/calendar'
import { lock, one, run } from '../db/client'
import type { ServiceContext } from '../runtime'
import { MOCK_SUBJECT_PREFIX } from '../providers/mock-calendar'
import { runOperation } from './operations'
import { readCalendarConnection } from './calendar-sync'

/**
 * Demo-only counterpart of the Google consent flow: marks the account as connected to its example calendar.
 * It stores no token and talks to no external service; the usual catalog → selection → import steps follow.
 */
export async function connectMockCalendar(ctx: ServiceContext, userId: string, op: OperationMeta): Promise<CalendarConnectionView> {
  if (ctx.config.mode !== 'demo') throw new DomainError('forbidden', '예시 Calendar는 데모 모드에서만 연결할 수 있어요')
  return runOperation(ctx, userId, 'calendar.mock.connect', {}, op, async tx => {
    await lock(tx, `connection-create:${userId}`)
    const old = await one<{ id: string; status: string }>(tx, 'SELECT id, status FROM calendar_connections WHERE user_id = ?', [userId])
    if (old?.status === 'connected') return readCalendarConnection(tx, userId)
    if (old) await run(tx, "UPDATE calendar_connections SET subject = ?, status = 'connected', refresh_token_ciphertext = NULL, key_version = NULL, granted_scopes_json = '[]', revision = revision + 1 WHERE id = ?", [`${MOCK_SUBJECT_PREFIX}${userId}`, old.id])
    else await run(tx, "INSERT INTO calendar_connections(id, user_id, subject, status, granted_scopes_json) VALUES (?, ?, ?, 'connected', '[]')", [ctx.id(), userId, `${MOCK_SUBJECT_PREFIX}${userId}`])
    await run(tx, "UPDATE users SET calendar_use_state = 'needs_refresh', calendar_use_revision = calendar_use_revision + 1 WHERE id = ?", [userId])
    return readCalendarConnection(tx, userId)
  })
}
