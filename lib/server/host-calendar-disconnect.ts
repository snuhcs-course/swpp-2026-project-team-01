import type { Transaction } from "./database";

// The web control and the host's linked-messenger tool share this one
// transaction so disconnect has the same readiness effects in either place.
export async function disconnectHostCalendar(tx: Transaction, hostAccountId: string) {
  await tx`select id from app.host_accounts where id = ${hostAccountId} for update`;
  await tx`delete from app.provider_grants where host_account_id = ${hostAccountId}`;
  await tx`delete from app.calendar_roles where host_account_id = ${hostAccountId}`;
  await tx`delete from app.calendar_note_decisions where host_account_id = ${hostAccountId}`;
  await tx`
    update app.host_settings
    set settings = settings - array['bookingCalendar', 'conflictCalendars', 'noteExclusions']::text[],
        revision = revision + 1, updated_at = now()
    where host_account_id = ${hostAccountId}
  `;
}
