import { defineTool } from 'eve/tools';
import { detailsProposalInput } from '../../lib/contracts/conversation-tools.ts';
import { ConversationTools } from '../../lib/server/identity/tool-execution.ts';

export default defineTool({
  description: 'Propose a partial request-details draft for requester review. Read current context first; preserve omitted fields and report ambiguous information in clarifications. This never saves scheduling details. The requester must apply the exact draft in protected controls.',
  inputSchema: detailsProposalInput,
  availableInSubagents: false,
  async execute(input, ctx) {
    return new ConversationTools().execute(ctx.session.auth.current,
      { sessionId: ctx.session.id, callId: ctx.callId }, { operation: 'details_propose', input });
  },
});
