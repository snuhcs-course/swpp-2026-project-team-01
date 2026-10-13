import { defineTool } from 'eve/tools';
import { privateNoteInput } from '../../lib/contracts/conversation-tools.ts';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Save a private host note about the current request when asked. Available only in host-private discussion. Read the current revision first. This does not approve, decline, or change a proposal.',
  inputSchema: privateNoteInput,
  availableInSubagents: false,
  async execute(input, ctx) {
    return new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId }, { operation: 'private_note_save', input });
  },
});
