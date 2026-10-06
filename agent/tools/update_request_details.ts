import { defineTool } from 'eve/tools';
import { detailsUpdateInput } from '../../lib/contracts/conversation-tools.ts';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Replace request details using information supplied in this shared conversation. Read the current details and revision first; preserve unchanged fields. Ask about ambiguous times and locations. A change invalidates candidates, proposal and prior decisions. This never records agreement or host approval.',
  inputSchema: detailsUpdateInput,
  availableInSubagents: false,
  async execute(input, ctx) {
    return new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId }, { operation: 'details_update', input });
  },
});
