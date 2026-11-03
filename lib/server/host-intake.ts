import { z } from "zod";
import { assertRevision, CommandError, type CommandDefinition } from "./commands";
import type { Queryable } from "./database";

export const setHostIntakeCommand: CommandDefinition<{ accepting: boolean }, { accepting: boolean; revision: number }> = {
  operation: "host.set_intake",
  input: z.object({ accepting: z.boolean() }).strict(),
  async run(tx, context) {
    if (context.actor.kind !== "host_account" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
    const [account] = await tx<{ status: string; intake_revision: number }[]>`
      select status, intake_revision from app.host_accounts where id = ${context.resourceId} for update
    `;
    if (account?.status !== "active") throw new CommandError("forbidden");
    assertRevision(account.intake_revision, context.expectedRevision);
    const [saved] = await tx<{ accepting_requests: boolean; intake_revision: number }[]>`
      update app.host_accounts set accepting_requests = ${context.input.accepting},
        intake_revision = intake_revision + 1, updated_at = now()
      where id = ${context.resourceId} returning accepting_requests, intake_revision
    `;
    return { accepting: saved!.accepting_requests, revision: saved!.intake_revision };
  },
};

export async function readHostIntake(db: Queryable, hostAccountId: string) {
  const [row] = await db<{ accepting_requests: boolean; intake_revision: number; confirmed_windows: unknown; confirmed_timezone: string | null }[]>`
    select a.accepting_requests, a.intake_revision, s.settings -> 'weeklyWindows' as confirmed_windows,
      s.settings ->> 'timezone' as confirmed_timezone
    from app.host_accounts a left join app.host_settings s on s.host_account_id = a.id where a.id = ${hostAccountId}
  `;
  if (!row) return null;
  return { accepting: row.accepting_requests, revision: row.intake_revision, confirmedWindows: row.confirmed_windows, confirmedTimezone: row.confirmed_timezone };
}
