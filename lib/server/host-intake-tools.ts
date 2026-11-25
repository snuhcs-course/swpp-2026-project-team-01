import { z } from "zod";
import { linkedMessagingTurn } from "./channel-selection";
import { CommandError, runCommand } from "./commands";
import { activeBindingOfHost } from "./imessage-links";
import { readHostIntake, setHostIntakeCommand } from "./host-intake";
import { authorizeSetupTool, SettingsChannelOnlyError, type SetupToolCall } from "./setup-tools";
import type { Database } from "./database";

export const intakeToolInput = z.object({ accepting: z.boolean(), expectedRevision: z.number().int().min(0) }).strict();

export async function setIntakeForTool(db: Database, call: SetupToolCall, input: z.infer<typeof intakeToolInput>) {
  let actor;
  try {
    actor = await authorizeSetupTool(db, call.auth, call.sessionId, { allowReview: true });
  } catch (error) {
    if (error instanceof SettingsChannelOnlyError) return { saved: false, problem: "Change intake in web Settings or the linked messenger." };
    throw error;
  }
  const turn = await linkedMessagingTurn(db, call.sessionId, actor.id);
  const binding = await activeBindingOfHost(db, actor.id);
  if (!turn || turn.channel === "whatsapp" || binding?.channel !== turn.channel) return { saved: false, problem: "Change intake in web Settings or the linked messenger." };
  const outcome = await runCommand({ db, authenticate: async () => actor }, {
    ...setHostIntakeCommand,
    async run(tx, context) {
      // Take the command's account lock before rechecking the linked turn.
      const result = await setHostIntakeCommand.run(tx, context);
      await authorizeSetupTool(tx, call.auth, call.sessionId, { allowReview: true });
      const current = await linkedMessagingTurn(tx, call.sessionId, actor.id);
      const active = await activeBindingOfHost(tx, actor.id);
      if (current?.inputId !== turn.inputId || active?.id !== binding.id) throw new CommandError("forbidden");
      return result;
    },
  }, { resourceId: actor.id, expectedRevision: input.expectedRevision, input: { accepting: input.accepting }, retryKey: `tool:${call.callId}` });
  return outcome.ok ? { saved: true, ...outcome.result } : { saved: false, problem: outcome.error.category, intake: await readHostIntake(db, actor.id) };
}
